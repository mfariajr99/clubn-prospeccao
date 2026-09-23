// WhatsApp number normalization. Output is digits only, with country code,
// ready to be used in https://wa.me/<digits>.

const BRAZIL_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44,
  45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81,
  82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export type PhoneResult =
  | { ok: true; digits: string; country: "BR" | "INTL"; display: string }
  | { ok: false; error: string; digits: string };

function isValidBrazilianNational(national: string): boolean {
  // national = DDD (2) + subscriber (8 or 9)
  if (national.length !== 10 && national.length !== 11) return false;
  const ddd = Number(national.slice(0, 2));
  if (!BRAZIL_DDDS.has(ddd)) return false;
  const subscriber = national.slice(2);
  if (subscriber.length === 9) return subscriber.startsWith("9"); // mobile
  return /^[2-5]/.test(subscriber); // landline (WhatsApp Business also works on landlines)
}

function formatBrazil(digits: string): string {
  const ddd = digits.slice(2, 4);
  const sub = digits.slice(4);
  const split = sub.length === 9 ? 5 : 4;
  return `+55 (${ddd}) ${sub.slice(0, split)}-${sub.slice(split)}`;
}

/**
 * Normalizes a phone typed by a human or read from a spreadsheet.
 * - removes spaces, dashes, parentheses, dots and other symbols
 * - accepts "+", "00" international prefixes and a leading trunk "0"
 * - Brazilian numbers without country code receive "55"
 */
export function normalizePhone(input: unknown): PhoneResult {
  if (input === null || input === undefined) return { ok: false, error: "WhatsApp não informado.", digits: "" };
  let raw = String(input).trim();
  // Spreadsheets sometimes turn numbers into floats ("5511999990000.0") or scientific notation.
  if (/^\d+\.0+$/.test(raw)) raw = raw.replace(/\.0+$/, "");
  if (/^\d(\.\d+)?e\+\d+$/i.test(raw)) raw = BigInt(Math.round(Number(raw))).toString();
  if (!raw) return { ok: false, error: "WhatsApp não informado.", digits: "" };

  const hasPlus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!digits) return { ok: false, error: "WhatsApp não informado.", digits: "" };

  let explicitInternational = hasPlus;
  if (!hasPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
    explicitInternational = true;
  }

  if (explicitInternational) {
    if (digits.startsWith("55")) {
      if (isValidBrazilianNational(digits.slice(2))) {
        return { ok: true, digits, country: "BR", display: formatBrazil(digits) };
      }
      return { ok: false, error: "Número de WhatsApp inválido.", digits };
    }
    if (digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0")) {
      return { ok: true, digits, country: "INTL", display: `+${digits}` };
    }
    return { ok: false, error: "Número de WhatsApp inválido.", digits };
  }

  // Leading trunk zero: 011 99999-0000
  if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) digits = digits.slice(1);

  if (digits.length === 10 || digits.length === 11) {
    if (isValidBrazilianNational(digits)) {
      const full = `55${digits}`;
      return { ok: true, digits: full, country: "BR", display: formatBrazil(full) };
    }
    return { ok: false, error: "Número de WhatsApp inválido.", digits };
  }
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    if (isValidBrazilianNational(digits.slice(2))) {
      return { ok: true, digits, country: "BR", display: formatBrazil(digits) };
    }
    return { ok: false, error: "Número de WhatsApp inválido.", digits };
  }
  if (digits.length < 10) return { ok: false, error: "Número de WhatsApp incompleto.", digits };
  return {
    ok: false,
    error: "Número de WhatsApp inválido. Para números estrangeiros, informe o código do país com +.",
    digits,
  };
}

export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return "";
  const result = normalizePhone(digits.startsWith("+") ? digits : `+${digits}`);
  return result.ok ? result.display : digits;
}
