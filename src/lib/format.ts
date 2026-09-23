import { formatPhone } from "../../shared/phone";

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const numberFmt = new Intl.NumberFormat("pt-BR");

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

export function fmtNumber(value: number | null | undefined): string {
  return numberFmt.format(value ?? 0);
}

export function fmtPhone(digits: string | null | undefined, valid = true): string {
  if (!digits) return "—";
  return valid ? formatPhone(digits) : digits;
}

export function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function location(lead: { neighborhood?: string | null; city?: string | null; state?: string | null }): string {
  const cityState = [lead.city, lead.state].filter(Boolean).join("/");
  return [lead.neighborhood, cityState].filter(Boolean).join(" · ");
}
