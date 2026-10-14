from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from bot.interpreter import GeminiInterpreter, InterpreterError


def make_client(side_effect):
    generate = AsyncMock(side_effect=side_effect)
    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate)))
    return client, generate


def make_interpreter(client, fallback=None):
    return GeminiInterpreter(
        api_key="x",
        model="test-model",
        system_prompt="SYS",
        fallback_model=fallback,
        client=client,
        retry_delay=0,
    )


async def test_success_passes_prompt_and_model():
    client, generate = make_client([SimpleNamespace(text="  ответ  ")])
    result = await make_interpreter(client).interpret("сон")
    assert result == "ответ"
    kwargs = generate.call_args.kwargs
    assert kwargs["model"] == "test-model"
    assert kwargs["contents"] == "сон"
    assert kwargs["config"].system_instruction == "SYS"


async def test_callable_prompt_is_built_per_dream():
    client, generate = make_client([SimpleNamespace(text="a"), SimpleNamespace(text="b")])
    counter = iter(["P1", "P2"])
    interp = GeminiInterpreter(
        api_key="x", model="m", system_prompt=lambda: next(counter), client=client, retry_delay=0
    )
    await interp.interpret("1")
    await interp.interpret("2")
    prompts = [c.kwargs["config"].system_instruction for c in generate.call_args_list]
    assert prompts == ["P1", "P2"]


async def test_retries_once_then_succeeds():
    client, generate = make_client([RuntimeError("503"), SimpleNamespace(text="ок")])
    assert await make_interpreter(client).interpret("сон") == "ок"
    assert generate.call_count == 2


async def test_fails_after_one_retry():
    responses = [RuntimeError("a"), RuntimeError("b"), SimpleNamespace(text="x")]
    client, generate = make_client(responses)
    with pytest.raises(InterpreterError):
        await make_interpreter(client).interpret("сон")
    assert generate.call_count == 2


async def test_empty_response_counts_as_error():
    client, generate = make_client([SimpleNamespace(text=None), SimpleNamespace(text="")])
    with pytest.raises(InterpreterError):
        await make_interpreter(client).interpret("сон")
    assert generate.call_count == 2


async def test_retry_uses_fallback_model():
    client, generate = make_client([RuntimeError("503"), SimpleNamespace(text="ок")])
    assert await make_interpreter(client, fallback="spare").interpret("сон") == "ок"
    models = [c.kwargs["model"] for c in generate.call_args_list]
    assert models == ["test-model", "spare"]
