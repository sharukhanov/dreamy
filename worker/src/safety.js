// Локальная страховка поверх промта: явные слова о самоубийстве или самоповреждении.

const CRISIS_PATTERNS = [
  "суицид",
  "самоубийств",
  "покончить\\s+с\\s+собой",
  "убить\\s+себя",
  "убью\\s+себя",
  "не\\s+хочу\\s+(больше\\s+)?жить",
  "не\\s+хочется\\s+жить",
  "хочу\\s+умереть",
  "лучше\\s+бы\\s+(я\\s+)?(умер|умерла|не\\s+жил)",
  "режу\\s+себя",
  "резать\\s+себя",
  "порезать\\s+себя",
  "причинить\\s+себе\\s+вред",
  "самоповрежд",
  "селфхарм",
  "\\bsuicid",
  "kill\\s+myself",
  "want\\s+to\\s+die",
  "end\\s+my\\s+life",
  "self[-\\s]?harm",
  "hurt\\s+myself",
];

const CRISIS_RE = new RegExp(CRISIS_PATTERNS.join("|"), "iu");

export function looksLikeCrisis(text) {
  return CRISIS_RE.test(text.replace(/ё/g, "е").replace(/Ё/g, "Е"));
}
