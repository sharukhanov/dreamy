"""Сборка системного промта из prompts/interpreter.md и config/traditions.yaml."""

import random
from collections.abc import Callable
from pathlib import Path

import yaml

from bot.config import PROJECT_ROOT

PROMPT_PATH = PROJECT_ROOT / "prompts" / "interpreter.md"
TRADITIONS_PATH = PROJECT_ROOT / "config" / "traditions.yaml"


DEFAULT_PICK = {"dream_books": 3, "psychology": 2}


def load_traditions(path: Path = TRADITIONS_PATH) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    result: dict = {}
    for section in ("dream_books", "psychology"):
        items = data.get(section) or []
        if not items:
            raise ValueError(f"В {path.name} пустой раздел '{section}'")
        for item in items:
            if not item.get("name"):
                raise ValueError(f"В {path.name} у традиции в разделе '{section}' нет name")
        result[section] = items
    result["pick"] = {
        section: int(data.get(f"pick_{section}") or default)
        for section, default in DEFAULT_PICK.items()
    }
    return result


def _format_section(items: list[dict]) -> str:
    lines = []
    for item in items:
        line = f"- {item['name']}"
        if item.get("label"):
            line += f" (подпись в ответе: «{item['label']}»)"
        if item.get("description"):
            line += f": {' '.join(str(item['description']).split())}"
        lines.append(line)
    return "\n".join(lines)


def create_prompt_builder(
    prompt_path: Path = PROMPT_PATH,
    traditions_path: Path = TRADITIONS_PATH,
    rng: random.Random | None = None,
) -> Callable[[], str]:
    """Функция, которая на каждый сон собирает промт со случайным набором традиций."""
    template = prompt_path.read_text(encoding="utf-8")
    traditions = load_traditions(traditions_path)
    rng = rng or random.Random()

    def build() -> str:
        picked = {
            section: rng.sample(
                traditions[section],
                max(1, min(traditions["pick"][section], len(traditions[section]))),
            )
            for section in ("dream_books", "psychology")
        }
        return (
            template.replace(
                "{{MODE_RULES}}", "- В этом ответе есть оба блока: 📖 Сонники и 🧠 Психология."
            )
            .replace("{{DREAM_BOOKS}}", _format_section(picked["dream_books"]))
            .replace("{{PSYCHOLOGY}}", _format_section(picked["psychology"]))
        )

    return build


def build_system_prompt(
    prompt_path: Path = PROMPT_PATH, traditions_path: Path = TRADITIONS_PATH
) -> str:
    return create_prompt_builder(prompt_path, traditions_path)()
