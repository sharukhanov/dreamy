-- События для статистики (без текстов снов) и перенос уже накопленных снов.
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON events (type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_user ON events (user_id, created_at);
INSERT INTO events (created_at, user_id, type)
    SELECT created_at, user_id, 'dream_ok' FROM dreams
    WHERE NOT EXISTS (SELECT 1 FROM events WHERE type = 'dream_ok');
