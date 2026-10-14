import { describe, expect, it } from "vitest";
import { normalizeLayout, stripMarkup, toTelegramHtml } from "../src/format.js";

describe("форматирование", () => {
  it("жирный текст и экранирование", () => {
    expect(toTelegramHtml("**a & b** <x>")).toBe("<b>a &amp; b</b> &lt;x&gt;");
  });
  it("непарные звёздочки убираются, а не ломают разметку", () => {
    expect(toTelegramHtml("**начало без конца")).toBe("начало без конца");
  });
  it("главная мысль всегда жирная", () => {
    expect(toTelegramHtml("✨ Мысль без звёздочек\n\n📖 x")).toBe("✨ <b>Мысль без звёздочек</b>\n\n📖 x");
    expect(toTelegramHtml("✨ **Уже жирная**")).toBe("✨ <b>Уже жирная</b>");
  });

  it("выравнивает заголовки и строку про реальную жизнь", () => {
    const raw = "✨ **Мысль**\n\n🏠 **Из реальная жизнь** — так мозг дожёвывает стресс.\n\n📖 Сонники\n• **Лофф** — x\n\n🧠 **Психология:**\n• **Юнг** — y";
    expect(normalizeLayout(raw)).toBe(
      "✨ **Мысль**\n\n🏠 Так мозг дожёвывает стресс.\n\n📖 **Сонники**\n• **Лофф** — x\n\n🧠 **Психология**\n• **Юнг** — y",
    );
    expect(normalizeLayout("🏠 Из реальной жизни — возможно, вы устали.")).toBe("🏠 Возможно, вы устали.");
    expect(normalizeLayout("🏠 Если недавно было похожее")).toBe("🏠 Если недавно было похожее");
  });

  it("добавляет 🏠, если модель его забыла", () => {
    expect(normalizeLayout("✨ **М**\n\nВозможно, это стресс.\n\n📖 **Сонники**")).toBe(
      "✨ **М**\n\n🏠 Возможно, это стресс.\n\n📖 **Сонники**",
    );
    expect(normalizeLayout("🤔 Расскажите подробнее?")).toBe("🤔 Расскажите подробнее?");
  });

  it("stripMarkup", () => {
    expect(stripMarkup("✨ **Мысль**")).toBe("✨ Мысль");
  });
});
