// Demo data. Every business, profile and phone here is FICTITIOUS
// (reserved example domains; phone numbers in the 90000-0xxx range).
// Usage: npm run db:seed        (adds demo data if the database has no leads)
//        npm run db:seed -- --reset   (clears leads/campaigns/imports first)

import { normalizeLeadInput } from "../../shared/leadInput.js";
import { ensureDefaultUser, type DB } from "./core.js";
import { insertLead } from "../services/leads.js";

interface SeedLead {
  name: string;
  segment: string;
  neighborhood: string;
  city: string;
  state: string;
  phone: string;
  link?: string;
  extra?: string[];
  status?: "prospect" | "qualified" | "client" | "inactive";
}

const LEADS: SeedLead[] = [
  { name: "Café Aurora Demo", segment: "Cafeteria", neighborhood: "Pinheiros", city: "São Paulo", state: "SP", phone: "(11) 90000-0101", link: "@cafeaurora.demo", extra: ["https://cafe-aurora.example.com"] },
  { name: "Bistrô Horizonte Fictício", segment: "Restaurante", neighborhood: "Savassi", city: "Belo Horizonte", state: "MG", phone: "(31) 90000-0102", link: "https://bistro-horizonte.example.com", status: "qualified" },
  { name: "Studio Pilates Exemplo", segment: "Academia", neighborhood: "Batel", city: "Curitiba", state: "PR", phone: "(41) 90000-0103", link: "https://linktr.ee/studiopilatesexemplo" },
  { name: "Spa Serenidade Demo", segment: "Bem-estar", neighborhood: "Boa Viagem", city: "Recife", state: "PE", phone: "(81) 90000-0104", link: "https://www.google.com/maps/place/Spa+Serenidade+Demo" },
  { name: "Barbearia Navalha Fictícia", segment: "Beleza", neighborhood: "Centro", city: "Florianópolis", state: "SC", phone: "(48) 90000-0105" },
  { name: "Pizzaria Forno Exemplo", segment: "Restaurante", neighborhood: "Moinhos de Vento", city: "Porto Alegre", state: "RS", phone: "(51) 90000-0106", link: "https://pizzaria-forno.example.org", status: "client" },
  { name: "Loja Verde Demo", segment: "Varejo", neighborhood: "Asa Sul", city: "Brasília", state: "DF", phone: "(61) 90000-0107", link: "https://www.tiktok.com/@lojaverde.demo" },
  { name: "Doceria Nuvem Fictícia", segment: "Confeitaria", neighborhood: "Meireles", city: "Fortaleza", state: "CE", phone: "(85) 90000-0108", link: "@doceria.nuvem.demo" },
  { name: "Hamburgueria Brasa Demo", segment: "Restaurante", neighborhood: "Pinheiros", city: "São Paulo", state: "SP", phone: "(11) 90000-0109", link: "https://hamburgueria-brasa.example.net" },
  { name: "Clínica Sorriso Exemplo", segment: "Saúde", neighborhood: "Barra", city: "Salvador", state: "BA", phone: "(71) 90000-0110", link: "https://facebook.com/clinicasorrisoexemplo", status: "inactive" },
  { name: "Empório Grão Fictício", segment: "Mercearia", neighborhood: "Vila Madalena", city: "São Paulo", state: "SP", phone: "(11) 90000-0111", link: "https://emporio-grao.example.com" },
  { name: "Yoga Lótus Demo", segment: "Bem-estar", neighborhood: "Leblon", city: "Rio de Janeiro", state: "RJ", phone: "(21) 90000-0112", link: "@yogalotus.demo" },
];

// Imported prospects (a fictitious spreadsheet batch).
const IMPORTED: SeedLead[] = [
  { name: "Padaria Trigo Demo", segment: "Padaria", neighborhood: "Centro", city: "Campinas", state: "SP", phone: "(19) 90000-0201", link: "https://padaria-trigo.example.com" },
  { name: "Açaí Tropical Fictício", segment: "Lanchonete", neighborhood: "Cambuí", city: "Campinas", state: "SP", phone: "(19) 90000-0202", link: "@acaitropical.demo" },
  { name: "Pet Shop Patinhas Exemplo", segment: "Pet", neighborhood: "Taquaral", city: "Campinas", state: "SP", phone: "(19) 90000-0203" },
  { name: "Adega Vinhedo Demo", segment: "Bebidas", neighborhood: "Centro", city: "Jundiaí", state: "SP", phone: "(11) 90000-0204", link: "https://adega-vinhedo.example.org" },
];

function add(db: DB, userId: number, l: SeedLead, source: "seed" | "import", batchId: number | null): number {
  const result = normalizeLeadInput({
    establishment_name: l.name,
    segment: l.segment,
    neighborhood: l.neighborhood,
    city: l.city,
    state: l.state,
    whatsapp: l.phone,
    digital_presence_url: l.link ?? "",
    extra_links: l.extra ?? [],
  });
  if (!result.ok) throw new Error(`Seed inválido: ${l.name} ${JSON.stringify(result.errors)}`);
  return insertLead(db, result.value, { userId, source, batchId, registrationStatus: l.status ?? "prospect" });
}

export function seed(db: DB, reset = false): void {
  if (reset) {
    db.exec(`DELETE FROM contact_history; DELETE FROM campaign_leads; DELETE FROM prospect_evaluations; DELETE FROM link_previews;
      DELETE FROM lead_links; DELETE FROM import_batch_items; DELETE FROM leads; DELETE FROM campaigns; DELETE FROM import_batches;`);
  }
  const hasLeads = (db.prepare("SELECT COUNT(*) AS c FROM leads").get() as { c: number }).c > 0;
  if (hasLeads) {
    console.log("O banco já possui leads. Use --reset para recriar os dados de demonstração.");
    return;
  }
  ensureDefaultUser(db);
  const operators = db.prepare("SELECT id FROM users ORDER BY id").all() as { id: number }[];
  const userId = operators[0].id;
  const ana = (operators[1] ?? operators[0]).id; // second operator (demo data)

  db.transaction(() => {
    const ids = LEADS.map((l) => add(db, userId, l, "seed", null));

    // Lead with an invalid WhatsApp (legacy record) to demonstrate the blocking + correction flow.
    const invalidId = Number(
      db
        .prepare(
          `INSERT INTO leads (establishment_name, name_key, segment, neighborhood, city, state, whatsapp, whatsapp_valid, registration_status, source, created_by)
           VALUES ('Floricultura Pétala Demo', 'floricultura petala demo|goiania|GO', 'Floricultura', 'Setor Bueno', 'Goiânia', 'GO', '6290000', 0, 'prospect', 'seed', ?)`,
        )
        .run(userId).lastInsertRowid,
    );
    // Lead with an invalid (unreachable, reserved) link to demonstrate the "Link inválido" preview state.
    const badLinkId = add(db, userId, { name: "Ateliê Linha Fictício", segment: "Moda", neighborhood: "Centro", city: "Vitória", state: "ES", phone: "(27) 90000-0113", link: "https://atelie-linha.invalid" }, "seed", null);

    // Import batch
    const batchId = Number(
      db
        .prepare(
          `INSERT INTO import_batches (original_filename, total_rows, imported_rows, updated_rows, skipped_rows, error_rows, duplicate_rows, status, report_json, imported_by, created_at, completed_at)
           VALUES ('prospects-campinas-demo.xlsx', 6, 4, 0, 1, 1, 1, 'completed_with_errors', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'))`,
        )
        .run(
          JSON.stringify([
            { rowNumber: 6, values: { establishment_name: "Loja sem telefone", city: "Campinas", state: "SP", whatsapp: "" }, result: "erro", reason: "Linha 6: WhatsApp não informado.", leadId: null },
            { rowNumber: 7, values: { establishment_name: "Padaria Trigo Demo", city: "Campinas", state: "SP", whatsapp: "19 90000-0201" }, result: "ignorado", reason: "Duplicidade: WhatsApp repetido na planilha (linha 2).", leadId: null },
          ]),
          ana,
        ).lastInsertRowid,
    );
    const importedIds = IMPORTED.map((l, i) => {
      const id = add(db, ana, l, "import", batchId);
      db.prepare("INSERT INTO import_batch_items (batch_id, lead_id, row_number, action) VALUES (?, ?, ?, 'imported')").run(batchId, id, i + 2);
      return id;
    });

    // Campaigns
    // Fictitious alternative wordings for messages 2 and 3.
    const variant = (message: string, n: 2 | 3) =>
      n === 2
        ? message.replace(/^Olá,?/, "Oi,").replace("Podemos conversar?", "Tem 2 minutinhos para eu explicar?")
        : `Bom dia, {{nome_estabelecimento}}! ${message.replace(/^(Olá|Oi),? \{\{nome_estabelecimento\}\}! ?/, "")}`;
    const mkCampaign = (name: string, description: string, message: string, status: string, by: number) =>
      Number(
        db
          .prepare(
            `INSERT INTO campaigns (name, description, message_template, message_template_2, message_template_3, status, created_by, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?,
              CASE WHEN ? IN ('in_progress','completed') THEN strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 days') END,
              CASE WHEN ? = 'completed' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days') END)`,
          )
          .run(name, description, message, variant(message, 2), variant(message, 3), status, by, status, status).lastInsertRowid,
      );
    const running = mkCampaign(
      "Parceiros gastronomia — capitais",
      "Apresentação do programa de benefícios para restaurantes e cafeterias.",
      "Olá, {{nome_estabelecimento}}! Tudo bem? Sou do Club’n e vi o trabalho de vocês em {{bairro}}, {{cidade}}. Temos um programa de parcerias para o segmento de {{segmento}} que pode trazer novos clientes. Posso te explicar em 2 minutos?",
      "in_progress",
      userId,
    );
    const draft = mkCampaign(
      "Bem-estar e saúde — piloto",
      "Rascunho para academias, spas e clínicas.",
      "Oi, {{nome_estabelecimento}}! O Club’n conecta empresas de {{segmento}} a clientes do nosso clube em {{cidade}}/{{estado}}. Podemos conversar?",
      "draft",
      ana,
    );
    const done = mkCampaign(
      "Varejo — primeira rodada",
      "Campanha concluída de teste.",
      "Olá, {{nome_estabelecimento}}! Aqui é do Club’n. Queremos apresentar uma parceria para lojas em {{cidade}}.",
      "completed",
      userId,
    );
    const importedCampaign = mkCampaign(
      "Prospects Campinas (lote importado)",
      "Criada a partir do lote de importação de Campinas.",
      "Olá, {{nome_estabelecimento}}! Somos o Club’n e estamos chegando em {{cidade}}. Que tal conversar sobre uma parceria?",
      "ready",
      ana,
    );

    const link = (campaign: number, lead: number, status = "not_contacted", daysAgo?: number) => {
      db.prepare(
        `INSERT INTO campaign_leads (campaign_id, lead_id, contact_status, whatsapp_opened_at, last_contact_at) VALUES (?, ?, ?,
          CASE WHEN ? <> 'not_contacted' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) END,
          CASE WHEN ? <> 'not_contacted' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) END)`,
      ).run(campaign, lead, status, status, `-${daysAgo ?? 0} days`, status, `-${daysAgo ?? 0} days`);
      if (status !== "not_contacted") {
        db.prepare("UPDATE leads SET contact_status = ? WHERE id = ?").run(status, lead);
        db.prepare(
          `INSERT INTO contact_history (lead_id, campaign_id, event_type, previous_status, new_status, notes, changed_by, changed_at)
           VALUES (?, ?, 'whatsapp_opened', 'not_contacted', 'whatsapp_opened', 'WhatsApp aberto pelo operador', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now', ?))`,
        ).run(lead, campaign, userId, `-${(daysAgo ?? 0) + 1} days`);
        if (status !== "whatsapp_opened") {
          db.prepare(
            `INSERT INTO contact_history (lead_id, campaign_id, event_type, previous_status, new_status, notes, changed_by, changed_at)
             VALUES (?, ?, 'status_change', 'whatsapp_opened', ?, NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now', ?))`,
          ).run(lead, campaign, status, userId, `-${daysAgo ?? 0} days`);
        }
      }
    };
    link(running, ids[0], "interested", 1);
    link(running, ids[1], "message_sent", 2);
    link(running, ids[5], "partnership", 3);
    link(running, ids[7], "replied", 1);
    link(running, ids[8], "whatsapp_opened", 0);
    link(running, ids[10]);
    link(running, ids[11], "not_interested", 2);
    link(running, invalidId);
    link(running, badLinkId);
    link(draft, ids[2]);
    link(draft, ids[3]);
    link(draft, ids[9]);
    link(done, ids[6], "not_interested", 6);
    link(done, ids[4], "message_sent", 7);
    for (const id of importedIds) link(importedCampaign, id);

    // Manual evaluations (general + one campaign-specific)
    const evaluate = (lead: number, level: string, score: number, campaign: number | null, notes: string) =>
      db
        .prepare(
          `INSERT INTO prospect_evaluations (lead_id, campaign_id, evaluator_user_id, potential_level, score, digital_presence_quality, campaign_compatibility,
            perceived_popularity, visual_quality, checklist_data, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(lead, campaign, userId, level, score, level, level, level === "low" ? "low" : "medium", level, JSON.stringify({ active_profile: true, contact_info: level !== "low", professional_identity: level === "high" }), notes);
    evaluate(ids[0], "high", 5, null, "Perfil ativo, fotos profissionais, bom encaixe com o público do clube.");
    evaluate(ids[0], "high", 4, running, "Compatível com a campanha de gastronomia.");
    evaluate(ids[1], "medium", 3, null, "Site simples, porém com cardápio atualizado.");
    evaluate(ids[6], "low", 2, null, "Poucas publicações recentes.");

    // Cached previews (fictitious content — no real pages were accessed).
    const insertPreview = db.prepare(
      `INSERT INTO link_previews (lead_id, link_type, original_url, normalized_url, final_url, page_title, page_description, domain, favicon_url,
        open_graph_image_url, preview_status, error_code, error_message, captured_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now', ?), strftime('%Y-%m-%dT%H:%M:%fZ','now', ?))`,
    );
    const u = "https://bistro-horizonte.example.com/";
    insertPreview.run(ids[1], "site", u, u, u, "Bistrô Horizonte Fictício — cozinha contemporânea", "Menu degustação, almoço executivo e eventos privados. (Conteúdo de demonstração.)", "bistro-horizonte.example.com", "available", null, null, "-1 days", "+6 days");
    const ig = "https://www.instagram.com/cafeaurora.demo/";
    insertPreview.run(ids[0], "instagram", ig, ig, ig, "@cafeaurora.demo", null, "instagram.com", "blocked", "OFFICIAL_ACCESS_REQUIRED", "Esta plataforma só permite prévias por integração oficial. Use a imagem de capa cadastrada ou abra o link.", "-1 days", "+6 days");
    const stale = "https://pizzaria-forno.example.org/";
    insertPreview.run(ids[5], "site", stale, stale, stale, "Pizzaria Forno Exemplo", "Pizzas de fermentação natural. (Conteúdo de demonstração.)", "pizzaria-forno.example.org", "available", null, null, "-10 days", "-3 days");
    const bad = "https://atelie-linha.invalid/";
    insertPreview.run(badLinkId, "site", bad, bad, null, null, null, "atelie-linha.invalid", "invalid_link", "DNS_FAILURE", "Não foi possível localizar o domínio.", "-1 days", "+1 days");
  })();
  console.log("Dados de demonstração criados (todos fictícios).");
}
