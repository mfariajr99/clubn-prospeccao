import { expect, test, type Page } from "@playwright/test";

// Records window.open calls instead of navigating away (we never want to hit wa.me in tests).
async function stubWindowOpen(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __opened: unknown[][] }).__opened = [];
    window.open = ((...args: unknown[]) => {
      (window as unknown as { __opened: unknown[][] }).__opened.push(args);
      return null;
    }) as typeof window.open;
  });
}
const opened = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[][] }).__opened);
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 768;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // no visible list table may hide columns behind a horizontal scroll
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".table-wrap")].filter((w) => w.offsetParent && w.scrollWidth > w.clientWidth + 2).length,
  );
  expect(hidden).toBe(0);
}

test.describe.configure({ mode: "serial" });

test("menu possui os grupos Campanhas e Leads", async ({ page }) => {
  await page.goto("/");
  if (isMobile(page)) await page.getByRole("button", { name: "Abrir menu" }).click();
  const nav = page.getByRole("navigation", { name: "Menu principal" });
  for (const label of ["Campanhas", "Leads", "Criar campanha", "Consultar campanhas", "Iniciar campanhas", "Cadastrar lead", "Importar prospects", "Consultar leads"]) {
    await expect(nav.getByText(label, { exact: true })).toBeVisible();
  }
  await nav.getByText("Consultar leads").click();
  await expect(page).toHaveURL(/\/leads$/);
  await expect(page.getByRole("heading", { name: "Consultar leads" })).toBeVisible();
  await noHorizontalScroll(page);
});

test("cadastro individual de lead", async ({ page }, info) => {
  const suffix = info.project.name === "desktop" ? "1" : "2";
  await page.goto("/leads/novo");
  await page.getByLabel(/Nome do estabelecimento/).fill(`Sorveteria Teste E2E ${suffix}`);
  await page.getByLabel(/^Segmento/).fill("Sorveteria");
  await page.getByLabel(/^Bairro/).fill("centro");
  await page.getByLabel(/^Cidade/).fill("florianópolis");
  await page.getByLabel(/^Estado/).fill("santa catarina");
  await page.getByLabel(/WhatsApp de contato/).fill(`(48) 90000-777${suffix}`);
  await page.getByLabel(/Link de presença digital/).fill("@sorveteria.teste.e2e");
  await expect(page.getByText(`Será salvo como +55 (48) 90000-777${suffix}`)).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole("button", { name: "Salvar lead" }).click();
  await expect(page.getByText("Lead cadastrado com sucesso.")).toBeVisible();
  await page.goto(`/leads?q=Sorveteria%20Teste%20E2E%20${suffix}`);
  await expect(page.locator(".cell-title:visible", { hasText: `Sorveteria Teste E2E ${suffix}` })).toBeVisible();
});

test("importação com linhas válidas, inválidas e duplicadas → campanha → envio manual", async ({ page }, info) => {
  await stubWindowOpen(page);
  const tag = info.project.name === "desktop" ? "D" : "M";
  const d = tag === "D" ? "3" : "4";
  const csv = [
    "Estabelecimento;Categoria;Bairro;Município;UF;Celular;Instagram",
    `Mercado Alfa ${tag};Mercado;Centro;Joinville;SC;(47) 9000${d}-0001;@mercado.alfa.e2e`,
    `Mercado Beta ${tag};Mercado;Centro;Joinville;Santa Catarina;47 9000${d}-0002;beta-e2e.example.com`,
    `Mercado Sem Fone ${tag};Mercado;Centro;Joinville;SC;;`,
    `Mercado Alfa Repetido ${tag};Mercado;Centro;Joinville;SC;+55 47 9000${d}-0001;`,
    `Mercado Estado Ruim ${tag};Mercado;Centro;Joinville;ZZ;47 9000${d}-0005;`,
  ].join("\n");

  await page.goto("/leads/importar");
  await page.getByTestId("file-input").setInputFiles({ name: `prospects-${tag}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect(page.getByRole("heading", { name: "Relacione as colunas" })).toBeVisible();
  await page.getByRole("button", { name: "Validar registros" }).click();
  await expect(page.getByRole("heading", { name: "Resumo antes da confirmação" })).toBeVisible();
  const summary = (label: string) => page.locator(".summary-item", { hasText: label }).locator(".si-value");
  await expect(summary("Linhas encontradas")).toHaveText("5");
  await expect(summary("Registros válidos")).toHaveText("3");
  await expect(summary("Registros inválidos")).toHaveText("2");
  await expect(summary("Possíveis duplicidades")).toHaveText("1");
  await expect(summary("Serão importados")).toHaveText("2");
  await page.getByRole("tab", { name: /Inválidos/ }).click();
  await expect(page.getByText("Linha 4: WhatsApp não informado.")).toBeVisible();
  await expect(page.getByText("Linha 6: estado não reconhecido.")).toBeVisible();
  await noHorizontalScroll(page);

  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await page.getByRole("button", { name: "Importar agora" }).click();
  await expect(page.getByRole("heading", { name: /Importação concluída/ })).toBeVisible();
  await expect(summary("Importados")).toHaveText("2");
  await expect(summary("Com erro")).toHaveText("2");
  await expect(page.getByRole("link", { name: "Baixar relatório" })).toHaveAttribute("href", /report\.csv$/);

  // Create a campaign from the batch
  await page.getByRole("button", { name: "Criar campanha com este lote" }).click();
  await expect(page.getByRole("heading", { name: "Criar campanha" })).toBeVisible();
  await expect(page.getByText("2 selecionado(s)")).toBeVisible();
  await page.getByLabel("Nome da campanha").fill(`Mercados Joinville ${tag}`);
  await page.getByLabel("Mensagem 1 do WhatsApp").fill("Olá, {{nome_estabelecimento}}! O Club’n chegou em {{cidade}}/{{estado}} & queremos falar com o {{segmento}} de vocês. {{desconto}}");
  await expect(page.getByText(/Variáveis desconhecidas não serão substituídas/)).toBeVisible();
  await page.getByLabel("Mensagem 1 do WhatsApp").fill("Olá, {{nome_estabelecimento}}! O Club’n chegou em {{cidade}}/{{estado}} & queremos falar com o {{segmento}} de vocês.");
  await expect(page.getByTestId("message-preview")).toContainText("Olá, Café Exemplo! O Club’n chegou em Cidade Exemplo/SP");
  await page.getByLabel("Status", { exact: true }).selectOption("ready");
  await page.getByRole("button", { name: "Criar campanha" }).click();
  await expect(page.getByRole("heading", { name: `Mercados Joinville ${tag}` })).toBeVisible();

  // Start and send individually (each project uses its own operator: counters are per operator)
  await page.getByRole("button", { name: "Iniciar campanha" }).click();
  await page.locator("#operator").selectOption({ label: tag === "D" ? "Thomaz" : "Marcos" });
  await expect(page.getByTestId("quota-badge")).toContainText("0/30");
  await expect(page).toHaveURL(/\/campanhas\/iniciar\/\d+/);
  await expect(page.getByText("Não contatados").first()).toBeVisible();
  const scope = isMobile(page) ? page.locator(".cards-list") : page.locator(".table-wrap.responsive");
  await page.context().route("https://wa.me/**", (r) => r.fulfill({ status: 200, body: "wa.me (teste)" }));
  const waLink = scope.getByRole("link", { name: `Enviar mensagem: Mercado Alfa ${tag}` });
  expect(await waLink.getAttribute("target")).toBe("_blank");
  expect(await waLink.getAttribute("rel")).toBe("noopener noreferrer");
  const [popup] = await Promise.all([page.waitForEvent("popup"), waLink.click()]);
  await popup.waitForLoadState();
  const url = popup.url();
  await popup.close();
  expect(await opened(page)).toHaveLength(0); // real link, no window.open
  const parsed = new URL(url);
  expect(parsed.origin + parsed.pathname).toBe(`https://wa.me/55479000${d}0001`);
  expect(parsed.searchParams.get("text")).toBe(`Olá, Mercado Alfa ${tag}! O Club’n chegou em Joinville/SC & queremos falar com o Mercado de vocês.`);
  expect(url).toContain("%26"); // "&" encoded
  await expect(page.getByTestId("quota-badge")).toContainText("1/30");
  await expect(page.getByTestId("quota-badge")).toContainText("1/90");
  await expect(page.getByText("WhatsApp aberto com a mensagem 1. Depois de enviar, atualize o status do contato manualmente.")).toBeVisible();
  const row = isMobile(page) ? page.locator(".lead-card", { hasText: `Mercado Alfa ${tag}` }) : page.locator("tr", { hasText: `Mercado Alfa ${tag}` });
  await expect(row.getByText("WhatsApp aberto")).toBeVisible();
  await expect(row.getByText("Mensagem enviada")).toHaveCount(0);

  // Manual status update with note
  await row.getByRole("button", { name: /Alterar status/ }).first().click();
  await page.getByLabel("Novo status").selectOption("message_sent");
  await page.getByLabel("Observação (opcional)").fill("Mensagem enviada pelo operador no WhatsApp");
  await page.getByRole("button", { name: "Salvar status" }).click();
  await expect(row.getByText("Mensagem enviada")).toBeVisible();
  await noHorizontalScroll(page);
});

test("prévia: painel lateral no desktop e tela cheia no mobile, sem sair da campanha", async ({ page }) => {
  await stubWindowOpen(page);
  await page.goto("/campanhas/iniciar/1");
  const scope = isMobile(page) ? page.locator(".cards-list") : page.locator(".table-wrap.responsive");
  await scope.getByRole("button", { name: "Ver prévia" }).first().click();
  const panel = page.getByTestId("preview-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-variant", isMobile(page) ? "sheet" : "side");
  const box = await panel.boundingBox();
  const vw = page.viewportSize()!.width;
  if (isMobile(page)) expect(Math.round(box!.width)).toBe(vw);
  else expect(box!.width).toBeLessThan(vw / 2);
  await expect(panel.getByRole("link", { name: /Enviar mensagem/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Avaliar prospect/ })).toBeVisible();
  await expect(page).toHaveURL(/\/campanhas\/iniciar\/1$/);
  await panel.getByRole("button", { name: "Próximo lead" }).click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("lead com WhatsApp inválido não abre o WhatsApp", async ({ page }) => {
  await stubWindowOpen(page);
  await page.goto("/leads?q=Floricultura");
  const scope = isMobile(page) ? page.locator(".cards-list") : page.locator(".table-wrap.responsive");
  await scope.getByRole("button", { name: /Enviar mensagem: Floricultura/ }).click();
  expect(await opened(page)).toHaveLength(0);
  await expect(page.getByText(/Corrija o cadastro/).first()).toBeVisible();
});

test("ações secundárias ficam no menu e cabem na tela", async ({ page }) => {
  for (const width of [1000, 1280]) {
    if (!isMobile(page)) await page.setViewportSize({ width, height: 900 });
    await page.goto("/campanhas");
    await noHorizontalScroll(page);
    const menu = page.getByRole("button", { name: /Mais ações: Parceiros gastronomia/ }).locator("visible=true");
    await menu.click();
    await expect(page.getByRole("menuitem", { name: "Duplicar" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Pausar" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    if (isMobile(page)) break;
  }
});

test("listagens responsivas", async ({ page }) => {
  for (const path of ["/", "/leads", "/campanhas", "/campanhas/1?tab=leads", "/leads/importar?tab=historico", "/campanhas/nova"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await noHorizontalScroll(page);
    if (isMobile(page) && (path === "/leads" || path === "/campanhas")) {
      await expect(page.locator(".cards-list").first()).toBeVisible();
      await expect(page.locator(".table-wrap.responsive").first()).toBeHidden();
    }
  }
});
