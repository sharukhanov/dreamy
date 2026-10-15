// Сборка системного промта из prompts/interpreter.md и config/traditions.yaml.
// Для каждого сна случайно выбирается несколько традиций, чтобы ответы были разнообразными.
import { load } from "js-yaml";

const DEFAULT_PICK = { dream_books: 3, psychology: 2 };

export function parseTraditions(yamlText) {
  const data = load(yamlText) || {};
  const result = {};
  for (const section of ["dream_books", "psychology"]) {
    const items = data[section] || [];
    if (!items.length) throw new Error(`В traditions.yaml пустой раздел '${section}'`);
    for (const item of items) {
      if (!item?.name) throw new Error(`В traditions.yaml у традиции в '${section}' нет name`);
    }
    result[section] = items;
  }
  result.pick = {
    dream_books: Number(data.pick_dream_books) || DEFAULT_PICK.dream_books,
    psychology: Number(data.pick_psychology) || DEFAULT_PICK.psychology,
  };
  return result;
}

export function pickRandom(items, count, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(1, Math.min(count, copy.length)));
}

function formatSection(items) {
  return items
    .map((item) => {
      let line = `- ${item.name}`;
      if (item.label) line += ` (подпись в ответе: «${item.label}»)`;
      if (item.description) line += `: ${String(item.description).split(/\s+/).join(" ").trim()}`;
      return line;
    })
    .join("\n");
}

// Традиции, выбранные человеком (по имени, не больше лимита); пусто — значит случайные.
function chosenOrRandom(traditions, section, names, random) {
  const wanted = new Set(names || []);
  const chosen = traditions[section].filter((b) => wanted.has(b.name)).slice(0, traditions.pick[section]);
  return chosen.length ? chosen : pickRandom(traditions[section], traditions.pick[section], random);
}

// Режимы: both — сонники и психология, books — только сонники, psy — только психология.
export const MODES = ["both", "books", "psy"];

const MODE_RULES = {
  both: "- В этом ответе есть оба блока: 📖 Сонники и 🧠 Психология.",
  books:
    "- Человек выбрал режим «только сонники»: блока 🧠 Психология в ответе НЕ должно быть совсем. " +
    "Главная мысль — общий итог по сонникам. Строки сонников можно делать подробнее — до 25 слов.",
  psy:
    "- Человек выбрал режим «только психология»: блока 📖 Сонники в ответе НЕ должно быть совсем, " +
    "не упоминай сонники и приметы. Главная мысль — общий итог по психологии. " +
    "Строки психологии можно делать подробнее — до 25 слов.",
};

// Возвращает функцию, которая при каждом вызове собирает промт: выбранные человеком
// сонники и психологические подходы (а если не выбраны — случайные) с учётом режима.
export function createPromptBuilder(template, yamlText, random = Math.random) {
  const traditions = parseTraditions(yamlText);
  return ({ dreamBooks, psychology, mode } = {}) => {
    const m = MODES.includes(mode) ? mode : "both";
    const books = m === "psy" ? "(в этом режиме не используются)" : formatSection(chosenOrRandom(traditions, "dream_books", dreamBooks, random));
    const schools = m === "books" ? "(в этом режиме не используются)" : formatSection(chosenOrRandom(traditions, "psychology", psychology, random));
    return template
      .replace("{{MODE_RULES}}", MODE_RULES[m])
      .replace("{{DREAM_BOOKS}}", books)
      .replace("{{PSYCHOLOGY}}", schools);
  };
}

export function buildSystemPrompt(template, yamlText, random = Math.random) {
  return createPromptBuilder(template, yamlText, random)();
}
