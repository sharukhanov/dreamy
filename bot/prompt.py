"""Сборка системного промта из prompts/interpreter.md и config/traditions.yaml."""

from pathlib import Path

import yaml

from bot.config import PROJECT_ROOT

PROMPT_PATH = PROJECT_ROOT / "prompts" / "interpreter.md"
TRADITIONS_PATH = PROJECT_ROOT / "config" / "traditions.yaml"


def load_traditions(path: Path = TRADITIONS_PATH) -> dict[str, list[dict]]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    result = {}
    for section in ("dream_books", "psychology"):
        items = data.get(section) or []
        if not items:
            raise ValueError(f"В {path.name} пустой раздел '{section}'")
        for item in items:
            if not item.get("name"):
                raise ValueError(f"В {path.name} у традиции в разделе '{section}' нет name")
        result[section] = items
    return result


def _format_section(items: list[dict]) -> str:
    lines = []
    for item in items:
        line = f"- {item['name']}"
        if item.get("mention"):
            line += f" (называй так: «{item['mention']}»)"
        if item.get("description"):
            line += f": {' '.join(str(item['description']).split())}"
        lines.append(line)
    return "\n".join(lines)


def build_system_prompt(
    prompt_path: Path = PROMPT_PATH, traditions_path: Path = TRADITIONS_PATH
) -> str:
    template = prompt_path.read_text(encoding="utf-8")
    traditions = load_traditions(traditions_path)
    return template.replace("{{DREAM_BOOKS}}", _format_section(traditions["dream_books"])).replace(
        "{{PSYCHOLOGY}}", _format_section(traditions["psychology"])
    )
