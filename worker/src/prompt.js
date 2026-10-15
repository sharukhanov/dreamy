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

// Возвращает функцию, которая при каждом вызове собирает промт: выбранные человеком
// сонники и психологические подходы, а если не выбраны — случайные.
export function createPromptBuilder(template, yamlText, random = Math.random) {
  const traditions = parseTraditions(yamlText);
  return ({ dreamBooks, psychology } = {}) =>
    template
      .replace("{{DREAM_BOOKS}}", formatSection(chosenOrRandom(traditions, "dream_books", dreamBooks, random)))
      .replace("{{PSYCHOLOGY}}", formatSection(chosenOrRandom(traditions, "psychology", psychology, random)));
}

export function buildSystemPrompt(template, yamlText, random = Math.random) {
  return createPromptBuilder(template, yamlText, random)();
}
