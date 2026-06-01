from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, Integer, DateTime, func, String, Boolean, Float, Text, ForeignKey


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
    credibility_score = Column(Float, default=50.0, nullable=False)
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
