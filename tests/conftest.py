import asyncio
import itertools
from datetime import datetime
from typing import Any

import pytest
from aiogram import Bot, Dispatcher
from aiogram.client.session.base import BaseSession
from aiogram.methods import AnswerCallbackQuery, EditMessageText, SendChatAction, SendMessage
from aiogram.methods.base import TelegramMethod
from aiogram.types import CallbackQuery, Chat, Message, Update, User

from bot.handlers import AccessMiddleware, create_router
from bot.storage import DreamStorage

OWNER_ID = 111
STRANGER_ID = 999


class FakeSession(BaseSession):
    """Сессия, которая не ходит в Telegram, а запоминает запросы."""

    def __init__(self) -> None:
        super().__init__()
        self.requests: list[TelegramMethod] = []

    async def make_request(self, bot: Bot, method: TelegramMethod, timeout: Any = None) -> Any:
        self.requests.append(method)
        if isinstance(method, (SendMessage, EditMessageText)):
            return Message(
                message_id=1,
                date=datetime.now(),
                chat=Chat(id=method.chat_id or 1, type="private"),
                text=method.text,
            )
        if isinstance(method, (SendChatAction, AnswerCallbackQuery)):
            return True
        return True

    async def close(self) -> None:
        pass

    async def stream_content(self, *args: Any, **kwargs: Any):  # pragma: no cover
        yield b""

    @property
    def sent_texts(self) -> list[str]:
        return [r.text for r in self.requests if isinstance(r, (SendMessage, EditMessageText))]


class FakeInterpreter:
    def __init__(self, reply: str = "Толкование сна.", error: Exception | None = None) -> None:
        self.reply = reply
        self.error = error
        self.delay = 0.0
        self.calls: list[str] = []

    async def interpret(self, dream_text: str) -> str:
        self.calls.append(dream_text)
        await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return self.reply


_ids = itertools.count(1)


def make_message_update(user_id: int, text: str | None = None, **extra: Any) -> Update:
    user = User(id=user_id, is_bot=False, first_name="Test")
    message = Message(
        message_id=next(_ids),
        date=datetime.now(),
        chat=Chat(id=user_id, type="private"),
        from_user=user,
        text=text,
        **extra,
    )
    return Update(update_id=next(_ids), message=message)


def make_callback_update(user_id: int, data: str) -> Update:
    user = User(id=user_id, is_bot=False, first_name="Test")
    message = Message(
        message_id=next(_ids),
        date=datetime.now(),
        chat=Chat(id=user_id, type="private"),
        text="?",
    )
    callback = CallbackQuery(
        id=str(next(_ids)), from_user=user, chat_instance="ci", data=data, message=message
    )
    return Update(update_id=next(_ids), callback_query=callback)


class Harness:
    def __init__(self, storage: DreamStorage, interpreter: FakeInterpreter, allowed) -> None:
        self.session = FakeSession()
        self.bot = Bot(token="42:TEST", session=self.session)
        self.storage = storage
        self.interpreter = interpreter
        self.dp = Dispatcher()
        access = AccessMiddleware(frozenset(allowed))
        self.dp.message.outer_middleware(access)
        self.dp.callback_query.outer_middleware(access)
        self.dp.include_router(create_router(storage, interpreter))

    async def send(self, update: Update) -> list[str]:
        before = len(self.session.sent_texts)
        await self.dp.feed_update(self.bot, update)
        return self.session.sent_texts[before:]


@pytest.fixture
async def storage(tmp_path):
    s = DreamStorage(tmp_path / "test.db")
    await s.init()
    return s


@pytest.fixture
def interpreter():
    return FakeInterpreter()


@pytest.fixture
def harness(storage, interpreter):
    return Harness(storage, interpreter, allowed={OWNER_ID})
