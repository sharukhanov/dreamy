import { describe, expect, it } from "vitest";
import { stripMarkup, toTelegramHtml } from "../src/format.js";

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

  it("stripMarkup", () => {
    expect(stripMarkup("✨ **Мысль**")).toBe("✨ Мысль");
  });
});
