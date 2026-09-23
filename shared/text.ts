// Text helpers: sanitization and normalization.

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\uFEFF]/g;

/** Removes control/invisible characters, HTML tags and collapses whitespace. */
export function sanitizeText(value: unknown, maxLength = 200): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  text = text.replace(CONTROL_CHARS, "");
  text = text.replace(/<[^>]*>/g, " ");
  text = text.replace(/[<>]/g, "");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > maxLength) text = text.slice(0, maxLength).trim();
  return text;
}

/** Lowercase, accent-free, punctuation-free key used for comparisons. */
export function comparisonKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LOWERCASE_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "d'"]);

/** "  SÃO   paulo " -> "São Paulo"; "rio DE janeiro" -> "Rio de Janeiro". */
export function normalizeCity(value: unknown): string {
  const text = sanitizeText(value, 120);
  if (!text) return "";
  return text
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((word, index) => {
      if (index > 0 && LOWERCASE_WORDS.has(word)) return word;
      return word
        .split("-")
        .map((part) => part.charAt(0).toLocaleUpperCase("pt-BR") + part.slice(1))
        .join("-");
    })
    .join(" ");
}

/** Normalizes free labels such as segment or neighborhood (trim + collapse, keeps casing). */
export function normalizeLabel(value: unknown, maxLength = 120): string {
  const text = sanitizeText(value, maxLength);
  if (!text) return "";
  // If the whole text is upper or lower case, title-case it for consistency.
  if (text === text.toUpperCase() || text === text.toLowerCase()) return normalizeCity(text);
  return text;
}
