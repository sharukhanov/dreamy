-- Выбор психологических подходов (добавлено после первой версии user_settings).
ALTER TABLE user_settings ADD COLUMN psychology TEXT NOT NULL DEFAULT '[]';
