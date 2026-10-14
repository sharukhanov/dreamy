"""Толкование снов через Google Gemini."""

import asyncio
import logging
from collections.abc import Callable
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
        system_prompt: str | Callable[[], str],
        fallback_model: str | None = None,
        client: genai.Client | None = None,
        retry_delay: float = 2.0,
        timeout_seconds: float = 90.0,
    ) -> None:
        # Повторы делаем сами (один раз), встроенные повторы SDK отключены,
        # чтобы пользователь не ждал ответа минутами.
        self._client = client or genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=int(timeout_seconds * 1000),
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )
        # Первая попытка — основная модель, повтор — запасная (если задана).
        self._models = [model, fallback_model or model]
        # Строка или функция (свежий набор традиций на каждый сон).
        self._system_prompt = system_prompt
        self._config = types.GenerateContentConfig(
            temperature=0.8,
            max_output_tokens=4096,
            # Короткий ответ не требует долгих размышлений — так быстрее.
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
        )
        self._retry_delay = retry_delay

    async def interpret(self, dream_text: str) -> str:
        attempts = len(self._models)  # одна попытка + один повтор
        prompt = self._system_prompt() if callable(self._system_prompt) else self._system_prompt
        config = self._config.model_copy(update={"system_instruction": prompt})
        for attempt, model in enumerate(self._models, start=1):
            try:
                response = await self._client.aio.models.generate_content(
                    model=model, contents=dream_text, config=config
                )
                text = (response.text or "").strip()
                if not text:
                    raise InterpreterError("пустой ответ модели")
                return text
            except Exception as exc:  # noqa: BLE001 — любые сбои API считаем временными
                logger.warning(
                    "Gemini (%s): ошибка на попытке %d/%d: %s",
                    model,
                    attempt,
                    attempts,
                    _describe(exc),
                )
                if attempt == attempts:
                    raise InterpreterError(str(exc)) from exc
                await asyncio.sleep(self._retry_delay)
        raise InterpreterError("недостижимо")


def _describe(exc: Exception) -> str:
    """Короткое описание ошибки без содержимого запроса."""
    code = getattr(exc, "code", None)
    return f"{type(exc).__name__} {code}" if code else type(exc).__name__
