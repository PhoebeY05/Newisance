try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
except Exception:
    from pydantic import BaseSettings
    SettingsConfigDict = None


class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str = 'redis://localhost:6379'
    JWT_SECRET: str = 'change-me'
    JWT_ALGORITHM: str = 'HS256'
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7

    # AI verification (Phase 6). Empty key → the worker falls back to an offline
    # heuristic analyser so the pipeline still works without Google AI Studio.
    GEMINI_API_KEY: str = ''
    GEMINI_MODEL: str = 'gemini-2.5-flash'
    AI_ANALYSIS_ENABLED: bool = True

    # Local media (images are written here by community-service; the AI worker
    # reads them back for image analysis).
    LOCAL_MEDIA_DIR: str = './media_uploads'

    if SettingsConfigDict is not None:
        model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    else:
        class Config:
            env_file = '.env'
            extra = 'ignore'


settings = Settings()
