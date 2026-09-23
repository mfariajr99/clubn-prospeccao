import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { applyMapping, autoMapColumns } from "../../shared/importMapping";
import { parseSpreadsheet } from "../../src/lib/spreadsheet";
import { setup, validLead } from "./helpers";

const HEADERS = ["Estabelecimento", "Categoria", "Bairro", "Município", "UF", "Celular", "Instagram"];
const ROWS: (string | number)[][] = [
  ["Loja Alfa Fictícia", "Varejo", "Centro", "campinas", "sp", "(19) 90000-0001", "@loja.alfa.demo"],
  ["Loja Beta Fictícia", "Varejo", "Cambuí", "Campinas", "São Paulo", 19900000002, "https://beta.example.com"],
  ["", "Varejo", "Centro", "Campinas", "SP", "19 90000-0003", ""], // no name
  ["Loja Delta Fictícia", "Varejo", "Centro", "Campinas", "SP", "", ""], // no phone
  ["Loja Épsilon Fictícia", "Varejo", "Centro", "Campinas", "XX", "19 90000-0005", "javascript:alert(1)"], // bad state + URL
  ["Loja Alfa Repetida", "Varejo", "Centro", "Campinas", "SP", "+55 19 90000-0001", ""], // same phone as row 2
  ["Loja Zeta Fictícia", "Varejo", "Centro", "Campinas", "SP", "12345", ""], // invalid phone
];

function workbook(bookType: XLSX.BookType): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, ...ROWS]), "Planilha");
  const out = XLSX.write(wb, { type: "array", bookType });
  return out as ArrayBuffer;
}

function toRows(buffer: ArrayBuffer, filename: string) {
  const parsed = parseSpreadsheet(buffer, filename);
  const { mapping, needsReview } = autoMapColumns(parsed.headers);
  expect(needsReview).toBe(false);
  return applyMapping(parsed.rows, mapping, parsed.firstRowNumber);
}

describe("leitura de planilhas", () => {
  it.each([
    ["prospects.xlsx", "xlsx"],
    ["prospects.xls", "biff8"],
  ] as const)("lê %s", (filename, type) => {
    const rows = toRows(workbook(type as XLSX.BookType), filename);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ rowNumber: 2, values: { establishment_name: "Loja Alfa Fictícia", city: "campinas", whatsapp: "(19) 90000-0001" } });
    // numeric phone cell keeps all digits
    expect(rows[1].values.whatsapp).toBe("19900000002");
  });

  it("lê .csv com ; e acentos (UTF-8 e Windows-1252)", () => {
    const csv = "nome;segmento;cidade;estado;whatsapp;link\nPadaria São João Fictícia;Padaria;São Paulo;SP;11 90000-0101;padaria.example.com\n";
    const utf8 = new TextEncoder().encode(csv);
    const rows = toRows(utf8.buffer as ArrayBuffer, "lista.csv");
    expect(rows[0].values).toMatchObject({ establishment_name: "Padaria São João Fictícia", city: "São Paulo", whatsapp: "11 90000-0101" });
    const latin1 = Uint8Array.from([...csv].map((c) => c.charCodeAt(0)));
    expect(toRows(latin1.buffer as ArrayBuffer, "lista.csv")[0].values.city).toBe("São Paulo");
  });

  it("lê .csv com vírgula e zeros à esquerda preservados", () => {
    const csv = "Nome do estabelecimento,Cidade,UF,Telefone\nBar Fictício,Recife,PE,081 90000-0001\n";
    const rows = toRows(new TextEncoder().encode(csv).buffer as ArrayBuffer, "a.csv");
    expect(rows[0].values.whatsapp).toBe("081 90000-0001");
  });

  it("rejeita formato não suportado e arquivo vazio", () => {
    expect(() => parseSpreadsheet(new ArrayBuffer(10), "a.pdf")).toThrow(/Formato não suportado/);
    expect(() => parseSpreadsheet(new ArrayBuffer(0), "a.csv")).toThrow(/vazio/);
  });
});

describe("importação de prospects", () => {
  const rows = () => toRows(workbook("xlsx"), "prospects.xlsx");

  it("a análise mostra a prévia e não grava nada", async () => {
    const { agent, db } = setup();
    const res = await agent.post("/api/imports/analyze").send({ filename: "prospects.xlsx", rows: rows() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalRows: 7, validRows: 3, invalidRows: 4, duplicateRows: 1 });
    const messages = res.body.rows.flatMap((r: { errors: string[] }) => r.errors);
    expect(messages).toEqual(
      expect.arrayContaining([
        "Linha 4: nome do estabelecimento não informado.",
        "Linha 5: WhatsApp não informado.",
        "Linha 6: estado não reconhecido.",
        "Linha 6: URL inválida.",
        "Linha 8: número de WhatsApp inválido.",
      ]),
    );
    expect(res.body.rows[5].duplicate).toMatchObject({ kind: "sheet_phone", firstRowNumber: 2 });
    for (const table of ["leads", "import_batches", "campaign_leads", "contact_history"]) {
      expect((db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c).toBe(0);
    }
  });

  it("exige confirmação explícita", async () => {
    const { agent } = setup();
    const res = await agent.post("/api/imports/commit").send({ filename: "p.xlsx", rows: rows(), duplicate_action: "skip" });
    expect(res.status).toBe(400);
  });

  it("importa linhas válidas mesmo com linhas inválidas e registra o lote", async () => {
    const { agent, db } = setup();
    const res = await agent.post("/api/imports/commit").send({ filename: "prospects.xlsx", rows: rows(), confirmed: true, duplicate_action: "skip" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ imported_rows: 2, updated_rows: 0, skipped_rows: 1, error_rows: 4, duplicate_rows: 1, status: "completed_with_errors", imported_by: 1, original_filename: "prospects.xlsx" });
    const leads = db.prepare("SELECT * FROM leads ORDER BY id").all() as Record<string, unknown>[];
    expect(leads).toHaveLength(2);
    expect(leads[0]).toMatchObject({ registration_status: "prospect", source: "import", import_batch_id: res.body.id, city: "Campinas", state: "SP", whatsapp: "5519900000001", created_by: 1 });
    expect(leads[1]).toMatchObject({ state: "SP", whatsapp: "5519900000002" });
    // import never touches contacts/messages
    expect((db.prepare("SELECT COUNT(*) c FROM contact_history").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) c FROM campaign_leads").get() as { c: number }).c).toBe(0);

    const history = (await agent.get("/api/imports")).body;
    expect(history.items[0]).toMatchObject({ id: res.body.id, total_rows: 7, imported_rows: 2, error_rows: 4, imported_by_name: "Thomaz" });
    const csv = await agent.get(`/api/imports/${res.body.id}/report.csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("Linha;Nome do estabelecimento");
    expect(csv.text).toContain("5;Loja Delta Fictícia");
    expect(csv.text).toContain("Linha 5: WhatsApp não informado.");
    expect(csv.text).toContain("importado");
    expect(csv.text).toContain("'javascript:alert(1)".replace("'", "")); // raw value kept in the report
  });

  it("identifica duplicidade com base existente e importação anterior; ignora sem sobrescrever", async () => {
    const { agent, db } = setup();
    await agent.post("/api/leads").send(validLead({ establishment_name: "Nome Original", whatsapp: "19 90000-0001", city: "Campinas", state: "SP" })).expect(201);
    const analysis = (await agent.post("/api/imports/analyze").send({ filename: "p.xlsx", rows: rows() })).body;
    expect(analysis.rows[0].duplicate).toMatchObject({ kind: "existing_phone", existingLeadId: 1 });
    await agent.post("/api/imports/commit").send({ filename: "p.xlsx", rows: rows(), confirmed: true, duplicate_action: "skip" }).expect(201);
    expect((db.prepare("SELECT establishment_name FROM leads WHERE id = 1").get() as { establishment_name: string }).establishment_name).toBe("Nome Original");

    // second import of the same file: everything valid is now a duplicate of a previous import
    const again = (await agent.post("/api/imports/analyze").send({ filename: "p.xlsx", rows: rows() })).body;
    expect(again.rows[1].duplicate.kind).toBe("existing_phone");
    expect(again.rows[1].duplicate.message).toMatch(/importação anterior, lote #1/);
  });

  it("atualiza registro existente somente com a escolha do usuário", async () => {
    const { agent, db } = setup();
    await agent.post("/api/leads").send(validLead({ establishment_name: "Nome Original", segment: "", whatsapp: "19 90000-0001", city: "Campinas", state: "SP", digital_presence_url: "" })).expect(201);
    // review mode without decision -> skipped
    const review = await agent.post("/api/imports/commit").send({ filename: "p.xlsx", rows: rows(), confirmed: true, duplicate_action: "review" });
    expect(review.body.updated_rows).toBe(0);
    // explicit per-row decision -> updated
    const decided = await agent.post("/api/imports/commit").send({ filename: "p.xlsx", rows: rows(), confirmed: true, duplicate_action: "review", decisions: { "2": "update" } });
    expect(decided.body.updated_rows).toBe(1);
    const lead = db.prepare("SELECT * FROM leads WHERE id = 1").get() as Record<string, unknown>;
    expect(lead).toMatchObject({ establishment_name: "Loja Alfa Fictícia", segment: "Varejo", digital_presence_type: "instagram", registration_status: "prospect" });
    // the updated lead appears when filtering by the batch
    const byBatch = (await agent.get(`/api/leads?batch_id=${decided.body.id}`)).body;
    expect(byBatch.items.map((l: { id: number }) => l.id)).toContain(1);
  });

  it("modo 'atualizar' aplica a todos os duplicados existentes", async () => {
    const { agent } = setup();
    await agent.post("/api/leads").send(validLead({ whatsapp: "19 90000-0002", city: "Campinas", state: "SP" })).expect(201);
    const res = await agent.post("/api/imports/commit").send({ filename: "p.xlsx", rows: rows(), confirmed: true, duplicate_action: "update" });
    expect(res.body).toMatchObject({ imported_rows: 1, updated_rows: 1 });
  });

  it("prospects importados podem ser filtrados pelo lote e adicionados a campanhas", async () => {
    const { agent, db } = setup();
    await agent.post("/api/leads").send(validLead()).expect(201); // outside the batch
    const batch = (await agent.post("/api/imports/commit").send({ filename: "p.xlsx", rows: rows(), confirmed: true, duplicate_action: "skip" })).body;
    const filtered = (await agent.get(`/api/leads?batch_id=${batch.id}&city=Campinas&state=SP&segment=Varejo`)).body;
    expect(filtered.total).toBe(2);

    // new campaign straight from the batch filter
    const created = await agent.post("/api/campaigns").send({ name: "Lote Campinas", message_template: "Olá {{nome_estabelecimento}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}", lead_filter: { batch_id: batch.id } });
    expect(created.status).toBe(201);
    expect(created.body.lead_count).toBe(2);
    expect(created.body.contacted_count).toBe(0); // inclusion is not contact

    // existing campaign: add the batch (duplicates ignored)
    const existing = (await agent.post("/api/campaigns").send({ name: "Existente", message_template: "Oi {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}" })).body;
    const added = await agent.post(`/api/campaigns/${existing.id}/leads`).send({ filter: { batch_id: String(batch.id) } });
    expect(added.body).toEqual({ added: 2, alreadyInCampaign: 0 });
    const again = await agent.post(`/api/campaigns/${existing.id}/leads`).send({ filter: { batch_id: batch.id } });
    expect(again.body).toEqual({ added: 0, alreadyInCampaign: 2 });
    // nothing was contacted or queued
    expect((db.prepare("SELECT COUNT(*) c FROM contact_history").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) c FROM campaign_leads WHERE contact_status <> 'not_contacted'").get() as { c: number }).c).toBe(0);
  });

  it("suporta milhares de linhas", async () => {
    const { agent, db } = setup();
    const big = Array.from({ length: 3000 }, (_, i) => ({
      rowNumber: i + 2,
      values: {
        establishment_name: `Loja Fictícia ${i}`,
        segment: "Varejo",
        neighborhood: "",
        city: "Campinas",
        state: "SP",
        whatsapp: `19 9${String(1000000 + i).padStart(8, "0")}`,
        digital_presence_url: "",
        extra_link: "",
      },
    }));
    const started = Date.now();
    const res = await agent.post("/api/imports/commit").send({ filename: "grande.csv", rows: big, confirmed: true, duplicate_action: "skip" });
    expect(res.status).toBe(201);
    expect(res.body.imported_rows).toBe(3000);
    expect(Date.now() - started).toBeLessThan(10000);
    expect((db.prepare("SELECT COUNT(*) c FROM leads").get() as { c: number }).c).toBe(3000);
  });
});
