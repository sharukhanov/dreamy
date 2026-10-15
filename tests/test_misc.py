import pytest

from bot.config import load_settings, parse_user_ids
from bot.prompt import build_system_prompt, create_prompt_builder, load_traditions
from bot.safety import looks_like_crisis


def test_parse_user_ids():
    assert parse_user_ids("") == frozenset()
    assert parse_user_ids(None) == frozenset()
    assert parse_user_ids(" 1, 22 ;333, abc") == frozenset({1, 22, 333})


def test_load_settings(tmp_path, monkeypatch):
    for key in (
        "TELEGRAM_BOT_TOKEN",
        "GEMINI_API_KEY",
        "GEMINI_MODEL",
        "ALLOWED_USER_IDS",
        "DATABASE_PATH",
    ):
        monkeypatch.delenv(key, raising=False)
    env = tmp_path / ".env"
    env.write_text("TELEGRAM_BOT_TOKEN=abc\nGEMINI_API_KEY=k\nALLOWED_USER_IDS=\n")
    s = load_settings(env)
    assert s.telegram_token == "abc"
    assert s.setup_mode
    assert s.gemini_model
    assert s.database_path.name == "dreams.db"


def test_load_settings_requires_token(tmp_path, monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    env = tmp_path / ".env"
    env.write_text("TELEGRAM_BOT_TOKEN=\n")
    with pytest.raises(RuntimeError):
        load_settings(env)


def test_traditions_config_is_valid():
    traditions = load_traditions()
    names = {t["name"] for s in ("dream_books", "psychology") for t in traditions[s]}
    assert {"Миллер", "Цветков", "Ванга", "Лофф", "Фрейд", "Юнг", "Холл", "Адлер"} <= names
    assert traditions["pick"] == {"dream_books": 3, "psychology": 3}


def test_system_prompt_contains_rules_and_picked_traditions():
    prompt = build_system_prompt()
    assert "{{" not in prompt
    books = prompt.split("Сонники:\n")[1].split("\n\n")[0].splitlines()
    psych = prompt.split("Психологические подходы:\n")[1].split("\n\n")[0].splitlines()
    assert len(books) == 3 and len(psych) == 3
    assert "цитат" in prompt
    assert "уточняющий вопрос" in prompt
    assert "кризис" in prompt


def test_prompt_varies_between_dreams():
    build = create_prompt_builder()
    assert len({build() for _ in range(30)}) > 5


def test_custom_traditions_file(tmp_path):
    prompt_file = tmp_path / "p.md"
    prompt_file.write_text("A:\n{{DREAM_BOOKS}}\nB:\n{{PSYCHOLOGY}}", encoding="utf-8")
    trad = tmp_path / "t.yaml"
    trad.write_text(
        "dream_books:\n  - name: Нострадамус\npsychology:\n  - name: Адлер\n", encoding="utf-8"
    )
    prompt = build_system_prompt(prompt_file, trad)
    assert "Нострадамус" in prompt and "Адлер" in prompt and "Миллер" not in prompt


def test_empty_section_rejected(tmp_path):
    trad = tmp_path / "t.yaml"
    trad.write_text("dream_books: []\npsychology:\n  - name: Юнг\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_traditions(trad)


@pytest.mark.parametrize(
    "text",
    [
        "Я больше не хочу жить",
        "думаю о самоубийстве",
        "иногда режу себя",
        "хочу умереть",
        "I want to kill myself",
    ],
)
def test_crisis_detected(text):
    assert looks_like_crisis(text)


@pytest.mark.parametrize(
    "text",
    [
        "Мне снилось, что я умер и смотрел на себя сверху",
        "Снилось, что у меня выпали зубы",
        "Во сне я падала с крыши",
    ],
)
def test_ordinary_dreams_not_flagged(text):
    assert not looks_like_crisis(text)
