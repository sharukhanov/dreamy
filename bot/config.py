"""Настройки бота из файла .env."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = "gemini-3.8-flash"


def parse_user_ids(raw: str | None) -> frozenset[int]:
    """Разбирает строку вида '123, 456' в набор id. Мусор пропускается."""
    ids: set[int] = set()
    for part in (raw or "").replace(";", ",").split(","):
        part = part.strip()
        if part.lstrip("-").isdigit():
            ids.add(int(part))
    return frozenset(ids)


@dataclass(frozen=True)
class Settings:
    telegram_token: str
    gemini_api_key: str
    gemini_model: str
    allowed_user_ids: frozenset[int]
    database_path: Path

    @property
    def setup_mode(self) -> bool:
        return not self.allowed_user_ids


def load_settings(env_file: Path | None = None) -> Settings:
    load_dotenv(env_file or PROJECT_ROOT / ".env", override=True)

    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise RuntimeError("Не задан TELEGRAM_BOT_TOKEN в файле .env")

    db_path = Path(os.getenv("DATABASE_PATH", "").strip() or "data/dreams.db")
    if not db_path.is_absolute():
        db_path = PROJECT_ROOT / db_path

    return Settings(
        telegram_token=token,
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        gemini_model=os.getenv("GEMINI_MODEL", "").strip() or DEFAULT_MODEL,
        allowed_user_ids=parse_user_ids(os.getenv("ALLOWED_USER_IDS")),
        database_path=db_path,
    )
