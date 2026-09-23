import { describe, expect, it } from "vitest";
import { normalizePhone } from "../../shared/phone";
import { normalizeUrl } from "../../shared/url";
import { normalizeState } from "../../shared/states";
import { normalizeCity, sanitizeText } from "../../shared/text";
import { buildCampaignMessage, buildWhatsAppUrl, findUnknownVariables, renderTemplate } from "../../shared/template";
import { normalizeLeadInput } from "../../shared/leadInput";
import { applyMapping, autoMapColumns, validateImportRow } from "../../shared/importMapping";

describe("normalização do WhatsApp", () => {
  it("remove símbolos e adiciona 55 a números brasileiros", () => {
    const r = normalizePhone("(11) 98765-4321");
    expect(r).toMatchObject({ ok: true, digits: "5511987654321" });
  });
  it("aceita fixo com 10 dígitos e adiciona 55", () => {
    expect(normalizePhone("21 3333-4444")).toMatchObject({ ok: true, digits: "552133334444" });
  });
  it("não duplica o código 55 quando já informado", () => {
    expect(normalizePhone("+55 (31) 99876-5432")).toMatchObject({ ok: true, digits: "5531998765432" });
    expect(normalizePhone("5531998765432")).toMatchObject({ ok: true, digits: "5531998765432" });
    expect(normalizePhone("0055 31 99876 5432")).toMatchObject({ ok: true, digits: "5531998765432" });
  });
  it("remove o zero de tronco", () => {
    expect(normalizePhone("011 98765-4321")).toMatchObject({ ok: true, digits: "5511987654321" });
  });
  it("aceita números internacionais com +", () => {
    expect(normalizePhone("+351 912 345 678")).toMatchObject({ ok: true, digits: "351912345678", country: "INTL" });
  });
  it("trata números vindos de planilhas como float", () => {
    expect(normalizePhone("11987654321.0")).toMatchObject({ ok: true, digits: "5511987654321" });
  });
  it("rejeita vazio, curto, DDD inexistente e celular sem 9", () => {
    expect(normalizePhone("")).toMatchObject({ ok: false, error: "WhatsApp não informado." });
    expect(normalizePhone("12345")).toMatchObject({ ok: false });
    expect(normalizePhone("(20) 98765-4321")).toMatchObject({ ok: false });
    expect(normalizePhone("(11) 88765-43210")).toMatchObject({ ok: false });
    expect(normalizePhone("abc")).toMatchObject({ ok: false });
  });
});

describe("mensagem e link do WhatsApp", () => {
  const lead = { establishment_name: "Padaria Aurora", segment: "Padaria", neighborhood: "Vila Nova", city: "Campinas", state: "SP" };

  it("substitui todas as variáveis", () => {
    const msg = buildCampaignMessage("Olá {{nome_estabelecimento}} ({{segmento}}) do {{ bairro }}, {{cidade}}/{{estado}}!", lead);
    expect(msg).toBe("Olá Padaria Aurora (Padaria) do Vila Nova, Campinas/SP!");
  });
  it("identifica variáveis desconhecidas e as mantém no texto", () => {
    expect(findUnknownVariables("Oi {{nome}} {{cidade}} {{ desconto }}")).toEqual(["nome", "desconto"]);
    const r = renderTemplate("Oi {{nome}}", lead);
    expect(r.unknown).toEqual(["nome"]);
    expect(r.text).toBe("Oi {{nome}}");
  });
  it("informa variáveis vazias para o lead", () => {
    expect(renderTemplate("{{bairro}}", { establishment_name: "X", neighborhood: "" }).missing).toEqual(["bairro"]);
  });
  it("gera a URL wa.me com a mensagem codificada", () => {
    const r = buildWhatsAppUrl("5511987654321", "Olá, Padaria & Cia! 50% off? #promo\nLinha 2");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url).toBe(
      "https://wa.me/5511987654321?text=" + encodeURIComponent("Olá, Padaria & Cia! 50% off? #promo\nLinha 2"),
    );
    expect(r.url).toContain("%26");
    expect(r.url).toContain("%0A");
    expect(new URL(r.url).searchParams.get("text")).toBe("Olá, Padaria & Cia! 50% off? #promo\nLinha 2");
  });
  it("normaliza o telefone ao gerar o link", () => {
    const r = buildWhatsAppUrl("(11) 98765-4321", "Oi");
    expect(r).toMatchObject({ ok: true, url: "https://wa.me/5511987654321?text=Oi" });
  });
  it("bloqueia número inválido", () => {
    expect(buildWhatsAppUrl("123", "Oi")).toMatchObject({ ok: false });
    expect(buildWhatsAppUrl(null, "Oi")).toMatchObject({ ok: false });
  });
});

describe("normalização de URLs", () => {
  it("converte @perfil para Instagram", () => {
    expect(normalizeUrl("@cafe.exemplo_demo")).toMatchObject({
      ok: true,
      url: "https://www.instagram.com/cafe.exemplo_demo/",
      type: "instagram",
      label: "@cafe.exemplo_demo",
    });
  });
  it("rejeita @perfil inválido", () => {
    expect(normalizeUrl("@perfil com espaço!")).toMatchObject({ ok: false });
  });
  it("adiciona https e identifica o tipo", () => {
    expect(normalizeUrl("instagram.com/exemplo")).toMatchObject({ ok: true, type: "instagram", url: "https://instagram.com/exemplo" });
    expect(normalizeUrl("https://linktr.ee/exemplo")).toMatchObject({ type: "linktree" });
    expect(normalizeUrl("https://www.google.com/maps/place/x")).toMatchObject({ type: "google_maps" });
    expect(normalizeUrl("https://maps.app.goo.gl/abc")).toMatchObject({ type: "google_maps" });
    expect(normalizeUrl("https://www.tiktok.com/@exemplo")).toMatchObject({ type: "tiktok", label: "@exemplo" });
    expect(normalizeUrl("https://facebook.com/exemplo")).toMatchObject({ type: "facebook" });
    expect(normalizeUrl("www.exemplo-demo.com.br/cardapio?x=1")).toMatchObject({ type: "site", url: "https://www.exemplo-demo.com.br/cardapio?x=1" });
  });
  it("aceita links de plataformas desconhecidas sem modificá-los", () => {
    const r = normalizeUrl("https://Plataforma-Nova.example/perfil/ABC?ref=Q");
    expect(r).toMatchObject({ ok: true, type: "site", url: "https://plataforma-nova.example/perfil/ABC?ref=Q" });
  });
  it("bloqueia esquemas perigosos", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://x.com", "vbscript:x"]) {
      expect(normalizeUrl(bad).ok).toBe(false);
    }
  });
  it("rejeita URL sem domínio e com credenciais", () => {
    expect(normalizeUrl("nada").ok).toBe(false);
    expect(normalizeUrl("https://user:pass@exemplo.com").ok).toBe(false);
  });
  it("vazio é permitido", () => {
    expect(normalizeUrl("  ")).toEqual({ ok: true, empty: true });
  });
});

describe("normalização de localização e textos", () => {
  it("converte estado para UF", () => {
    expect(normalizeState("são paulo")).toBe("SP");
    expect(normalizeState("Sao Paulo")).toBe("SP");
    expect(normalizeState(" rj ")).toBe("RJ");
    expect(normalizeState("Rio Grande do Sul")).toBe("RS");
    expect(normalizeState("Narnia")).toBeNull();
  });
  it("normaliza cidade", () => {
    expect(normalizeCity("  SÃO   JOSÉ DOS campos ")).toBe("São José dos Campos");
    expect(normalizeCity("rio de janeiro")).toBe("Rio de Janeiro");
  });
  it("sanitiza textos", () => {
    expect(sanitizeText("  <b>Bar</b>\u0000 do   Zé  ")).toBe("Bar do Zé");
    expect(sanitizeText("<script>alert(1)</script>Oi")).toBe("alert(1) Oi");
  });
});

describe("cadastro de lead (validação compartilhada)", () => {
  it("normaliza um lead válido", () => {
    const r = normalizeLeadInput({
      establishment_name: "  Bistrô   Exemplo ",
      segment: "RESTAURANTE",
      neighborhood: "centro",
      city: "belo horizonte",
      state: "minas gerais",
      whatsapp: "(31) 99876-5432",
      digital_presence_url: "@bistro.exemplo",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      establishment_name: "Bistrô Exemplo",
      segment: "Restaurante",
      neighborhood: "Centro",
      city: "Belo Horizonte",
      state: "MG",
      whatsapp: "5531998765432",
      digital_presence_type: "instagram",
      digital_presence_url: "https://www.instagram.com/bistro.exemplo/",
    });
  });
  it("exige campos obrigatórios", () => {
    const r = normalizeLeadInput({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["city", "establishment_name", "state", "whatsapp"]);
  });
});

describe("mapeamento de colunas da planilha", () => {
  it("reconhece variações de nomes", () => {
    const r = autoMapColumns(["Estabelecimento", "Categoria", "Bairro", "Município", "UF", "Celular", "Instagram", "Site"]);
    expect(r.mapping).toEqual({
      establishment_name: 0,
      segment: 1,
      neighborhood: 2,
      city: 3,
      state: 4,
      whatsapp: 5,
      digital_presence_url: 6,
      extra_link: 7,
    });
    expect(r.needsReview).toBe(false);
  });
  it("reconhece outras variações", () => {
    const r = autoMapColumns(["nome do estabelecimento", "ramo", "cidade", "estado", "WhatsApp", "URL"]);
    expect(r.mapping).toMatchObject({ establishment_name: 0, segment: 1, city: 2, state: 3, whatsapp: 4, digital_presence_url: 5 });
    const r2 = autoMapColumns(["nome", "segmento", "municipio", "Estado", "telefone", "link"]);
    expect(r2.mapping).toMatchObject({ establishment_name: 0, segment: 1, city: 2, state: 3, whatsapp: 4, digital_presence_url: 5 });
  });
  it("pede revisão quando faltam colunas obrigatórias", () => {
    const r = autoMapColumns(["Coluna A", "Coluna B"]);
    expect(r.needsReview).toBe(true);
    expect(r.reasons.join(" ")).toContain("WhatsApp");
  });
  it("valida linha a linha com número da linha e motivo", () => {
    const { mapping } = autoMapColumns(["nome", "cidade", "uf", "whatsapp", "link"]);
    const rows = applyMapping(
      [
        ["Loja A", "Recife", "PE", "81 98888-7777", "lojaa.example"],
        [],
        ["Loja B", "Recife", "PE", "", ""],
        ["Loja C", "Recife", "XX", "81 98888-7776", "javascript:x"],
      ],
      mapping,
    );
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 4, 5]);
    const validated = rows.map(validateImportRow);
    expect(validated[0].valid).toBe(true);
    expect(validated[1].messages).toEqual(["Linha 4: WhatsApp não informado."]);
    expect(validated[2].messages).toContain("Linha 5: estado não reconhecido.");
    expect(validated[2].messages).toContain("Linha 5: URL inválida.");
  });
});
