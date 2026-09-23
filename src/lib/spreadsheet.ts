// Spreadsheet parsing (.xlsx, .xls, .csv) and template generation.
// Runs inside a Web Worker in the browser (see workers/) so large files do not freeze the UI.

import * as XLSX from "xlsx";

import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, MAX_ROWS, extensionOf, type ParsedSheet } from "./spreadsheetConstants";

export { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, MAX_ROWS, extensionOf, type ParsedSheet };

export class SpreadsheetError extends Error {}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return BigInt(value).toString(); // avoids 5.51199E+12 for phone numbers
    return String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes); // Excel "CSV" saved on Windows
  }
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [";", ",", "\t", "|"].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

export function parseSpreadsheet(data: ArrayBuffer, filename: string): ParsedSheet {
  const ext = extensionOf(filename);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) throw new SpreadsheetError("Formato não suportado. Envie um arquivo .xlsx, .xls ou .csv.");
  if (data.byteLength === 0) throw new SpreadsheetError("O arquivo está vazio.");
  if (data.byteLength > MAX_FILE_BYTES) throw new SpreadsheetError("Arquivo muito grande (limite de 10 MB). Divida a planilha.");

  let workbook: XLSX.WorkBook;
  try {
    if (ext === ".csv") {
      const text = decodeCsv(new Uint8Array(data));
      workbook = XLSX.read(text, { type: "string", raw: true, FS: detectDelimiter(text), dense: true });
    } else {
      workbook = XLSX.read(data, { type: "array", dense: true, cellDates: true, cellFormula: false, cellHTML: false });
    }
  } catch {
    throw new SpreadsheetError("Não foi possível ler o arquivo. Verifique se ele não está corrompido ou protegido por senha.");
  }
  const sheetName = workbook.SheetNames.find((name) => {
    const sheet = workbook.Sheets[name];
    return sheet && sheet["!ref"];
  });
  if (!sheetName) throw new SpreadsheetError("A planilha não possui dados.");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, blankrows: true, defval: "" });
  const headerIndex = matrix.findIndex((row) => row.some((c) => cellToString(c) !== ""));
  if (headerIndex < 0) throw new SpreadsheetError("A planilha não possui dados.");
  const headers = matrix[headerIndex].map((c, i) => cellToString(c) || `Coluna ${i + 1}`);
  const rows = matrix.slice(headerIndex + 1).map((row) => headers.map((_, i) => cellToString(row[i])));
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  if (rows.length === 0) throw new SpreadsheetError("A planilha não possui linhas de dados abaixo do cabeçalho.");
  if (rows.length > MAX_ROWS) throw new SpreadsheetError(`A planilha possui mais de ${MAX_ROWS.toLocaleString("pt-BR")} linhas. Divida o arquivo.`);
  return { headers, rows, firstRowNumber: headerIndex + 2, sheetName, sheetCount: workbook.SheetNames.length };
}

export const TEMPLATE_HEADERS = ["Nome do estabelecimento", "Segmento", "Bairro", "Cidade", "Estado", "WhatsApp", "Link"];

/** Template with correct headers, one fictitious example row and basic instructions. */
export function buildTemplateWorkbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ["Café Exemplo Fictício", "Cafeteria", "Centro", "Cidade Exemplo", "SP", "(11) 90000-0000", "@cafe.exemplo.ficticio"],
  ]);
  data["!cols"] = [{ wch: 32 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, data, "Prospects");
  const guide = XLSX.utils.aoa_to_sheet([
    ["Orientações de preenchimento"],
    [""],
    ["Coluna", "Obrigatório", "Como preencher"],
    ["Nome do estabelecimento", "Sim", "Nome comercial do estabelecimento."],
    ["Segmento", "Não", "Ex.: Restaurante, Academia, Pet shop."],
    ["Bairro", "Não", "Bairro do estabelecimento."],
    ["Cidade", "Sim", "Nome da cidade."],
    ["Estado", "Sim", "UF (SP) ou nome do estado (São Paulo)."],
    ["WhatsApp", "Sim", "DDD + número. O código 55 é adicionado automaticamente. Para outros países use +código."],
    ["Link", "Não", "Instagram (@perfil), site, Facebook, TikTok, Linktree, Google Maps ou outro endereço público."],
    [""],
    ["Dicas"],
    ["• Mantenha a primeira linha com os cabeçalhos. Substitua a linha de exemplo pelos seus dados."],
    ["• Linhas com erro não impedem a importação das demais; você verá o motivo antes de confirmar."],
    ["• Números de WhatsApp repetidos são identificados como duplicidade."],
    ["• A importação nunca envia mensagens."],
  ]);
  guide["!cols"] = [{ wch: 26 }, { wch: 12 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, guide, "Orientações");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
