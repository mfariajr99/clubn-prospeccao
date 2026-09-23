/// <reference lib="webworker" />
import { parseSpreadsheet } from "../lib/spreadsheet";

self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; filename: string }>) => {
  try {
    const result = parseSpreadsheet(event.data.buffer, event.data.filename);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "Não foi possível ler o arquivo." });
  }
};
