import { describe, expect, it } from "vitest";
import { extractMetadata, sanitizeMetadata } from "../../server/services/preview/metadata";
import { assertUrlAllowed, isPublicAddress, PreviewFetchError, resolvePublicAddress, safeFetchHtml } from "../../server/services/preview/ssrf";
import { fakeTransport, publicResolver, setup, validLead } from "./helpers";

const HTML = `<!doctype html><html><head>
<title>Título simples</title>
<meta property="og:title" content="Bistrô &amp; Café &lt;b&gt;Fictício&lt;/b&gt;">
<meta name="description" content="Descrição com <script>alert(1)</script> texto &#39;seguro&#39;">
<meta property="og:image" content="/img/capa.jpg">
<link rel="icon" href="https://cdn.example.com/favicon.png">
</head><body>ok</body></html>`;

describe("proteção contra SSRF", () => {
  it("classifica endereços públicos e privados", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fd00:ec2::254", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "224.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("bloqueia localhost, esquemas perigosos, credenciais e portas internas", () => {
    for (const url of ["http://localhost/", "http://api.localhost/", "http://127.0.0.1/", "http://[::1]/", "http://10.0.0.5/", "http://169.254.169.254/latest/meta-data", "http://metadata.google.internal/", "file:///etc/passwd", "ftp://x.com", "https://user:pw@x.com/", "http://x.com:6379/"]) {
      expect(() => assertUrlAllowed(url), url).toThrow(PreviewFetchError);
    }
    expect(assertUrlAllowed("https://exemplo.com.br/a").hostname).toBe("exemplo.com.br");
  });

  it("bloqueia domínio que resolve para IP privado (DNS validado antes do acesso)", async () => {
    await expect(resolvePublicAddress("interno.example.com", publicResolver({ "interno.example.com": ["10.0.0.7"] }))).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
    await expect(resolvePublicAddress("misto.example.com", publicResolver({ "misto.example.com": ["93.184.216.34", "127.0.0.1"] }))).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
  });

  it("bloqueia redirecionamento para rede privada", async () => {
    const transport = fakeTransport({
      "https://site.example.com/": { status: 302, headers: { location: "http://painel.example.com/admin" } },
      "http://painel.example.com/admin": { body: "segredo" },
    });
    await expect(
      safeFetchHtml("https://site.example.com/", { transport, resolver: publicResolver({ "painel.example.com": ["192.168.0.10"] }) }),
    ).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
    expect(transport.calls).toEqual(["https://site.example.com/"]);

    const toLoopback = fakeTransport({ "https://a.example.com/": { status: 301, headers: { location: "http://127.0.0.1:80/" } } });
    await expect(safeFetchHtml("https://a.example.com/", { transport: toLoopback, resolver: publicResolver() })).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
  });

  it("limita a quantidade de redirecionamentos", async () => {
    const routes: Record<string, { status: number; headers: Record<string, string> }> = {};
    for (let i = 0; i < 10; i++) routes[`https://r.example.com/${i}`] = { status: 302, headers: { location: `https://r.example.com/${i + 1}` } };
    await expect(safeFetchHtml("https://r.example.com/0", { transport: fakeTransport(routes), resolver: publicResolver(), maxRedirects: 3 })).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  });

  it("aplica timeout", async () => {
    const transport = fakeTransport({ "https://lento.example.com/": { hang: true } });
    const started = Date.now();
    await expect(safeFetchHtml("https://lento.example.com/", { transport, resolver: publicResolver(), timeoutMs: 150 })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("não baixa conteúdo que não é HTML e limita o tamanho", async () => {
    const pdf = fakeTransport({ "https://x.example.com/a.pdf": { headers: { "content-type": "application/pdf" }, body: "%PDF" } });
    await expect(safeFetchHtml("https://x.example.com/a.pdf", { transport: pdf, resolver: publicResolver() })).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
    const big = fakeTransport({ "https://x.example.com/": { body: "a".repeat(5000) } });
    const res = await safeFetchHtml("https://x.example.com/", { transport: big, resolver: publicResolver(), maxBytes: 1000 });
    expect(res.body.length).toBe(1000);
    expect(res.truncated).toBe(true);
  });

  it("identifica bloqueio pelo site", async () => {
    const t = fakeTransport({ "https://b.example.com/": { status: 403 } });
    await expect(safeFetchHtml("https://b.example.com/", { transport: t, resolver: publicResolver() })).rejects.toMatchObject({ code: "BLOCKED_BY_SITE" });
  });
});

describe("metadados", () => {
  it("extrai Open Graph, título, descrição, favicon e resolve URLs relativas", () => {
    const meta = extractMetadata(HTML, "https://bistro.example.com/pagina");
    expect(meta.title).toBe("Bistrô & Café Fictício");
    expect(meta.description).toBe("Descrição com texto 'seguro'");
    expect(meta.image).toBe("https://bistro.example.com/img/capa.jpg");
    expect(meta.favicon).toBe("https://cdn.example.com/favicon.png");
  });

  it("sanitiza metadados maliciosos", () => {
    expect(sanitizeMetadata('<img src=x onerror="alert(1)">Olá&lt;script&gt;x&lt;/script&gt;', 100)).toBe("Olá");
    expect(extractMetadata('<meta property="og:image" content="javascript:alert(1)">', "https://a.example.com").image).toBeNull();
    expect(extractMetadata('<meta property="og:image" content="http://127.0.0.1/x.png">', "https://a.example.com").image).toBeNull();
    expect(sanitizeMetadata("a".repeat(500), 50)?.length).toBe(50);
  });
});

describe("serviço de prévias (cache, status e fallback)", () => {
  async function ctx(routes: Parameters<typeof fakeTransport>[0], extra: Record<string, unknown> = {}) {
    const transport = fakeTransport(routes);
    let now = new Date("2026-09-22T12:00:00Z");
    const env = setup({ fetchOptions: { transport, resolver: publicResolver() }, now: () => now, refreshCooldownMs: 60_000, ...extra });
    const lead = (await env.agent.post("/api/leads").send(validLead({ digital_presence_url: "https://bistro.example.com/", extra_links: ["@bistro.demo"] }))).body;
    return { ...env, transport, lead, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
  }

  it("não captura nada até ser solicitado e depois usa o cache", async () => {
    const { agent, previews, transport, lead } = await ctx({ "https://bistro.example.com/": { body: HTML } });
    const list = (await agent.get(`/api/leads/${lead.id}/previews`)).body;
    expect(list.map((p: { preview_status: string }) => p.preview_status)).toEqual(["not_requested", "not_requested"]);
    expect(transport.calls).toHaveLength(0);

    const first = await agent.post(`/api/leads/${lead.id}/previews`).send({ url: "https://bistro.example.com/" });
    expect(first.body.refreshing).toBe(true);
    await previews.idle();
    const [site] = (await agent.get(`/api/leads/${lead.id}/previews`)).body;
    expect(site).toMatchObject({ preview_status: "available", page_title: "Bistrô & Café Fictício", domain: "bistro.example.com", open_graph_image_url: "https://bistro.example.com/img/capa.jpg" });
    expect(site.expires_at).toBe("2026-09-29T12:00:00.000Z"); // 7 days

    await agent.post(`/api/leads/${lead.id}/previews`).send({ url: "https://bistro.example.com/" });
    await previews.idle();
    expect(transport.calls).toHaveLength(1); // cache hit
  });

  it("evita capturas simultâneas do mesmo endereço", async () => {
    const { agent, previews, transport, lead } = await ctx({ "https://bistro.example.com/": { body: HTML, delayMs: 50 } });
    await Promise.all([1, 2, 3].map(() => agent.post(`/api/leads/${lead.id}/previews`).send({ url: "https://bistro.example.com/" })));
    await previews.idle();
    expect(transport.calls).toHaveLength(1);
  });

  it("atualização manual com limite de frequência e exibição da captura anterior", async () => {
    const { agent, previews, transport, lead, advance } = await ctx({ "https://bistro.example.com/": { body: HTML } });
    await agent.post(`/api/leads/${lead.id}/previews`).send({ url: "https://bistro.example.com/" });
    await previews.idle();
    const tooSoon = await agent.post(`/api/leads/${lead.id}/previews`).send({ url: "https://bistro.example.com/", force: true });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.details.next_refresh_allowed_at).toBeTruthy();
    advance(61_000);
    const refresh = await agent.post(`/api/leads/${lead.id}/previews`).send({ url: "https://bistro.example.com/", force: true });
    expect(refresh.status).toBe(200);
    expect(refresh.body).toMatchObject({ refreshing: true, preview_status: "available", page_title: "Bistrô & Café Fictício" }); // old capture stays visible
    await previews.idle();
    expect(transport.calls).toHaveLength(2);
  });

  it("marca como desatualizado após a validade", async () => {
    const { agent, previews, lead, advance } = await ctx({ "https://bistro.example.com/": { body: HTML } });
    await agent.post(`/api/leads/${lead.id}/previews`).send({ url: "https://bistro.example.com/" });
    await previews.idle();
    advance(8 * 24 * 3600 * 1000);
    const [site] = (await agent.get(`/api/leads/${lead.id}/previews`)).body;
    expect(site.preview_status).toBe("stale");
  });

  it("Instagram: não faz scraping; retorna card com status e mensagem", async () => {
    const { agent, previews, transport, lead } = await ctx({});
    await agent.post(`/api/leads/${lead.id}/previews`).send({ url: "https://www.instagram.com/bistro.demo/" });
    await previews.idle();
    const ig = (await agent.get(`/api/leads/${lead.id}/previews`)).body[1];
    expect(ig).toMatchObject({ link_type: "instagram", preview_status: "blocked", error_code: "OFFICIAL_ACCESS_REQUIRED", page_title: "@bistro.demo" });
    expect(transport.calls).toHaveLength(0);
  });

  it("falha na prévia não bloqueia o lead (status de erro, link inválido)", async () => {
    const { agent, previews, lead, db } = await ctx({ "https://bistro.example.com/": { status: 500 } });
    await agent.post(`/api/leads/${lead.id}/previews`).send({ url: "https://bistro.example.com/" });
    await previews.idle();
    expect((await agent.get(`/api/leads/${lead.id}/previews`)).body[0]).toMatchObject({ preview_status: "error", error_code: "HTTP_ERROR" });
    // lead remains usable
    const c = await agent.post("/api/campaigns").send({ name: "Com prévia com erro", message_template: "Oi {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}", lead_ids: [lead.id], status: "ready" });
    expect(c.status).toBe(201);
    await agent.post(`/api/campaigns/${c.body.id}/status`).send({ status: "in_progress" }).expect(200);
    await agent.post(`/api/leads/${lead.id}/whatsapp-opened`).send({ campaign_id: c.body.id }).expect(200);
    // link pointing to a private network
    db.prepare("UPDATE lead_links SET url = 'http://10.0.0.8/' WHERE is_primary = 1").run();
    await agent.post(`/api/leads/${lead.id}/previews`).send({ url: "http://10.0.0.8/" });
    await previews.idle();
    expect((await agent.get(`/api/leads/${lead.id}/previews`)).body[0]).toMatchObject({ preview_status: "invalid_link", error_code: "BLOCKED_ADDRESS" });
  });

  it("só gera prévia de links do próprio lead", async () => {
    const { agent, lead } = await ctx({});
    const res = await agent.post(`/api/leads/${lead.id}/previews`).send({ url: "http://169.254.169.254/latest/meta-data" });
    expect(res.status).toBe(404);
  });

  it("timeout vira status de erro", async () => {
    const transport = fakeTransport({ "https://bistro.example.com/": { hang: true } });
    const env = setup({ fetchOptions: { transport, resolver: publicResolver(), timeoutMs: 100 } });
    const lead = (await env.agent.post("/api/leads").send(validLead({ digital_presence_url: "https://bistro.example.com/" }))).body;
    await env.agent.post(`/api/leads/${lead.id}/previews`).send({ url: "https://bistro.example.com/" });
    await env.previews.idle();
    expect((await env.agent.get(`/api/leads/${lead.id}/previews`)).body[0]).toMatchObject({ preview_status: "error", error_code: "TIMEOUT" });
  });
});

describe("transporte HTTP real", () => {
  it("conecta somente ao IP previamente validado (sem nova resolução DNS)", async () => {
    const http = await import("node:http");
    const { nodeTransport } = await import("../../server/services/preview/ssrf");
    const server = http.createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(`<title>host=${req.headers.host}</title>`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      // "nao-existe.invalid" cannot be resolved by DNS: success proves the pinned address was used.
      const res = await nodeTransport(new URL(`http://nao-existe.invalid:${port}/`), "127.0.0.1", new AbortController().signal);
      let body = "";
      for await (const chunk of res.body) body += Buffer.from(chunk).toString();
      expect(res.status).toBe(200);
      expect(body).toContain(`host=nao-existe.invalid:${port}`);
    } finally {
      server.close();
    }
  });
});
