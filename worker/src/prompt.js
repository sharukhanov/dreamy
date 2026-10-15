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

// Сонники, выбранные человеком (по имени, не больше лимита); пусто — значит случайные.
export function chosenBooks(traditions, names) {
  const wanted = new Set(names || []);
  return traditions.dream_books.filter((b) => wanted.has(b.name)).slice(0, traditions.pick.dream_books);
}

// Возвращает функцию, которая при каждом вызове собирает промт: выбранные сонники
// (если человек их выбрал) или случайные, а психологические подходы — всегда случайные.
export function createPromptBuilder(template, yamlText, random = Math.random) {
  const traditions = parseTraditions(yamlText);
  return ({ dreamBooks } = {}) => {
    const chosen = chosenBooks(traditions, dreamBooks);
    const books = chosen.length ? chosen : pickRandom(traditions.dream_books, traditions.pick.dream_books, random);
    return template
      .replace("{{DREAM_BOOKS}}", formatSection(books))
      .replace(
        "{{PSYCHOLOGY}}",
        formatSection(pickRandom(traditions.psychology, traditions.pick.psychology, random)),
      );
  };
}

export function buildSystemPrompt(template, yamlText, random = Math.random) {
  return createPromptBuilder(template, yamlText, random)();
}
