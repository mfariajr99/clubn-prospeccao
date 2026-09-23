// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportProspects from "../../src/pages/ImportProspects";
import LeadForm from "../../src/pages/LeadForm";
import LeadsList from "../../src/pages/LeadsList";
import { mockFetch, renderWithProviders, sampleLead, setViewport } from "./utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("tela Cadastrar lead", () => {
  it("mostra erros claros nos campos obrigatórios e não envia", async () => {
    setViewport(false);
    const calls = mockFetch({});
    renderWithProviders(<LeadForm />);
    fireEvent.click(screen.getByRole("button", { name: "Salvar lead" }));
    expect(await screen.findByText("Nome do estabelecimento não informado.")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp não informado.")).toBeInTheDocument();
    expect(screen.getByText("Cidade não informada.")).toBeInTheDocument();
    expect(screen.getByText("Estado não informado.")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST" && c.url === "/api/leads")).toHaveLength(0);
  });

  it("mostra o WhatsApp normalizado e o tipo do link; envia uma única vez", async () => {
    setViewport(false);
    let resolveSave: (v: Response) => void = () => undefined;
    const calls = mockFetch({
      "POST /api/leads/check-duplicates": () => ({ phone: null, nameLocation: [] }),
      "POST /api/leads": () => new Promise<Response>((r) => (resolveSave = r)) as unknown as Response,
    });
    renderWithProviders(<LeadForm />);
    fireEvent.change(screen.getByLabelText(/Nome do estabelecimento/), { target: { value: "Café Fictício" } });
    fireEvent.change(screen.getByLabelText(/^Cidade/), { target: { value: "campinas" } });
    fireEvent.change(screen.getByLabelText(/^Estado/), { target: { value: "são paulo" } });
    fireEvent.change(screen.getByLabelText(/WhatsApp de contato/), { target: { value: "(19) 90000-0001" } });
    fireEvent.change(screen.getByLabelText(/Link de presença digital/), { target: { value: "@cafe.ficticio" } });
    expect(screen.getByText(/Será salvo como \+55 \(19\) 90000-0001/)).toBeInTheDocument();
    expect(screen.getByText(/UF: SP/)).toBeInTheDocument();
    expect(screen.getByText(/Instagram · @cafe\.ficticio/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Salvar lead" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled());
    expect(calls.filter((c) => c.method === "POST" && c.url === "/api/leads")).toHaveLength(1);
    resolveSave(new Response(JSON.stringify({ ...sampleLead, id: 99 }), { status: 201, headers: { "Content-Type": "application/json" } }));
    expect(await screen.findByText("Lead cadastrado com sucesso.")).toBeInTheDocument();
  });
});

describe("tela Consultar leads", () => {
  const page = { items: [sampleLead, { ...sampleLead, id: 8, establishment_name: "Academia Fictícia", whatsapp_valid: 0, whatsapp: "123" }], total: 2, page: 1, pageSize: 20 };

  it("renderiza tabela (desktop) e cards (mobile) com ações e filtros", async () => {
    setViewport(false);
    const calls = mockFetch({ "/api/leads": () => page, "/api/leads/facets": () => ({ segments: ["Cafeteria"], neighborhoods: [], cities: ["Campinas"], states: ["SP"], batches: [{ id: 4, original_filename: "lote.xlsx", created_at: "2026-09-20" }] }) });
    renderWithProviders(
      <Routes>
        <Route path="/leads" element={<LeadsList />} />
      </Routes>,
      "/leads?batch_id=4&segment=Cafeteria",
    );
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(document.querySelectorAll(".cards-list .lead-card")).toHaveLength(2); // CSS shows cards on small screens
    expect(within(table).getAllByRole("link", { name: /Enviar mensagem/ })).toHaveLength(1);
    expect(within(table).getAllByRole("button", { name: /Enviar mensagem/ })).toHaveLength(1); // invalid phone: no link
    expect(within(table).getAllByRole("button", { name: "Ver prévia" }).length).toBeGreaterThan(0);
    expect(within(table).getAllByRole("link", { name: "Abrir link" }).length).toBeGreaterThan(0);
    expect(within(table).getByText("inválido")).toBeInTheDocument();
    const listCall = calls.find((c) => c.url.startsWith("/api/leads?"));
    expect(listCall?.url).toContain("batch_id=4");
    expect(listCall?.url).toContain("segment=Cafeteria");
    // selection + bulk action
    fireEvent.click(within(table).getByLabelText("Selecionar Café & Cia Fictício"));
    expect(screen.getByRole("region", { name: "Seleção" })).toHaveTextContent("1 selecionado");
  });
});

describe("tela Importar prospects", () => {
  it("lê CSV, mapeia colunas, valida e mostra a prévia sem gravar", async () => {
    setViewport(false);
    vi.stubGlobal("Worker", undefined);
    const calls = mockFetch({
      "POST /api/imports/analyze": (_u, init) => {
        const body = JSON.parse(String(init?.body));
        return {
          filename: body.filename,
          totalRows: body.rows.length,
          validRows: 1,
          invalidRows: 1,
          duplicateRows: 0,
          rows: [
            { rowNumber: 2, values: body.rows[0].values, valid: true, errors: [], duplicate: null, lead: { establishment_name: "Loja Fictícia", segment: "", city: "Recife", state: "PE", whatsapp: "5581900000001" } },
            { rowNumber: 3, values: body.rows[1].values, valid: false, errors: ["Linha 3: WhatsApp não informado."], duplicate: null, lead: null },
          ],
        };
      },
    });
    renderWithProviders(<ImportProspects />);
    const csv = "Nome;Cidade;UF;Telefone\nLoja Fictícia;Recife;PE;81 90000-0001\nSem Fone;Recife;PE;\n";
    const file = new File([csv], "prospects.csv", { type: "text/csv" });
    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [file] } });
    expect(await screen.findByText("Relacione as colunas")).toBeInTheDocument();
    expect((screen.getByLabelText(/^WhatsApp/) as HTMLSelectElement).value).toBe("3");
    expect(calls).toHaveLength(0); // nothing sent before validation
    fireEvent.click(screen.getByRole("button", { name: "Validar registros" }));
    expect(await screen.findByText("Resumo antes da confirmação")).toBeInTheDocument();
    expect(screen.getByText("Linha 3: WhatsApp não informado.")).toBeInTheDocument();
    expect(calls.map((c) => c.url)).toEqual(["/api/imports/analyze"]);
    expect(calls[0].body).toMatchObject({ filename: "prospects.csv", rows: [{ rowNumber: 2 }, { rowNumber: 3 }] });
    // confirmation dialog appears before committing
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));
    expect(await screen.findByRole("dialog", { name: "Confirmar importação" })).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/imports/commit")).toBe(false);
  });

  it("recusa formatos não suportados", async () => {
    setViewport(false);
    mockFetch({});
    renderWithProviders(<ImportProspects />);
    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [new File(["x"], "lista.pdf")] } });
    expect(await screen.findByText(/Formato não suportado/)).toBeInTheDocument();
  });
});
