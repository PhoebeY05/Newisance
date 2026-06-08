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
    GOOGLE_OAUTH_CLIENT_ID: str = ''

    # AI verification (Phase 6). Empty key → the worker falls back to an offline
    # heuristic analyser so the pipeline still works without Google AI Studio.
    GEMINI_API_KEY: str = ''
    GEMINI_MODEL: str = 'gemini-2.5-flash'
    AI_ANALYSIS_ENABLED: bool = True

    # Local media (images are written here by community-service; the AI worker
    # reads them back for image analysis).
    LOCAL_MEDIA_DIR: str = './media_uploads'

    # Rewards & sharing (Phase 10). Email goes to MailHog locally; swap for SES
    # in production behind EMAIL_BACKEND. APP_BASE_URL feeds share links/cards.
    EMAIL_BACKEND: str = 'smtp'  # smtp (MailHog) | ses (prod)
    SMTP_HOST: str = 'localhost'
    SMTP_PORT: int = 1025
    EMAIL_FROM: str = 'rewards@newisance.com'
    APP_BASE_URL: str = 'http://localhost:5173'

    if SettingsConfigDict is not None:
        model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    else:
        class Config:
            env_file = '.env'
            extra = 'ignore'


settings = Settings()
