import { comparisonKey } from "./text.js";

export const BRAZIL_STATES: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

const BY_NAME = new Map<string, string>(
  Object.entries(BRAZIL_STATES).map(([uf, name]) => [comparisonKey(name), uf]),
);
// Common alternative spellings.
BY_NAME.set("distrito federal brasilia", "DF");
BY_NAME.set("brasilia", "DF");

/** Converts "são paulo", "SP", " sp " to "SP". Returns null when not recognized. */
export function normalizeState(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (upper.length === 2 && BRAZIL_STATES[upper]) return upper;
  const key = comparisonKey(raw);
  return BY_NAME.get(key) ?? null;
}
