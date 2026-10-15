-- Режим толкования: both / books / psy.
ALTER TABLE user_settings ADD COLUMN mode TEXT NOT NULL DEFAULT 'both';
