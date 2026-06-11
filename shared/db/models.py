from sqlalchemy.orm import declarative_base
from sqlalchemy import (
    Column,
    Integer,
    DateTime,
    func,
    String,
    Boolean,
    Float,
    Text,
    ForeignKey,
    JSON,
    UniqueConstraint,
)


Base = declarative_base()


class TimestampMixin:
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class User(Base, TimestampMixin):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    username = Column(String(80), unique=True, nullable=False)
    email = Column(String(200), unique=True, nullable=False)
    hashed_password = Column(String(200), nullable=True)
    is_guest = Column(Boolean, default=False, nullable=False)
    credibility_score = Column(Float, default=0.0, nullable=False)
    # Denormalised tier name derived from credibility_score (Newcomer/Verified/
    # Analyst/Expert); kept in sync on every credibility change (Phase 8).
    # New users begin as Newcomers at 0 and earn credibility through play.
    tier = Column(String(20), default='Newcomer', nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)


class Question(Base, TimestampMixin):
    __tablename__ = 'questions'
    id = Column(Integer, primary_key=True)
    content = Column(Text, nullable=False)
    # One of: misleading_headline, deepfake, manipulated_media, scam_message, satire
    type = Column(String(50), nullable=False)
    media_url = Column(String(500), nullable=True)
    correct_answer = Column(String(200), nullable=True)
    explanation = Column(Text, nullable=True)
    difficulty = Column(String(20), nullable=True)  # easy | medium | hard
    tags = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)


class GameSession(Base, TimestampMixin):
    __tablename__ = 'game_sessions'
    id = Column(Integer, primary_key=True)
    # Nullable so fully-anonymous (token-less) plays still record a session.
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    mode = Column(String(20), nullable=False, default='timed')
    room_id = Column(String(80), nullable=True)
    score = Column(Float, nullable=False, default=0.0)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)


class SessionAnswer(Base, TimestampMixin):
    __tablename__ = 'session_answers'
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey('game_sessions.id'), nullable=False)
    question_id = Column(Integer, ForeignKey('questions.id'), nullable=False)
    chosen_answer = Column(String(200), nullable=True)
    is_correct = Column(Boolean, nullable=False, default=False)
    response_ms = Column(Integer, nullable=True)
    # Stored so session score is the cheap SUM(points_earned) at end-of-game.
    points_earned = Column(Float, nullable=False, default=0.0)


class CredibilityLog(Base, TimestampMixin):
    __tablename__ = 'credibility_log'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    delta = Column(Float, nullable=False)
    reason = Column(String(100), nullable=True)
    new_score = Column(Float, nullable=False)


class UserPowerup(Base, TimestampMixin):
    """Power-ups a user owns, bought from the shop with credibility (Phase 11)."""
    __tablename__ = 'user_powerups'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    key = Column(String(40), nullable=False)
    quantity = Column(Integer, nullable=False, default=0)
    __table_args__ = (UniqueConstraint('user_id', 'key', name='uq_user_powerups_user_key'),)


class Submission(Base, TimestampMixin):
    """A piece of suspicious content submitted to the community hub (Phase 5)."""
    __tablename__ = 'submissions'
    id = Column(Integer, primary_key=True)
    # Nullable so a malformed/expired token still records the content.
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    content_type = Column(String(20), nullable=False)  # image | url | text
    # For url/text this holds the raw content; for image, the saved media path.
    content_url = Column(Text, nullable=False)
    caption = Column(Text, nullable=True)
    # pending → analysed (AI done) | community_only (AI failed/unavailable)
    status = Column(String(30), nullable=False, default='pending')
    # Legacy idempotency marker; scores are now recalculated by scheduled batch jobs.
    credibility_settled = Column(Boolean, default=False, nullable=False)


class Vote(Base, TimestampMixin):
    """One community verdict on a submission. One vote per user per submission."""
    __tablename__ = 'votes'
    id = Column(Integer, primary_key=True)
    submission_id = Column(Integer, ForeignKey('submissions.id'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    verdict = Column(String(10), nullable=False)  # real | fake
    impact_score = Column(Integer, nullable=False, default=1)  # 1–5
    # Snapshot of the voter's weight at vote time; never recalculated later.
    credibility_weight = Column(Float, nullable=False, default=0.5)

    __table_args__ = (
        UniqueConstraint('submission_id', 'user_id', name='uq_votes_submission_user'),
    )


class SubmissionCredibilityAdjustment(Base, TimestampMixin):
    """Latest instant credibility adjustment applied to a voter for a submission."""
    __tablename__ = 'submission_credibility_adjustments'
    id = Column(Integer, primary_key=True)
    submission_id = Column(Integer, ForeignKey('submissions.id'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    effective_verdict = Column(String(10), nullable=False)  # real | fake
    community_verdict = Column(String(10), nullable=False)  # voter's real | fake verdict
    delta = Column(Float, nullable=False)
    reversed = Column(Boolean, default=False, nullable=False)

    __table_args__ = (
        UniqueConstraint('submission_id', 'user_id', name='uq_submission_credibility_adjustment_submission_user'),
    )


class SubmissionAppeal(Base, TimestampMixin):
    __tablename__ = 'submission_appeals'
    id = Column(Integer, primary_key=True)
    submission_id = Column(Integer, ForeignKey('submissions.id'), nullable=False)
    appellant_user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    status = Column(String(20), default='pending', nullable=False)  # pending | reviewed | upheld | rejected

    __table_args__ = (
        UniqueConstraint('submission_id', 'appellant_user_id', name='uq_submission_appeals_submission_user'),
    )


class Comment(Base, TimestampMixin):
    """A community fact-check / comment left on a submission."""
    __tablename__ = 'comments'
    id = Column(Integer, primary_key=True)
    submission_id = Column(Integer, ForeignKey('submissions.id'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    body = Column(Text, nullable=False)


class AiAnalysis(Base, TimestampMixin):
    """AI verdict for a submission (populated in Phase 6; null until then)."""
    __tablename__ = 'ai_analysis'
    id = Column(Integer, primary_key=True)
    submission_id = Column(Integer, ForeignKey('submissions.id'), nullable=False)
    confidence = Column(Float, nullable=True)  # 0.0–1.0
    signals = Column(JSON, nullable=True)  # list[str]
    verdict = Column(String(30), nullable=True)  # likely_real | likely_fake | uncertain
    explanation = Column(Text, nullable=True)
    # Rich deterministic report (sections rendered on the AI Analysis page).
    report = Column(JSON, nullable=True)
    processed_at = Column(DateTime(timezone=True), nullable=True)


class LeaderboardSnapshot(Base, TimestampMixin):
    """A frozen weekly ranking row, written by the Phase 10 reset job before
    the live `leaderboard:weekly` Redis key is cleared."""
    __tablename__ = 'leaderboard_snapshots'
    id = Column(Integer, primary_key=True)
    scope = Column(String(20), nullable=False)  # weekly | alltime
    rank = Column(Integer, nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    score = Column(Float, nullable=False)
    snapshot_date = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Voucher(Base, TimestampMixin):
    """A reward voucher. Unclaimed rows are assigned to weekly top-3 winners
    (Phase 10), which sets claimed=True and user_id."""
    __tablename__ = 'vouchers'
    id = Column(Integer, primary_key=True)
    code = Column(String(80), unique=True, nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    claimed = Column(Boolean, default=False, nullable=False)
