from aiogram.methods import SendChatAction
from aiogram.types import Voice

from bot import texts
from bot.handlers import FORGET_NO_DATA, FORGET_YES_DATA
from bot.interpreter import InterpreterError
from bot.safety import CRISIS_REPLY
from tests.conftest import (
    OWNER_ID,
    STRANGER_ID,
    Harness,
    make_callback_update,
    make_message_update,
)

DREAM = "Мне снилось, что я падаю с высокой башни, а внизу шумит море."


async def test_dream_is_interpreted_and_saved(harness):
    replies = await harness.send(make_message_update(OWNER_ID, DREAM))
    assert replies == ["Толкование сна."]
    assert harness.interpreter.calls == [DREAM]
    records = await harness.storage.latest(OWNER_ID)
    assert len(records) == 1
    assert records[0].dream_text == DREAM
    assert records[0].interpretation == "Толкование сна."


async def test_typing_indicator_is_sent(harness):
    harness.interpreter.delay = 0.05
    await harness.send(make_message_update(OWNER_ID, DREAM))
    actions = [r for r in harness.session.requests if isinstance(r, SendChatAction)]
    assert actions and actions[0].action == "typing"


async def test_stranger_is_refused(harness):
    replies = await harness.send(make_message_update(STRANGER_ID, DREAM))
    assert replies == [texts.NOT_ALLOWED]
    assert harness.interpreter.calls == []


async def test_setup_mode_reports_user_id(storage, interpreter):
    h = Harness(storage, interpreter, allowed=set())
    replies = await h.send(make_message_update(12345, DREAM))
    assert len(replies) == 1
    assert "Ваш Telegram id: 12345" in replies[0]
    assert interpreter.calls == []


async def test_non_text_message(harness):
    voice = Voice(file_id="f", file_unique_id="u", duration=3)
    replies = await harness.send(make_message_update(OWNER_ID, None, voice=voice))
    assert replies == [texts.ONLY_TEXT]


async def test_too_long_dream(harness):
    replies = await harness.send(make_message_update(OWNER_ID, "а" * 4001))
    assert len(replies) == 1
    assert "4001" in replies[0] and "4000" in replies[0]
    assert harness.interpreter.calls == []


async def test_exactly_max_length_is_accepted(harness):
    await harness.send(make_message_update(OWNER_ID, "а" * 4000))
    assert len(harness.interpreter.calls) == 1


async def test_crisis_message_skips_interpretation(harness):
    replies = await harness.send(
        make_message_update(OWNER_ID, "Снилась тьма, и я не хочу больше жить")
    )
    assert replies == [CRISIS_REPLY]
    assert harness.interpreter.calls == []
    assert await harness.storage.latest(OWNER_ID) == []


async def test_api_error_shows_friendly_message(harness):
    harness.interpreter.error = InterpreterError("boom")
    replies = await harness.send(make_message_update(OWNER_ID, DREAM))
    assert replies == [texts.API_ERROR]
    assert await harness.storage.latest(OWNER_ID) == []


async def test_start_and_help(harness):
    assert await harness.send(make_message_update(OWNER_ID, "/start")) == [texts.START]
    help_reply = await harness.send(make_message_update(OWNER_ID, "/help"))
    assert help_reply == [texts.HELP]
    assert "не медицинский совет" in help_reply[0]


async def test_history_empty(harness):
    assert await harness.send(make_message_update(OWNER_ID, "/history")) == [texts.HISTORY_EMPTY]


async def test_history_shows_last_five(harness):
    for i in range(7):
        await harness.storage.add(OWNER_ID, f"сон {i}", f"толкование {i}")
    await harness.storage.add(STRANGER_ID, "чужой сон", "чужое")
    replies = await harness.send(make_message_update(OWNER_ID, "/history"))
    assert replies[0] == texts.HISTORY_HEADER.format(count=5)
    body = replies[1:]
    assert len(body) == 5
    assert "<i>сон 2</i>" in body[0] and "сон 6" in body[-1]
    assert not any("чужой" in r for r in body)


async def test_forget_requires_confirmation(harness):
    await harness.storage.add(OWNER_ID, "сон", "толкование")
    replies = await harness.send(make_message_update(OWNER_ID, "/forget"))
    assert replies == [texts.FORGET_CONFIRM]
    assert len(await harness.storage.latest(OWNER_ID)) == 1

    replies = await harness.send(make_callback_update(OWNER_ID, FORGET_NO_DATA))
    assert replies == [texts.FORGET_CANCELLED]
    assert len(await harness.storage.latest(OWNER_ID)) == 1

    replies = await harness.send(make_callback_update(OWNER_ID, FORGET_YES_DATA))
    assert replies == [texts.FORGET_DONE.format(count=1)]
    assert await harness.storage.latest(OWNER_ID) == []


async def test_stranger_cannot_forget(harness):
    await harness.storage.add(OWNER_ID, "сон", "толкование")
    await harness.send(make_callback_update(STRANGER_ID, FORGET_YES_DATA))
    assert len(await harness.storage.latest(OWNER_ID)) == 1


async def test_bold_main_thought_is_html(harness):
    harness.interpreter.reply = "✨ **Главное** <x>"
    replies = await harness.send(make_message_update(OWNER_ID, DREAM))
    assert replies == ["✨ <b>Главное</b> &lt;x&gt;"]
