from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, Integer, DateTime, func, String, Boolean, Float


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
    is_guest = Column(Boolean, default=False)
    credibility_score = Column(Float, default=50.0)
    is_admin = Column(Boolean, default=False)
