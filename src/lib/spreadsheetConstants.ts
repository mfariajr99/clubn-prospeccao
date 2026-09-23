export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 10000;
export const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".csv"];

export interface ParsedSheet {
  headers: string[];
  /** Data rows (without the header). Blank rows are kept so line numbers match the file. */
  rows: string[][];
  /** Line number (1-based, as seen in Excel) of the first data row. */
  firstRowNumber: number;
  sheetName: string;
  sheetCount: number;
}

export function extensionOf(filename: string): string {
  const m = /\.[^.]+$/.exec(filename.toLowerCase());
  return m ? m[0] : "";
}
