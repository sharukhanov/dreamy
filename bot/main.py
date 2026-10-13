"""Точка входа: запуск бота в режиме long polling."""

import asyncio
import logging
import sys

from aiogram import Bot, Dispatcher
from aiogram.types import BotCommand

from bot.config import PROJECT_ROOT, load_settings
from bot.handlers import AccessMiddleware, create_router
from bot.interpreter import GeminiInterpreter
from bot.prompt import build_system_prompt
from bot.storage import DreamStorage

LOG_DIR = PROJECT_ROOT / "logs"


def setup_logging() -> None:
    LOG_DIR.mkdir(exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(LOG_DIR / "bot.log", encoding="utf-8"),
        ],
    )
    # Сторонние библиотеки не должны писать в лог содержимое запросов.
    for noisy in ("httpx", "httpcore", "google_genai", "google.genai"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


async def run() -> None:
    settings = load_settings()
    log = logging.getLogger("bot")

    if not settings.setup_mode and not settings.gemini_api_key:
        raise RuntimeError("Не задан GEMINI_API_KEY в файле .env")

    storage = DreamStorage(settings.database_path)
    await storage.init()

    interpreter = GeminiInterpreter(
        api_key=settings.gemini_api_key or "unset",
        model=settings.gemini_model,
        system_prompt=build_system_prompt(),
    )

    bot = Bot(token=settings.telegram_token)
    dp = Dispatcher()
    access = AccessMiddleware(settings.allowed_user_ids)
    dp.message.outer_middleware(access)
    dp.callback_query.outer_middleware(access)
    dp.include_router(create_router(storage, interpreter))

    await bot.set_my_commands(
        [
            BotCommand(command="start", description="Начать"),
            BotCommand(command="help", description="Справка"),
            BotCommand(command="history", description="Последние 5 снов"),
            BotCommand(command="forget", description="Удалить все записи"),
        ]
    )

    me = await bot.get_me()
    if settings.setup_mode:
        log.info("Бот @%s запущен в РЕЖИМЕ НАСТРОЙКИ (ALLOWED_USER_IDS пуст)", me.username)
    else:
        log.info("Бот @%s запущен, модель %s", me.username, settings.gemini_model)

    await dp.start_polling(bot)


def main() -> None:
    setup_logging()
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
