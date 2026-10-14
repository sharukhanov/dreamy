"""Обработчики сообщений и команд Telegram."""

import html
import logging
import re
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    TelegramObject,
)
from aiogram.utils.chat_action import ChatActionSender

from bot import texts
from bot.interpreter import Interpreter, InterpreterError
from bot.safety import CRISIS_REPLY, looks_like_crisis
from bot.storage import DreamStorage

logger = logging.getLogger(__name__)

TELEGRAM_LIMIT = 4096
FORGET_YES_DATA = "forget:yes"
FORGET_NO_DATA = "forget:no"


class AccessMiddleware(BaseMiddleware):
    """Пускает только разрешённых пользователей. Без списка — режим настройки."""

    def __init__(self, allowed_user_ids: frozenset[int]) -> None:
        self.allowed = allowed_user_ids

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = getattr(event, "from_user", None)
        if user is None:
            return None
        if not self.allowed:
            logger.info("Режим настройки: сообщение от Telegram id %s", user.id)
            await _reply(event, texts.SETUP_MODE.format(user_id=user.id))
            return None
        if user.id not in self.allowed:
            logger.info("Отказ в доступе: Telegram id %s", user.id)
            await _reply(event, texts.NOT_ALLOWED)
            return None
        return await handler(event, data)


async def _reply(event: TelegramObject, text: str) -> None:
    if isinstance(event, Message):
        await event.answer(text)
    elif isinstance(event, CallbackQuery):
        await event.answer(text, show_alert=True)


_BOLD_RE = re.compile(r"\*\*([^*\n]+?)\*\*")
_BOOKS_RE = re.compile(r"^📖[ \t*]*Сонники[ \t*:]*$", re.M)
_PSYCH_RE = re.compile(r"^🧠[ \t*]*Психология[ \t*:]*$", re.M)
_REAL_RE = re.compile(r"^🏠[ \t*]*Из[ \t]+реальн\S*[ \t]+жизн[^\s*:—–-]*[ \t*:—–-]*", re.M | re.I)
_MAIN_RE = re.compile(r"^✨[ \t]*(\S.*)$", re.M)


def normalize_layout(text: str) -> str:
    """Выравнивает оформление расклада независимо от того, как модель расставила звёздочки."""
    blocks = re.split(r"\n{2,}", text)
    if (
        len(blocks) > 2
        and blocks[0].startswith("✨")
        and not blocks[1].startswith(("🏠", "📖", "🧠", "•"))
    ):
        blocks[1] = "🏠 " + blocks[1]
        text = "\n\n".join(blocks)
    text = _BOOKS_RE.sub("📖 **Сонники**", text)
    text = _PSYCH_RE.sub("🧠 **Психология**", text)
    text = _REAL_RE.sub("🏠 ", text)
    return re.sub(r"^🏠 (\S)", lambda m: "🏠 " + m.group(1).upper(), text, flags=re.M)


def to_telegram_html(text: str) -> str:
    """**текст** → жирный, остальное экранируется. Главная мысль (✨) всегда жирная."""
    escaped = html.escape(normalize_layout(text), quote=False)
    result = _BOLD_RE.sub(r"<b>\1</b>", escaped).replace("**", "")
    return _MAIN_RE.sub(
        lambda m: m.group(0) if m.group(1).startswith("<b>") else f"✨ <b>{m.group(1)}</b>",
        result,
        count=1,
    )


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def create_router(storage: DreamStorage, interpreter: Interpreter) -> Router:
    router = Router()

    @router.message(CommandStart())
    async def cmd_start(message: Message) -> None:
        await message.answer(texts.START)

    @router.message(Command("help"))
    async def cmd_help(message: Message) -> None:
        await message.answer(texts.HELP)

    @router.message(Command("history"))
    async def cmd_history(message: Message) -> None:
        records = await storage.latest(message.from_user.id, limit=5)
        if not records:
            await message.answer(texts.HISTORY_EMPTY)
            return
        await message.answer(texts.HISTORY_HEADER.format(count=len(records)))
        for record in reversed(records):
            item = texts.HISTORY_ITEM.format(
                date=record.created_at.astimezone().strftime("%d.%m.%Y %H:%M"),
                dream=html.escape(_cut(record.dream_text, 1000), quote=False),
                interpretation=to_telegram_html(record.interpretation),
            )
            await message.answer(item, parse_mode="HTML")

    @router.message(Command("forget"))
    async def cmd_forget(message: Message) -> None:
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(text=texts.FORGET_YES, callback_data=FORGET_YES_DATA),
                    InlineKeyboardButton(text=texts.FORGET_NO, callback_data=FORGET_NO_DATA),
                ]
            ]
        )
        await message.answer(texts.FORGET_CONFIRM, reply_markup=keyboard)

    @router.callback_query(F.data == FORGET_YES_DATA)
    async def forget_yes(callback: CallbackQuery) -> None:
        count = await storage.delete_all(callback.from_user.id)
        logger.info("Пользователь %s удалил дневник (%d записей)", callback.from_user.id, count)
        await callback.answer()
        if callback.message:
            await callback.message.edit_text(texts.FORGET_DONE.format(count=count))

    @router.callback_query(F.data == FORGET_NO_DATA)
    async def forget_no(callback: CallbackQuery) -> None:
        await callback.answer()
        if callback.message:
            await callback.message.edit_text(texts.FORGET_CANCELLED)

    @router.message(F.text & ~F.text.startswith("/"))
    async def on_dream(message: Message) -> None:
        text = message.text.strip()
        user_id = message.from_user.id
        if len(text) > texts.MAX_DREAM_LENGTH:
            await message.answer(
                texts.TOO_LONG.format(length=len(text), limit=texts.MAX_DREAM_LENGTH)
            )
            return
        if looks_like_crisis(text):
            logger.info("Пользователь %s: сработала кризисная проверка", user_id)
            await message.answer(CRISIS_REPLY)
            return

        logger.info("Пользователь %s: толкование сна (%d символов)", user_id, len(text))
        try:
            async with ChatActionSender.typing(bot=message.bot, chat_id=message.chat.id):
                interpretation = await interpreter.interpret(text)
        except InterpreterError:
            logger.error("Пользователь %s: Gemini не ответил", user_id)
            await message.answer(texts.API_ERROR)
            return

        await storage.add(user_id, text, interpretation)
        await message.answer(to_telegram_html(interpretation), parse_mode="HTML")

    @router.message(F.text.startswith("/"))
    async def unknown_command(message: Message) -> None:
        await message.answer(texts.HELP)

    @router.message()
    async def non_text(message: Message) -> None:
        await message.answer(texts.ONLY_TEXT)

    return router
