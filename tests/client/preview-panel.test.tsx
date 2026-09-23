// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewPanel, previewImageCandidates } from "../../src/components/PreviewPanel";
import { mockFetch, renderWithProviders, sampleLead, setViewport } from "./utils";

const basePreview = {
  id: 1,
  lead_id: 7,
  link_type: "site",
  original_url: "https://cafe.example.com/",
  normalized_url: "https://cafe.example.com/",
  final_url: "https://cafe.example.com/",
  page_title: "Café & Cia — página",
  page_description: "Descrição fictícia",
  domain: "cafe.example.com",
  favicon_url: null,
  open_graph_image_url: null,
  screenshot_storage_path: null,
  screenshot_url: null,
  preview_status: "available",
  error_code: null,
  error_message: null,
  captured_at: "2026-09-21T10:00:00.000Z",
  expires_at: "2026-09-28T10:00:00.000Z",
  refreshing: false,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("painel de pré-visualização", () => {
  it("abre como painel lateral no desktop e não recarrega capturas válidas", async () => {
    setViewport(false);
    const calls = mockFetch({ "/api/leads/7/previews": () => [basePreview] });
    renderWithProviders(<PreviewPanel lead={sampleLead} onClose={() => undefined} />);
    const panel = screen.getByTestId("preview-panel");
    expect(panel).toHaveAttribute("data-variant", "side");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(await screen.findByText("Café & Cia — página")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Abrir link/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Atualizar prévia/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Avaliar prospect/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Enviar mensagem/ })).toBeInTheDocument();
    // cached & fresh: no capture request
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("abre como tela cheia (bottom sheet) no mobile", async () => {
    setViewport(true);
    mockFetch({ "/api/leads/7/previews": () => [basePreview] });
    renderWithProviders(<PreviewPanel lead={sampleLead} onClose={() => undefined} />);
    expect(screen.getByTestId("preview-panel")).toHaveAttribute("data-variant", "sheet");
    expect(screen.getByTestId("preview-panel").className).toContain("sheet");
  });

  it("solicita a captura somente ao abrir e mostra fallback visual e mensagem quando falha", async () => {
    setViewport(false);
    const failed = { ...basePreview, id: 2, preview_status: "error", page_title: null, page_description: null, error_code: "TIMEOUT", error_message: "Tempo limite excedido." };
    const calls = mockFetch({
      "/api/leads/7/previews": () => [{ ...basePreview, id: null, preview_status: "not_requested", page_title: null, captured_at: null }],
      "POST /api/leads/7/previews": () => failed,
    });
    renderWithProviders(<PreviewPanel lead={sampleLead} onClose={() => undefined} />);
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ url: "https://cafe.example.com/", force: false });
    expect(await screen.findByText("Não foi possível gerar a prévia deste endereço. Abra o link para visualizar.")).toBeInTheDocument();
    expect(screen.getByTestId("preview-fallback")).toHaveTextContent("cafe.example.com");
    // the lead is still usable
    expect(screen.getByRole("link", { name: /Enviar mensagem/ })).toHaveAttribute("href", expect.stringContaining("https://wa.me/5519900000001"));
  });

  it("alterna entre vários links do prospect", async () => {
    setViewport(false);
    const ig = { ...basePreview, id: 3, link_type: "instagram", original_url: "https://www.instagram.com/cafe.demo/", normalized_url: "https://www.instagram.com/cafe.demo/", preview_status: "blocked", page_title: "@cafe.demo", error_code: "OFFICIAL_ACCESS_REQUIRED", error_message: "Somente integração oficial." };
    mockFetch({ "/api/leads/7/previews": () => [basePreview, ig] });
    renderWithProviders(<PreviewPanel lead={sampleLead} onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Instagram/ }));
    expect(await screen.findByText("@cafe.demo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Abrir no Instagram/ })).toBeInTheDocument();
  });

  it("atualização manual envia force=true", async () => {
    setViewport(false);
    const calls = mockFetch({ "/api/leads/7/previews": () => [basePreview], "POST /api/leads/7/previews": () => ({ ...basePreview, refreshing: false }) });
    renderWithProviders(<PreviewPanel lead={sampleLead} onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: /Atualizar prévia/ }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ url: "https://cafe.example.com/", force: true }));
  });

  it("ordem de exibição da imagem: captura > Open Graph > capa manual", () => {
    expect(previewImageCandidates({ ...basePreview, screenshot_url: "/s.jpg", open_graph_image_url: "https://og" } as never, "https://capa")).toEqual(["/s.jpg", "https://og", "https://capa"]);
    expect(previewImageCandidates(null, null)).toEqual([]);
  });

  it("registra a avaliação manual", async () => {
    setViewport(false);
    const calls = mockFetch({
      "/api/leads/7/previews": () => [basePreview],
      "/api/leads/7/evaluations": () => [],
      "PUT /api/leads/7/evaluations": () => ({ id: 1, lead_id: 7, campaign_id: null, potential_level: "high", score: 4, checklist_data: {}, evaluator_user_id: 1, updated_at: "2026-09-22T10:00:00Z" }),
    });
    renderWithProviders(<PreviewPanel lead={sampleLead} onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: /Avaliar prospect/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar avaliação" }));
    expect(await screen.findByText("Selecione o potencial.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Alto" }));
    fireEvent.click(screen.getByRole("button", { name: "Nota 4" }));
    fireEvent.click(screen.getByLabelText("Perfil ou site ativo"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar avaliação" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")).toBeTruthy());
    expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ potential_level: "high", score: 4, campaign_id: null, checklist_data: { active_profile: true } });
  });
});
