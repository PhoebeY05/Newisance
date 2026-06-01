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

    if SettingsConfigDict is not None:
        model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    else:
        class Config:
            env_file = '.env'
            extra = 'ignore'


settings = Settings()
