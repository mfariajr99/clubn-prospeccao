import type { ParsedSheet } from "./spreadsheetConstants";

/** Reads the file off the main thread (Web Worker). Falls back to the main thread when workers are unavailable. */
export async function readSpreadsheet(file: File): Promise<ParsedSheet> {
  const buffer = await file.arrayBuffer();
  if (typeof Worker === "undefined") {
    const { parseSpreadsheet } = await import("./spreadsheet");
    return parseSpreadsheet(buffer, file.name);
  }
  // Inline worker (blob: URL): self-contained, works in any hosting, keeps the UI responsive.
  const { default: SpreadsheetWorker } = await import("../workers/parseSpreadsheet.worker.ts?worker&inline");
  return new Promise<ParsedSheet>((resolve, reject) => {
    const worker = new SpreadsheetWorker();
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("A leitura do arquivo demorou demais."));
    }, 60000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: ParsedSheet; error?: string }>) => {
      window.clearTimeout(timer);
      worker.terminate();
      if (event.data.ok && event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? "Não foi possível ler o arquivo."));
    };
    worker.onerror = () => {
      window.clearTimeout(timer);
      worker.terminate();
      reject(new Error("Não foi possível ler o arquivo."));
    };
    worker.postMessage({ buffer, filename: file.name }, [buffer]);
  });
}

export async function downloadTemplate(): Promise<void> {
  const { buildTemplateWorkbook } = await import("./spreadsheet");
  const blob = new Blob([buildTemplateWorkbook()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "modelo-importacao-prospects-clubn.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
