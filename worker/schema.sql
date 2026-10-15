CREATE TABLE IF NOT EXISTS dreams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    dream_text TEXT NOT NULL,
    interpretation TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dreams_user ON dreams (user_id, id);

CREATE TABLE IF NOT EXISTS processed_updates (
    update_id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    dream_books TEXT NOT NULL DEFAULT '[]',
    psychology TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
);

-- События для статистики /stats (только тип события, без текстов).
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON events (type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_user ON events (user_id, created_at);
