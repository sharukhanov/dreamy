"""Толкование снов через Google Gemini."""

import asyncio
import logging
from typing import Protocol

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)


class InterpreterError(Exception):
    """Gemini не ответил даже после повтора."""


class Interpreter(Protocol):
    async def interpret(self, dream_text: str) -> str: ...


class GeminiInterpreter:
    def __init__(
        self,
        api_key: str,
        model: str,
        system_prompt: str,
        client: genai.Client | None = None,
        retry_delay: float = 2.0,
    ) -> None:
        self._client = client or genai.Client(api_key=api_key)
        self._model = model
        self._config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.8,
            max_output_tokens=2048,
        )
        self._retry_delay = retry_delay

    async def interpret(self, dream_text: str) -> str:
        attempts = 2  # одна попытка + один повтор
        for attempt in range(1, attempts + 1):
            try:
                response = await self._client.aio.models.generate_content(
                    model=self._model, contents=dream_text, config=self._config
                )
                text = (response.text or "").strip()
                if not text:
                    raise InterpreterError("пустой ответ модели")
                return text
            except Exception as exc:  # noqa: BLE001 — любые сбои API считаем временными
                logger.warning(
                    "Gemini: ошибка на попытке %d/%d: %s", attempt, attempts, type(exc).__name__
                )
                if attempt == attempts:
                    raise InterpreterError(str(exc)) from exc
                await asyncio.sleep(self._retry_delay)
        raise InterpreterError("недостижимо")
