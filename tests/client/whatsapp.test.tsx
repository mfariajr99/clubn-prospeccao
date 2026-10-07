// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppButton } from "../../src/components/WhatsAppButton";
import { whatsappLinkFor } from "../../src/lib/whatsapp";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../src/components/Toast";
import { WhatsAppContextForTests } from "../../src/components/WhatsAppStatus";
import { mockFetch, renderWithProviders, sampleLead } from "./utils";

const TEMPLATE = "Olá, {{nome_estabelecimento}}! Vi vocês em {{bairro}}, {{cidade}}/{{estado}} ({{segmento}}).";

describe("botão Enviar mensagem", () => {
  let openSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("é um link direto para o WhatsApp do lead com a mensagem personalizada e codificada", async () => {
    const calls = mockFetch({ "POST /api/leads/7/whatsapp-opened": () => ({ previous: "not_contacted", current: "whatsapp_opened", opened_at: "x" }) });
    const onOpened = vi.fn();
    renderWithProviders(<WhatsAppButton lead={sampleLead} templates={[TEMPLATE]} campaignId={3} onOpened={onOpened} />);
    const link = screen.getByRole("link", { name: /Enviar mensagem/ });

    const expectedText = "Olá, Café & Cia Fictício! Vi vocês em Centro, Campinas/SP (Cafeteria).";
    expect(link).toHaveAttribute("href", `https://wa.me/5519900000001?text=${encodeURIComponent(expectedText)}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(new URL(link.getAttribute("href")!).searchParams.get("text")).toBe(expectedText);

    link.addEventListener("click", (e) => e.preventDefault()); // jsdom cannot navigate
    fireEvent.click(link);
    // only the "WhatsApp aberto" event is registered — never "mensagem enviada"
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith(expect.objectContaining({ current: "whatsapp_opened" })));
    expect(calls).toEqual([{ url: "/api/leads/7/whatsapp-opened", method: "POST", body: { campaign_id: 3, message_type: 1 } }]);
    expect(await screen.findByText(/atualize o status do contato manualmente/)).toBeInTheDocument();
    expect(screen.queryByText(/mensagem enviada com sucesso/i)).not.toBeInTheDocument();
  });

  it("bloqueia a abertura quando o telefone é inválido e oferece correção", async () => {
    const calls = mockFetch({});
    renderWithProviders(<WhatsAppButton lead={{ ...sampleLead, whatsapp: "12345", whatsapp_valid: 1 }} templates={[TEMPLATE]} />);
    expect(screen.queryByRole("link", { name: /Enviar mensagem/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Enviar mensagem/ }));
    expect(openSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(await screen.findByText(/Corrija o cadastro/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Corrigir cadastro" })).toBeInTheDocument();
  });

  it("bloqueia lead marcado como WhatsApp inválido", () => {
    expect(whatsappLinkFor({ ...sampleLead, whatsapp_valid: 0 }, TEMPLATE)).toMatchObject({ ok: false });
  });

  it("não abre quando a campanha não está em andamento", () => {
    mockFetch({});
    renderWithProviders(<WhatsAppButton lead={sampleLead} templates={[TEMPLATE]} campaignId={3} disabledReason="Inicie a campanha" />);
    expect(screen.queryByRole("link", { name: /Enviar mensagem/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Enviar mensagem/ }));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("usa a mensagem padrão fora de campanhas", () => {
    const link = whatsappLinkFor(sampleLead, null);
    expect(link.ok && decodeURIComponent(link.url)).toContain("Olá, Café & Cia Fictício! Aqui é do Club’n");
  });
});

describe("contador de envios no botão", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("usa a mensagem da vez (tipo 2) e bloqueia durante a pausa", async () => {
    const { QuotaContextForTests } = await import("./quotaTestUtils");
    const quota = (locked: boolean) => ({
      quota: null,
      remainingMs: locked ? 5_400_000 : 0,
      lockedReason: locked ? "Pausa de envios: libera em 01:30:00" : null,
      nextMessageType: 2,
      apply: () => undefined,
      countLocal: () => undefined,
      refresh: () => undefined,
    });
    mockFetch({});
    const { rerender } = renderWithProviders(
      <QuotaContextForTests value={quota(false)}>
        <WhatsAppButton lead={sampleLead} templates={["Mensagem um {{cidade}}", "Mensagem dois {{cidade}}", "Mensagem três {{cidade}}"]} />
      </QuotaContextForTests>,
    );
    expect(decodeURIComponent(screen.getByRole("link", { name: /Enviar mensagem/ }).getAttribute("href")!)).toContain("Mensagem dois Campinas");
    rerender(
      <MemoryRouter>
        <ToastProvider>
          <QuotaContextForTests value={quota(true)}>
            <WhatsAppButton lead={sampleLead} templates={["Mensagem um", "Mensagem dois", "Mensagem três"]} />
          </QuotaContextForTests>
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: /Enviar mensagem/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar mensagem/ })).toHaveAttribute("title", "Pausa de envios: libera em 01:30:00");
  });
});

describe("botão Enviar mensagem com o WhatsApp do operador conectado", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("envia direto (1 clique = 1 mensagem) e confirma o envio", async () => {
    const calls = mockFetch({
      "POST /api/leads/7/whatsapp-send": () => ({ previous: "not_contacted", current: "message_sent", opened_at: "x", message_type: 1, sent: true }),
    });
    const onOpened = vi.fn();
    const connected = {
      status: { state: "connected" as const, qr: null, pairing_code: null, phone: "5511988887777", name: "Thomaz", error: null, updated_at: "x" },
      connected: true,
      unread: 0,
      refreshUnread: () => undefined,
      refresh: () => undefined,
      apply: () => undefined,
    };
    renderWithProviders(
      <WhatsAppContextForTests value={connected}>
        <WhatsAppButton lead={sampleLead} templates={[TEMPLATE]} campaignId={3} onOpened={onOpened} />
      </WhatsAppContextForTests>,
    );
    expect(screen.queryByRole("link", { name: /Enviar mensagem/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Enviar mensagem/ }));
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith(expect.objectContaining({ current: "message_sent" })));
    expect(calls).toEqual([{ url: "/api/leads/7/whatsapp-send", method: "POST", body: { campaign_id: 3 } }]);
    expect(await screen.findByText(/Mensagem 1 enviada para Café & Cia Fictício/)).toBeInTheDocument();
  });
});
