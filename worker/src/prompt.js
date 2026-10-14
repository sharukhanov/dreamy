// Сборка системного промта из prompts/interpreter.md и config/traditions.yaml.
import { load } from "js-yaml";

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
  return result;
}

function formatSection(items) {
  return items
    .map((item) => {
      let line = `- ${item.name}`;
      if (item.mention) line += ` (называй так: «${item.mention}»)`;
      if (item.description) line += `: ${String(item.description).split(/\s+/).join(" ").trim()}`;
      return line;
    })
    .join("\n");
}

export function buildSystemPrompt(template, yamlText) {
  const traditions = parseTraditions(yamlText);
  return template
    .replace("{{DREAM_BOOKS}}", formatSection(traditions.dream_books))
    .replace("{{PSYCHOLOGY}}", formatSection(traditions.psychology));
}
