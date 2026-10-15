import { describe, expect, it } from "vitest";
import { applyMode, normalizeLayout, stripMarkup, toTelegramHtml } from "../src/format.js";

describe("форматирование", () => {
  it("жирный текст и экранирование", () => {
    expect(toTelegramHtml("**a & b** <x>")).toBe("<b>a &amp; b</b> &lt;x&gt;");
  });
  it("непарные звёздочки убираются, а не ломают разметку", () => {
    expect(toTelegramHtml("**начало без конца")).toBe("начало без конца");
  });
  it("главная мысль всегда жирная", () => {
    expect(toTelegramHtml("✨ Мысль без звёздочек\n\n📖 x")).toBe("✨ Если коротко: <b>Мысль без звёздочек</b>\n\n📖 x");
    expect(toTelegramHtml("✨ **Уже жирная**")).toBe("✨ Если коротко: <b>Уже жирная</b>");
    expect(toTelegramHtml("✨ **Главная мысль:** Итог.")).toBe("✨ Если коротко: <b>Итог.</b>");
  });

  it("выравнивает заголовки и строку про реальную жизнь", () => {
    const raw = "✨ **Мысль**\n\n🏠 **Из реальная жизнь** — так мозг дожёвывает стресс.\n\n📖 Сонники\n• **Лофф** — x\n\n🧠 **Психология:**\n• **Юнг** — y";
    expect(normalizeLayout(raw)).toBe(
      "✨ Если коротко: **Мысль**\n\n🏠 Так мозг дожёвывает стресс.\n\n📖 **Сонники**\n• **Лофф** — x\n\n🧠 **Психология**\n• **Юнг** — y",
    );
    expect(normalizeLayout("🏠 Из реальной жизни — возможно, вы устали.")).toBe("🏠 Возможно, вы устали.");
    expect(normalizeLayout("🏠 Если недавно было похожее")).toBe("🏠 Если недавно было похожее");
  });

  it("добавляет 🏠, если модель его забыла", () => {
    expect(normalizeLayout("✨ **М**\n\nВозможно, это стресс.\n\n📖 **Сонники**")).toBe(
      "✨ Если коротко: **М**\n\n🏠 Возможно, это стресс.\n\n📖 **Сонники**",
    );
    expect(normalizeLayout("🤔 Расскажите подробнее?")).toBe("🤔 Расскажите подробнее?");
  });

  it("выравнивает совет для сна", () => {
    expect(normalizeLayout("😴 Совет для сна: спите 7–9 часов.")).toBe("😴 **Совет для сна** — спите 7–9 часов.");
    expect(normalizeLayout("😴 **Совет для сна** — уберите телефон.")).toBe("😴 **Совет для сна** — уберите телефон.");
  });

  it("applyMode убирает лишний блок", () => {
    const t = "✨ М\n\n📖 **Сонники**\n• a\n\n🧠 **Психология**\n• b";
    expect(applyMode(t, "books")).toBe("✨ М\n\n📖 **Сонники**\n• a");
    expect(applyMode(t, "psy")).toBe("✨ М\n\n🧠 **Психология**\n• b");
    expect(applyMode(t, "both")).toBe(t);
  });

  it("stripMarkup", () => {
    expect(stripMarkup("✨ **Мысль**")).toBe("✨ Если коротко: Мысль");
  });
});
