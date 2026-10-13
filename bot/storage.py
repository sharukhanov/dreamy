"""Дневник снов в SQLite."""

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import aiosqlite

SCHEMA = """
CREATE TABLE IF NOT EXISTS dreams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    dream_text TEXT NOT NULL,
    interpretation TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dreams_user ON dreams (user_id, id);
"""


@dataclass(frozen=True)
class DreamRecord:
    id: int
    created_at: datetime
    user_id: int
    dream_text: str
    interpretation: str


class DreamStorage:
    def __init__(self, path: Path | str) -> None:
        self._path = str(path)

    async def init(self) -> None:
        if self._path != ":memory:":
            Path(self._path).parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self._path) as db:
            await db.executescript(SCHEMA)
            await db.commit()

    async def add(self, user_id: int, dream_text: str, interpretation: str) -> int:
        async with aiosqlite.connect(self._path) as db:
            cursor = await db.execute(
                "INSERT INTO dreams (created_at, user_id, dream_text, interpretation) "
                "VALUES (?, ?, ?, ?)",
                (datetime.now(UTC).isoformat(), user_id, dream_text, interpretation),
            )
            await db.commit()
            return cursor.lastrowid

    async def latest(self, user_id: int, limit: int = 5) -> list[DreamRecord]:
        async with aiosqlite.connect(self._path) as db:
            cursor = await db.execute(
                "SELECT id, created_at, user_id, dream_text, interpretation FROM dreams "
                "WHERE user_id = ? ORDER BY id DESC LIMIT ?",
                (user_id, limit),
            )
            rows = await cursor.fetchall()
        return [DreamRecord(r[0], datetime.fromisoformat(r[1]), r[2], r[3], r[4]) for r in rows]

    async def delete_all(self, user_id: int) -> int:
        async with aiosqlite.connect(self._path) as db:
            cursor = await db.execute("DELETE FROM dreams WHERE user_id = ?", (user_id,))
            await db.commit()
            return cursor.rowcount
