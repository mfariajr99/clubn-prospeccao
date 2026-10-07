// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "../../src/components/AuthGate";
import AdminClients from "../../src/pages/AdminClients";
import { mockFetch, renderWithProviders, setViewport } from "./utils";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("login com usuário e senha", () => {
  it("pede login e senha e envia os dois", async () => {
    let authenticated = false;
    const calls = mockFetch({
      "/api/auth/status": () => ({ required: true, authenticated, role: authenticated ? "client" : null, account: authenticated ? { id: 1, name: "Cliente", login: "cliente" } : null }),
      "POST /api/auth/login": () => {
        authenticated = true;
        return { ok: true };
      },
    });
    renderWithProviders(
      <AuthGate>
        <p>Sistema liberado</p>
      </AuthGate>,
    );
    const button = await screen.findByRole("button", { name: /Entrar/ });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Login"), { target: { value: "cliente" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-123" } });
    fireEvent.click(button);
    expect(await screen.findByText("Sistema liberado")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ login: "cliente", password: "senha-123" });
  });
});

describe("tela Novos usuários (admin)", () => {
  it("cria um usuário e mostra os dados de acesso para copiar", async () => {
    setViewport(false);
    const calls = mockFetch({
      "/api/admin/clients": () => [],
      "POST /api/admin/clients": () => ({
        id: 1,
        name: "Agência Exemplo",
        login: "agencia.exemplo",
        active: true,
        created_at: "2026-10-01T10:00:00.000Z",
        last_login_at: null,
        metrics: {},
      }),
    });
    renderWithProviders(<AdminClients />, "/usuarios");
    fireEvent.click((await screen.findAllByRole("button", { name: /Novo usuário/ }))[0]);
    fireEvent.change(screen.getByLabelText(/Nome do cliente/), { target: { value: "Agência Exemplo" } });
    expect(screen.getByLabelText(/^Login/)).toHaveValue("agencia.exemplo");
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: "senha-forte-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar usuário" }));
    const box = await screen.findByTestId("client-credentials");
    expect(box).toHaveTextContent("Login: agencia.exemplo");
    expect(box).toHaveTextContent("Senha: senha-forte-1");
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Agência Exemplo", login: "agencia.exemplo", password: "senha-forte-1" }));
  });
});
