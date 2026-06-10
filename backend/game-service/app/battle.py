"""Battle Royale — real-time multiplayer room manager + game loop (Phase 4).

Authoritative room state lives in-memory (single instance locally); a JSON
snapshot is mirrored to Redis (`room:{id}`, TTL 2h) for visibility / future
multi-instance use. Correct answers also increment `leaderboard:weekly`.

Game flow per room:
  waiting → (5 players, or AUTO_START_SECONDS with ≥2 players) → active
  active: a sequence of questions, each with a QUESTION_SECONDS countdown.
          A wrong answer (or a timeout) eliminates the player immediately.
          Each round stays live for the full countdown, even if everyone has
          already answered correctly. A short pause follows each round so
          points and elimination notices stay visible before the next question.
  finished: one player left standing (or questions exhausted) → game_over.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import WebSocket
from sqlalchemy import func, select

from shared.db.models import GameSession, Question, SessionAnswer, User, UserPowerup
from shared.db.session import AsyncSessionLocal

from leaderboard import get_redis, incr_weekly
from scoring import (
    SPEED_BONUS_CEILING_MS,
    battle_credibility_score,
    is_answer_correct,
    points_for_answer,
)

logger = logging.getLogger(__name__)

# Tunables (env-overridable so tests can shrink the timers).
AUTO_START_SECONDS = float(os.getenv('BATTLE_AUTOSTART_SECONDS', '10'))
QUESTION_SECONDS = float(os.getenv('BATTLE_QUESTION_SECONDS', '15'))
ROUND_TRANSITION_DELAY_SECONDS = float(os.getenv('BATTLE_ROUND_DELAY_SECONDS', '2.5'))
QUESTIONS_PER_GAME = int(os.getenv('BATTLE_QUESTIONS', '10'))
MIN_PLAYERS = 2
START_AT_PLAYERS = 5
MAX_PLAYERS = 20
STARTING_LIVES = 2
MAX_LIVES = 3
SLOWMO_EXTRA_SECONDS = 5.0
BATTLE_POWERUP_KEYS = {'shield', 'slowmo', 'double', 'shrink'}


@dataclass
class PlayerState:
    user_id: int
    username: str
    score: float = 0.0
    lives: int = STARTING_LIVES
    alive: bool = True
    total_answers: int = 0
    correct_answers: int = 0
    speed_bonus_total: float = 0.0
    answer_log: list[dict[str, Any]] = field(default_factory=list)
    credibility_awarded: bool = False
    slowmo_until: float = 0.0
    double_next: bool = False
    featherlight: bool = False
    featherlight_buffer: bool = False


@dataclass
class Room:
    room_id: str
    auth_group: str = 'member'  # member | guest
    players: dict[int, PlayerState] = field(default_factory=dict)
    connections: dict[int, WebSocket] = field(default_factory=dict)
    questions: list[dict[str, Any]] = field(default_factory=list)
    question_index: int = -1
    status: str = 'waiting'  # waiting | active | finished
    answered: set[int] = field(default_factory=set)
    current_correct: str | None = None
    question_started: float = 0.0
    question_closed: bool = False
    start_at: float | None = None  # monotonic time the auto-start timer will fire
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    start_task: asyncio.Task | None = None
    question_task: asyncio.Task | None = None

    def alive_players(self) -> list[PlayerState]:
        return [p for p in self.players.values() if p.alive]


class BattleManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def find_or_create_room(self, auth_group: str) -> Room:
        async with self._lock:
            for room in self.rooms.values():
                if room.auth_group == auth_group and room.status == 'waiting' and len(room.players) < MAX_PLAYERS:
                    return room
            room = Room(room_id=uuid4().hex[:8], auth_group=auth_group)
            self.rooms[room.room_id] = room
            return room

    async def get_or_create(self, room_id: str, auth_group: str = 'member') -> Room:
        async with self._lock:
            room = self.rooms.get(room_id)
            if room is None:
                room = Room(room_id=room_id, auth_group=auth_group)
                self.rooms[room_id] = room
            return room

    def remove(self, room_id: str) -> None:
        self.rooms.pop(room_id, None)


manager = BattleManager()


# ---- data access ---------------------------------------------------------

async def authenticate(token: str | None) -> User | None:
    from shared.auth import decode_token

    if not token:
        return None
    try:
        payload = decode_token(token)
    except Exception:
        return None
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.id == payload.sub))
        return result.scalar_one_or_none()


async def _load_questions(count: int) -> list[dict[str, Any]]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Question)
            .where(Question.is_active.is_(True))
            .order_by(func.random())
            .limit(count)
        )
        return [
            {
                'id': q.id,
                'content': q.content,
                'type': q.type,
                'media_url': q.media_url,
                'difficulty': q.difficulty,
                'correct_answer': q.correct_answer,
            }
            for q in result.scalars().all()
        ]


# ---- messaging -----------------------------------------------------------

def _short_text(text: str, limit: int = 88) -> str:
    collapsed = ' '.join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    return f"{collapsed[: limit - 1].rstrip()}…"


def _round_summary(room: Room) -> str:
    return f"Round {room.question_index + 1} of {len(room.questions)}"


async def _broadcast_feed(room: Room, kind: str, text: str, tone: str = 'info', **extra: Any) -> None:
    await _broadcast(
        room,
        {
            'type': 'feed_event',
            'kind': kind,
            'tone': tone,
            'text': text,
            **extra,
        },
    )


def _state_payload(room: Room) -> dict[str, Any]:
    starts_in_ms: int | None = None
    if room.status == 'waiting' and room.start_at is not None and len(room.players) >= MIN_PLAYERS:
        starts_in_ms = max(0, int((room.start_at - time.monotonic()) * 1000))
    return {
        'type': 'room_state',
        'room_id': room.room_id,
        'status': room.status,
        'question_index': room.question_index,
        'starts_in_ms': starts_in_ms,
        'players': [
            {
                'user_id': p.user_id,
                'username': p.username,
                'score': round(p.score, 2),
                'lives': p.lives,
                'alive': p.alive,
                'total_answers': p.total_answers,
                'correct_answers': p.correct_answers,
            }
            for p in sorted(room.players.values(), key=lambda p: p.score, reverse=True)
        ],
    }


async def _send(room: Room, user_id: int, message: dict[str, Any]) -> None:
    ws = room.connections.get(user_id)
    if ws is None:
        return
    try:
        await ws.send_json(message)
    except Exception:
        room.connections.pop(user_id, None)


async def _broadcast(room: Room, message: dict[str, Any]) -> None:
    dead: list[int] = []
    for user_id, ws in list(room.connections.items()):
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(user_id)
    for user_id in dead:
        room.connections.pop(user_id, None)


async def _broadcast_state(room: Room) -> None:
    payload = _state_payload(room)
    await _broadcast(room, payload)
    try:
        await get_redis().set(f'room:{room.room_id}', json.dumps(payload), ex=7200)
    except Exception:
        pass


# ---- game loop (all `_` helpers assume room.lock is held) ----------------

async def _damage_player(room: Room, player: PlayerState, reason: str, index: int) -> bool:
    if player.featherlight and not player.featherlight_buffer:
        player.featherlight_buffer = True
        await _send(
            room,
            player.user_id,
            {
                'type': 'powerup_effect',
                'key': 'shrink',
                'effect': 'damage_softened',
                'lives': player.lives,
                'message': 'Featherlight softened this hit. No heart lost.',
            },
        )
        return False
    player.featherlight_buffer = False
    player.lives = max(0, player.lives - 1)
    eliminated = player.lives <= 0
    if eliminated:
        player.alive = False
        await _broadcast(
            room,
            {
                'type': 'player_eliminated',
                'user_id': player.user_id,
                'username': player.username,
                'question_index': index,
                'reason': reason,
                'lives': player.lives,
            },
        )
    else:
        await _broadcast(
            room,
            {
                'type': 'player_damaged',
                'user_id': player.user_id,
                'username': player.username,
                'question_index': index,
                'reason': reason,
                'lives': player.lives,
            },
        )
    return eliminated


async def _close_round(room: Room, index: int, reason: str) -> bool:
    if room.status != 'active' or room.question_index != index or room.question_closed:
        return False

    question = room.questions[index]

    if reason == 'timeout':
        now = time.monotonic()
        pending_slowmo = False
        latest_slowmo_until = now
        for user_id, player in list(room.players.items()):
            if player.alive and user_id not in room.answered:
                if player.slowmo_until > now:
                    pending_slowmo = True
                    latest_slowmo_until = max(latest_slowmo_until, player.slowmo_until)
                    continue
                room.answered.add(user_id)
                player.double_next = False
                player.slowmo_until = 0.0
                player.total_answers += 1
                player.answer_log.append(
                    {
                        'question_id': question['id'],
                        'chosen_answer': None,
                        'is_correct': False,
                        'response_ms': None,
                        'points_earned': 0.0,
                    }
                )
                await _damage_player(room, player, 'timeout', index)
                await _send(
                    room,
                    user_id,
                    {
                        'type': 'answer_result',
                        'is_correct': False,
                        'correct_answer': room.current_correct,
                        'points_earned': 0,
                        'score': round(player.score, 2),
                        'lives': player.lives,
                        'reason': 'timeout',
                    },
                )
        if pending_slowmo:
            delay = max(0.1, latest_slowmo_until - now)
            await _broadcast_feed(
                room,
                'slow_motion',
                f'{_round_summary(room)} extended for a Slow Motion player',
                'info',
                question_id=question['id'],
                question_index=index,
                total=len(room.questions),
            )
            room.question_task = asyncio.create_task(_question_timer(room, index, delay))
            await _broadcast_state(room)
            return False

    room.question_closed = True

    survivors = len(room.alive_players())
    await _broadcast_feed(
        room,
        'round_ended',
        f'{_round_summary(room)} ended - {survivors} player{"s" if survivors != 1 else ""} remain',
        'warning' if reason == 'timeout' else 'info',
        question_id=question['id'],
        question_index=index,
        total=len(room.questions),
        reason=reason,
    )
    await _broadcast_state(room)
    current_task = asyncio.current_task()
    if room.question_task and room.question_task is not current_task:
        room.question_task.cancel()
    room.question_task = None
    return survivors <= 1


async def _award_battle_credibility(
    room: Room, ranked: list[PlayerState]
) -> dict[int, dict[str, Any]]:
    awards: dict[int, dict[str, Any]] = {}
    player_count = len(ranked)
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as session:
        for rank, player in enumerate(ranked, start=1):
            if player.credibility_awarded:
                continue
            if player.total_answers == 0:
                continue
            player.credibility_awarded = True
            avg_speed_bonus = (
                player.speed_bonus_total / player.correct_answers
                if player.correct_answers
                else 0.0
            )
            run_credibility = battle_credibility_score(
                total_answers=player.total_answers,
                correct_answers=player.correct_answers,
                avg_speed_bonus=avg_speed_bonus,
                rank=rank,
                player_count=player_count,
                lives=player.lives,
                starting_lives=STARTING_LIVES,
                question_count=len(room.questions) or QUESTIONS_PER_GAME,
            )

            result = await session.execute(select(User).where(User.id == player.user_id))
            user = result.scalar_one_or_none()
            if user is None:
                continue

            game_session = GameSession(
                user_id=player.user_id,
                mode='battle',
                room_id=room.room_id,
                score=round(player.score, 2),
                ended_at=now,
            )
            session.add(game_session)
            await session.flush()
            for answer in player.answer_log:
                session.add(SessionAnswer(session_id=game_session.id, **answer))

            awards[player.user_id] = {
                'run_credibility_score': run_credibility.score,
                'run_credibility_breakdown': run_credibility.breakdown,
                'credibility_before': None,
                'credibility_after': None,
                'credibility_delta': None,
                'tier': user.tier,
            }
        await session.commit()

    return awards

async def _begin(room: Room) -> None:
    room.status = 'active'
    room.start_at = None
    if room.start_task:
        room.start_task.cancel()
        room.start_task = None
    room.questions = await _load_questions(QUESTIONS_PER_GAME)
    room.question_index = -1
    if not room.questions:
        await _end_game(room)
        return
    await _broadcast_feed(room, 'match_started', f'Match started with {len(room.questions)} questions', 'info', total=len(room.questions))
    await _broadcast_state(room)
    await _next_question(room)


async def _next_question(room: Room) -> None:
    if room.question_index + 1 >= len(room.questions) or len(room.alive_players()) <= 1:
        await _end_game(room)
        return
    room.question_index += 1
    question = room.questions[room.question_index]
    room.current_correct = question['correct_answer']
    room.answered = set()
    room.question_closed = False
    room.question_started = time.monotonic()
    await _broadcast(
        room,
        {
            'type': 'new_question',
            'index': room.question_index,
            'total': len(room.questions),
            'duration_ms': int(QUESTION_SECONDS * 1000),
            'question': {
                'id': question['id'],
                'content': question['content'],
                'type': question['type'],
                'media_url': question['media_url'],
                'difficulty': question['difficulty'],
            },
        },
    )
    await _broadcast_feed(
        room,
        'round_started',
        f'{_round_summary(room)} started',
        'info',
        question_id=question['id'],
        question_index=room.question_index,
        total=len(room.questions),
    )
    room.question_task = asyncio.create_task(_question_timer(room, room.question_index))


async def _question_timer(room: Room, index: int, sleep_seconds: float = QUESTION_SECONDS) -> None:
    try:
        await asyncio.sleep(sleep_seconds)
    except asyncio.CancelledError:
        return
    end_game = False
    async with room.lock:
        end_game = await _close_round(room, index, 'timeout')
        if not room.question_closed:
            return
    await asyncio.sleep(ROUND_TRANSITION_DELAY_SECONDS)
    async with room.lock:
        if room.status != 'active' or room.question_index != index:
            return
        if end_game:
            await _end_game(room)
            return
        await _next_question(room)


async def _end_game(room: Room) -> None:
    room.status = 'finished'
    room.question_closed = True
    current_task = asyncio.current_task()
    if room.question_task and room.question_task is not current_task:
        room.question_task.cancel()
    room.question_task = None
    ranked = sorted(room.players.values(), key=lambda p: (p.alive, p.score), reverse=True)
    awards = await _award_battle_credibility(room, ranked)
    standings = [
        {
            'rank': i + 1,
            'user_id': p.user_id,
            'username': p.username,
            'score': round(p.score, 2),
            'lives': p.lives,
            'alive': p.alive,
            'total_answers': p.total_answers,
            'correct_answers': p.correct_answers,
            'question_total': len(room.questions) or QUESTIONS_PER_GAME,
            **awards.get(p.user_id, {}),
        }
        for i, p in enumerate(ranked)
    ]
    winner = standings[0] if standings else None
    if winner is not None:
        await _broadcast_feed(
            room,
            'game_over',
            f"Match over — {winner['username']} wins with {winner['score']} pts",
            'success',
            standings=standings,
        )
    await _broadcast(room, {'type': 'game_over', 'standings': standings})
    await _broadcast_state(room)


async def _maybe_start(room: Room) -> None:
    if room.status != 'waiting':
        return
    if len(room.players) >= START_AT_PLAYERS:
        if room.start_task:
            room.start_task.cancel()
            room.start_task = None
            room.start_at = None
        await _begin(room)
    elif room.start_task is None and len(room.players) >= MIN_PLAYERS:
        room.start_at = time.monotonic() + AUTO_START_SECONDS
        room.start_task = asyncio.create_task(_start_timer(room))
        # Re-broadcast now that start_at is set; the state sent in connect()
        # was computed before scheduling, so it carried starts_in_ms=None and
        # the client never received the countdown.
        await _broadcast_state(room)


async def _start_timer(room: Room) -> None:
    try:
        await asyncio.sleep(AUTO_START_SECONDS)
    except asyncio.CancelledError:
        return
    async with room.lock:
        room.start_task = None
        room.start_at = None
        if room.status == 'waiting' and len(room.players) >= MIN_PLAYERS:
            await _begin(room)


# ---- public entry points (acquire the lock) ------------------------------

async def connect(room: Room, user_id: int, username: str, websocket: WebSocket) -> None:
    async with room.lock:
        is_new_player = user_id not in room.players
        if user_id not in room.players:
            # Players who join after the game starts come in as spectators.
            alive = room.status == 'waiting'
            room.players[user_id] = PlayerState(
                user_id=user_id,
                username=username,
                lives=STARTING_LIVES if alive else 0,
                alive=alive,
            )
        room.connections[user_id] = websocket
        if is_new_player:
            if room.status == 'waiting':
                await _broadcast_feed(
                    room,
                    'player_joined',
                    f'{username} joined the room',
                    'info',
                    user_id=user_id,
                    username=username,
                    player_count=len(room.players),
                )
            else:
                await _broadcast_feed(
                    room,
                    'spectator_joined',
                    f'{username} joined as a spectator',
                    'info',
                    user_id=user_id,
                    username=username,
                )
        await _broadcast_state(room)
        await _maybe_start(room)


async def disconnect(room: Room, user_id: int) -> None:
    async with room.lock:
        room.connections.pop(user_id, None)
        if room.status == 'waiting':
            departing = room.players.pop(user_id, None)
            # Don't leave an auto-start timer running on an emptied waiting room.
            if len(room.players) < MIN_PLAYERS and room.start_task:
                room.start_task.cancel()
                room.start_task = None
                room.start_at = None
            if departing is not None:
                await _broadcast_feed(
                    room,
                    'player_left',
                    f'{departing.username} left the waiting room',
                    'warning',
                    user_id=departing.user_id,
                    username=departing.username,
                )
        await _broadcast_state(room)
    if not room.connections and (room.status == 'finished' or not room.players):
        manager.remove(room.room_id)


async def handle_powerup(room: Room, user_id: int, key: str) -> None:
    async with room.lock:
        player = room.players.get(user_id)
        if player is None or not player.alive or room.status == 'finished':
            return

        if key not in BATTLE_POWERUP_KEYS:
            await _send(room, user_id, {'type': 'powerup_error', 'key': key, 'message': 'Unknown power-up'})
            return

        message = ''
        if key == 'shield':
            before = player.lives
            if before >= MAX_LIVES:
                await _send(
                    room,
                    user_id,
                    {'type': 'powerup_error', 'key': key, 'message': 'Shield is already at max hearts.'},
                )
                return
            message = 'Shield added one extra heart.'
        elif key == 'slowmo':
            if room.status != 'active' or player.user_id in room.answered or room.question_closed:
                await _send(
                    room,
                    user_id,
                    {'type': 'powerup_error', 'key': key, 'message': 'Use Slow Motion during an unanswered round.'},
                )
                return
            message = f'Slow Motion added {SLOWMO_EXTRA_SECONDS:.0f}s to your timer.'
        elif key == 'double':
            if player.double_next:
                await _send(
                    room,
                    user_id,
                    {'type': 'powerup_error', 'key': key, 'message': 'Double Points is already armed.'},
                )
                return
            message = 'Double Points armed for your next answer.'
        elif key == 'shrink':
            if player.featherlight:
                await _send(
                    room,
                    user_id,
                    {'type': 'powerup_error', 'key': key, 'message': 'Featherlight is already active.'},
                )
                return
            message = 'Featherlight is active for the rest of the match.'

        quantity = 0
        async with AsyncSessionLocal() as session:
            row = (
                await session.execute(
                    select(UserPowerup).where(
                        UserPowerup.user_id == user_id,
                        UserPowerup.key == key,
                    )
                )
            ).scalar_one_or_none()
            if row is None or row.quantity <= 0:
                await _send(room, user_id, {'type': 'powerup_error', 'key': key, 'message': 'You do not own that power-up'})
                return
            row.quantity -= 1
            quantity = row.quantity
            await session.commit()

        if key == 'shield':
            player.lives = min(MAX_LIVES, player.lives + 1)
        elif key == 'slowmo':
            player.slowmo_until = max(player.slowmo_until, time.monotonic() + SLOWMO_EXTRA_SECONDS)
        elif key == 'double':
            player.double_next = True
        elif key == 'shrink':
            player.featherlight = True
            player.featherlight_buffer = False

        await _send(
            room,
            user_id,
            {
                'type': 'powerup_used',
                'key': key,
                'message': message,
                'lives': player.lives,
                'quantity': quantity,
                'slowmo_extra_ms': int(SLOWMO_EXTRA_SECONDS * 1000) if key == 'slowmo' else 0,
            },
        )
        await _broadcast_feed(
            room,
            'powerup_used',
            f'{player.username} used a power-up',
            'info',
            user_id=user_id,
            username=player.username,
            key=key,
        )
        await _broadcast_state(room)


async def handle_answer(room: Room, user_id: int, question_id: Any, answer: str) -> None:
    should_end_game = False
    should_advance = False
    round_index = -1
    async with room.lock:
        if room.status != 'active' or room.question_closed:
            return
        player = room.players.get(user_id)
        if player is None or not player.alive or user_id in room.answered:
            return
        question = room.questions[room.question_index]
        if question_id is not None and question_id != question['id']:
            return  # answer for a stale question
        room.answered.add(user_id)
        round_index = room.question_index

        if is_answer_correct(answer, room.current_correct):
            actual_response_ms = (time.monotonic() - room.question_started) * 1000
            response_ms = min(actual_response_ms, QUESTION_SECONDS * 1000) if player.slowmo_until else actual_response_ms
            base_points = points_for_answer(question['difficulty'], response_ms, True)
            multiplier = 2 if player.double_next else 1
            points = base_points * multiplier
            player.double_next = False
            speed_bonus = max(0.0, 1 - response_ms / SPEED_BONUS_CEILING_MS)
            player.total_answers += 1
            player.correct_answers += 1
            player.speed_bonus_total += speed_bonus
            player.slowmo_until = 0.0
            player.answer_log.append(
                {
                    'question_id': question['id'],
                    'chosen_answer': answer,
                    'is_correct': True,
                    'response_ms': round(response_ms),
                    'points_earned': points,
                }
            )
            player.score += points
            await incr_weekly(user_id, points)
            await _broadcast_feed(
                room,
                'answer_correct',
                f'{player.username} answered correctly and earned +{points:.0f} pts',
                'success',
                user_id=user_id,
                username=player.username,
                points_earned=points,
                score=round(player.score, 2),
                question_id=question['id'],
                question_index=room.question_index,
                total=len(room.questions),
            )
            await _broadcast(
                room,
                {
                    'type': 'answer_correct',
                    'user_id': user_id,
                    'username': player.username,
                    'points_earned': points,
                    'base_points': base_points,
                    'multiplier': multiplier,
                    'score': round(player.score, 2),
                    'question_id': question['id'],
                    'question_index': room.question_index,
                    'total': len(room.questions),
                },
            )
            await _send(
                room,
                user_id,
                {
                    'type': 'answer_result',
                    'is_correct': True,
                    'correct_answer': room.current_correct,
                    'points_earned': points,
                    'base_points': base_points,
                    'multiplier': multiplier,
                    'score': round(player.score, 2),
                    'lives': player.lives,
                },
            )
        else:
            response_ms = (time.monotonic() - room.question_started) * 1000
            player.total_answers += 1
            player.double_next = False
            player.slowmo_until = 0.0
            player.answer_log.append(
                {
                    'question_id': question['id'],
                    'chosen_answer': answer,
                    'is_correct': False,
                    'response_ms': round(response_ms),
                    'points_earned': 0.0,
                }
            )
            lives_before = player.lives
            eliminated = await _damage_player(room, player, 'wrong_answer', room.question_index)
            lost_heart = player.lives < lives_before
            await _send(
                room,
                user_id,
                {
                    'type': 'answer_result',
                    'is_correct': False,
                    'correct_answer': room.current_correct,
                    'points_earned': 0,
                    'score': round(player.score, 2),
                    'lives': player.lives,
                    'reason': 'wrong_answer',
                    'damage_softened': not lost_heart,
                },
            )
            await _broadcast_feed(
                room,
                'player_eliminated' if eliminated else 'life_lost',
                f'{player.username} {"was eliminated" if eliminated else (f"lost a heart ({player.lives} left)" if lost_heart else "had the hit softened by Featherlight")}',
                'danger' if eliminated else 'warning',
                user_id=user_id,
                username=player.username,
                lives=player.lives,
                question_id=question['id'],
                question_index=room.question_index,
                total=len(room.questions),
                reason='wrong_answer',
            )

        await _broadcast_state(room)

        alive_players = room.alive_players()
        if len(alive_players) <= 1:
            should_end_game = await _close_round(room, room.question_index, 'last_player')
        elif alive_players and all(p.user_id in room.answered for p in alive_players):
            should_end_game = await _close_round(room, room.question_index, 'all_answered')
            should_advance = not should_end_game

    if should_end_game or should_advance:
        await asyncio.sleep(ROUND_TRANSITION_DELAY_SECONDS)
        async with room.lock:
            if room.status != 'active' or room.question_index != round_index:
                return
            if should_end_game:
                await _end_game(room)
            else:
                await _next_question(room)
