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
