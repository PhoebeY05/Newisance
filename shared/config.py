try:
    from pydantic import BaseSettings
except Exception:
    # pydantic v2 moves BaseSettings into pydantic-settings package
    from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str = 'redis://localhost:6379'
    JWT_SECRET: str = 'change-me'
    JWT_ALGORITHM: str = 'HS256'
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7

    class Config:
        env_file = '.env'


settings = Settings()
