import { z } from "zod";
import {
  CAMPAIGN_STATUSES,
  CONTACT_STATUSES,
  LINK_TYPES,
  POTENTIAL_LEVELS,
  QUALITY_LEVELS,
  REGISTRATION_STATUSES,
} from "../shared/constants.js";
import { IMPORT_FIELDS } from "../shared/importMapping.js";
import { normalizeLeadInput } from "../shared/leadInput.js";
import { sanitizeText } from "../shared/text.js";
import type { User } from "../shared/types.js";
import type { DB } from "./db/core.js";
import { HttpError, intParam, parseBody } from "./lib/http.js";
import {
  addLeadsToCampaign,
  campaignResults,
  changeCampaignStatus,
  createCampaign,
  duplicateCampaign,
  getCampaign,
  listCampaignLeads,
  listCampaigns,
  removeLeadFromCampaign,
  updateCampaign,
} from "./services/campaigns.js";
import { dashboardMetrics } from "./services/dashboard.js";
import { listEvaluations, saveEvaluation } from "./services/evaluations.js";
import { getQuota } from "./services/quota.js";
import { analyzeImport, batchReport, commitImport, getBatch, listBatches, reportToCsv } from "./services/imports.js";
import {
  changeContactStatus,
  checkDuplicates,
  distinctValues,
  getLead,
  insertLead,
  leadCampaigns,
  leadHistory,
  listLeads,
  registerWhatsAppOpened,
  updateLeadRecord,
  type LeadFilter,
} from "./services/leads.js";
import type { LinkPreview } from "../shared/types.js";

/** What the API needs from the preview implementation (server: real captures; demo: offline). */
export interface PreviewProvider {
  listForLead(leadId: number): LinkPreview[];
  request(leadId: number, url: string, force?: boolean): LinkPreview;
}

export type Query = Record<string, unknown>;
export interface ApiRequest {
  params: Record<string, string>;
  query: Query;
  body: unknown;
  user: User;
}
export interface ApiResult {
  status: number;
  body: unknown;
  contentType?: string;
  headers?: Record<string, string>;
}
type Handler = (req: ApiRequest) => ApiResult;

const ok = (status: number, body: unknown): ApiResult => ({ status, body });

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

function leadFilterFromQuery(q: Query): LeadFilter & { page?: number; pageSize?: number; sort?: string; dir?: "asc" | "desc" } {
  return {
    q: str(q.q),
    segment: str(q.segment),
    neighborhood: str(q.neighborhood),
    city: str(q.city),
    state: str(q.state),
    registration_status: str(q.registration_status),
    contact_status: str(q.contact_status),
    batch_id: num(q.batch_id),
    presence: str(q.presence),
    potential: str(q.potential),
    not_in_campaign: num(q.not_in_campaign),
    page: num(q.page),
    pageSize: num(q.pageSize),
    sort: str(q.sort),
    dir: q.dir === "asc" ? "asc" : "desc",
  };
}

const leadFilterSchema = z
  .object({
    q: z.string().optional(),
    segment: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    registration_status: z.string().optional(),
    contact_status: z.string().optional(),
    batch_id: z.coerce.number().int().positive().optional(),
    presence: z.string().optional(),
    potential: z.string().optional(),
    not_in_campaign: z.coerce.number().int().positive().optional(),
  })
  .strip();

const leadBodySchema = z.object({
  establishment_name: z.string().max(300).optional(),
  segment: z.string().max(200).optional(),
  neighborhood: z.string().max(200).optional(),
  city: z.string().max(200).optional(),
  state: z.string().max(100).optional(),
  whatsapp: z.string().max(60).optional(),
  digital_presence_url: z.string().max(2100).optional().nullable(),
  extra_links: z.array(z.string().max(2100)).max(5).optional(),
  cover_image_url: z.string().max(2100).optional().nullable(),
  registration_status: z.enum(REGISTRATION_STATUSES).optional(),
  allow_possible_duplicate: z.boolean().optional(),
});

const campaignBodySchema = z.object({
  name: z.string().trim().min(3, "Informe o nome da campanha (mínimo 3 caracteres).").max(120),
  description: z.string().max(1000).default(""),
  message_template: z.string().trim().min(5, "Escreva a mensagem 1.").max(3000),
  message_template_2: z.string().trim().min(5, "Escreva a mensagem 2.").max(3000),
  message_template_3: z.string().trim().min(5, "Escreva a mensagem 3.").max(3000),
  status: z.enum(["draft", "ready"]).default("draft"),
  lead_ids: z.array(z.number().int().positive()).max(20000).optional(),
  lead_filter: leadFilterSchema.optional(),
});

const importRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  values: z.object(Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, z.string().max(2100).default("")])) as Record<string, z.ZodDefault<z.ZodString>>),
});

const importBodySchema = z.object({
  filename: z.string().max(255),
  rows: z.array(importRowSchema).max(10000),
});

const quality = z.enum(QUALITY_LEVELS).nullable().optional();
const evaluationSchema = z.object({
  campaign_id: z.number().int().positive().nullable().optional(),
  potential_level: z.enum(POTENTIAL_LEVELS),
  score: z.number().int().min(1).max(5),
  digital_presence_quality: quality,
  campaign_compatibility: quality,
  perceived_popularity: quality,
  visual_quality: quality,
  checklist_data: z.record(z.string(), z.boolean()).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

/**
 * Framework-agnostic API: the same routes are served by Express (server/app.ts)
 * and by the in-browser demo build (src/demo), so both behave identically.
 */
export function createApiRouter(db: DB, previews: PreviewProvider) {
  const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
  const route = (method: string, path: string, handler: Handler) => {
    const keys: string[] = [];
    const pattern = new RegExp("^" + path.replace(/[.]/g, "\\.").replace(/:(\w+)/g, (_m, k: string) => (keys.push(k), "([^/]+)")) + "$");
    routes.push({ method, pattern, keys, handler });
  };


  // ---------------- Users ----------------
  // Sending discipline of the current operator (header counter).
  route("GET", "/quota", (req) => ok(200, getQuota(db, req.user.id)));

  route("GET", "/me", (req) => {
    return ok(200, req.user);
  });
  route("GET", "/users", (_req) => {
    return ok(200, db.prepare("SELECT id, name, email FROM users ORDER BY name").all());
  });
  route("POST", "/users", (req) => {
    const body = parseBody(z.object({ name: z.string().trim().min(2).max(80), email: z.email().max(120) }), req.body);
    try {
      const info = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)").run(sanitizeText(body.name, 80), body.email.toLowerCase());
      return ok(201, { id: Number(info.lastInsertRowid), name: body.name, email: body.email.toLowerCase() });
    } catch {
      throw new HttpError(409, "Já existe um usuário com este e-mail.");
    }
  });

  // ---------------- Dashboard ----------------
  route("GET", "/dashboard", (_req) => {
    return ok(200, dashboardMetrics(db));
  });

  // ---------------- Leads ----------------
  route("GET", "/leads", (req) => {
    return ok(200, listLeads(db, leadFilterFromQuery(req.query)));
  });
  route("GET", "/leads/facets", (_req) => {
    return ok(200, distinctValues(db));
  });
  route("POST", "/leads/check-duplicates", (req) => {
    const body = parseBody(leadBodySchema.extend({ exclude_id: z.number().int().optional() }), req.body);
    const normalized = normalizeLeadInput(body);
    if (!normalized.ok) return ok(200, { phone: null, nameLocation: [] });
    return ok(200, checkDuplicates(db, normalized.value, body.exclude_id));
  });
  route("GET", "/leads/:id", (req) => {
    const id = intParam(req.params.id);
    return ok(200, { ...getLead(db, id), campaigns: leadCampaigns(db, id), evaluations: listEvaluations(db, id) });
  });
  route("POST", "/leads", (req) => {
    const body = parseBody(leadBodySchema, req.body);
    const normalized = normalizeLeadInput(body);
    if (!normalized.ok) throw new HttpError(422, "Verifique os campos destacados.", { fields: normalized.errors });
    const dup = checkDuplicates(db, normalized.value);
    if (dup.phone) {
      throw new HttpError(409, `Já existe um lead com este WhatsApp: ${dup.phone.establishment_name}.`, { fields: { whatsapp: "WhatsApp já cadastrado." }, existing_id: dup.phone.id });
    }
    if (dup.nameLocation.length && !body.allow_possible_duplicate) {
      throw new HttpError(409, "Possível duplicidade: já existe um lead com o mesmo nome, cidade e estado.", {
        possible_duplicate: true,
        existing_id: dup.nameLocation[0].id,
      });
    }
    const id = db.transaction(() =>
      insertLead(db, normalized.value, { userId: req.user.id, source: "manual", registrationStatus: body.registration_status ?? "prospect" }),
    )();
    return ok(201, getLead(db, id));
  });
  route("PUT", "/leads/:id", (req) => {
    const id = intParam(req.params.id);
    getLead(db, id);
    const body = parseBody(leadBodySchema, req.body);
    const normalized = normalizeLeadInput(body);
    if (!normalized.ok) throw new HttpError(422, "Verifique os campos destacados.", { fields: normalized.errors });
    const dup = checkDuplicates(db, normalized.value, id);
    if (dup.phone) throw new HttpError(409, `Já existe outro lead com este WhatsApp: ${dup.phone.establishment_name}.`, { fields: { whatsapp: "WhatsApp já cadastrado." } });
    db.transaction(() => updateLeadRecord(db, id, normalized.value, body.registration_status))();
    return ok(200, getLead(db, id));
  });
  route("GET", "/leads/:id/history", (req) => {
    return ok(200, leadHistory(db, intParam(req.params.id)));
  });
  // Records ONLY the "WhatsApp aberto" event. There is no endpoint that sends messages.
  route("POST", "/leads/:id/whatsapp-opened", (req) => {
    const body = parseBody(
      z.object({ campaign_id: z.number().int().positive().nullable().optional(), message_type: z.number().int().min(1).max(3).nullable().optional() }),
      req.body ?? {},
    );
    return ok(
      200,
      registerWhatsAppOpened(db, { leadId: intParam(req.params.id), campaignId: body.campaign_id ?? null, userId: req.user.id, messageType: body.message_type ?? null }),
    );
  });
  route("POST", "/leads/:id/contact-status", (req) => {
    const body = parseBody(
      z.object({ status: z.enum(CONTACT_STATUSES), notes: z.string().max(2000).nullable().optional(), campaign_id: z.number().int().positive().nullable().optional() }),
      req.body,
    );
    return ok(200, 
      changeContactStatus(db, {
        leadId: intParam(req.params.id),
        campaignId: body.campaign_id ?? null,
        status: body.status,
        notes: sanitizeText(body.notes, 2000) || null,
        userId: req.user.id,
      }),
    );
  });

  // ---------------- Previews (technical only) ----------------
  route("GET", "/leads/:id/previews", (req) => {
    return ok(200, previews.listForLead(intParam(req.params.id)));
  });
  route("POST", "/leads/:id/previews", (req) => {
    const body = parseBody(z.object({ url: z.string().max(2100), force: z.boolean().optional() }), req.body);
    return ok(200, previews.request(intParam(req.params.id), body.url, body.force ?? false));
  });

  // ---------------- Evaluations ----------------
  route("GET", "/leads/:id/evaluations", (req) => {
    return ok(200, listEvaluations(db, intParam(req.params.id)));
  });
  route("PUT", "/leads/:id/evaluations", (req) => {
    const body = parseBody(evaluationSchema, req.body);
    return ok(200, saveEvaluation(db, intParam(req.params.id), body, req.user.id));
  });

  // ---------------- Imports ----------------
  // Analysis never writes to the database.
  route("POST", "/imports/analyze", (req) => {
    const body = parseBody(importBodySchema, req.body);
    return ok(200, analyzeImport(db, body.filename, body.rows as never));
  });
  route("POST", "/imports/commit", (req) => {
    const body = parseBody(
      importBodySchema.extend({
        confirmed: z.literal(true, { message: "Confirme a importação." }),
        duplicate_action: z.enum(["skip", "update", "review"]),
        decisions: z.record(z.string(), z.enum(["skip", "update", "import"])).optional(),
      }),
      req.body,
    );
    const result = commitImport(db, { filename: body.filename, rows: body.rows as never, duplicateAction: body.duplicate_action, decisions: body.decisions }, req.user.id);
    return ok(201, result);
  });
  route("GET", "/imports", (req) => {
    return ok(200, listBatches(db, num(req.query.page) ?? 1, Math.min(100, num(req.query.pageSize) ?? 20)));
  });
  route("GET", "/imports/:id", (req) => {
    const id = intParam(req.params.id);
    return ok(200, { ...getBatch(db, id), report: batchReport(db, id) });
  });
  route("GET", "/imports/:id/report.csv", (req) => {
    const id = intParam(req.params.id);
    const batch = getBatch(db, id);
    const safeName = batch.original_filename.replace(/[^\w.-]+/g, "_").replace(/\.(xlsx|xls|csv)$/i, "");
    return {
      status: 200,
      body: reportToCsv(batchReport(db, id)),
      contentType: "text/csv; charset=utf-8",
      headers: { "Content-Disposition": `attachment; filename="relatorio-lote-${id}-${safeName}.csv"` },
    };
  });

  // ---------------- Campaigns ----------------
  route("GET", "/campaigns", (req) => {
    const statuses = typeof req.query.statuses === "string" ? req.query.statuses.split(",").filter((s) => (CAMPAIGN_STATUSES as readonly string[]).includes(s)) : undefined;
    return ok(200, 
      listCampaigns(db, {
        q: str(req.query.q),
        status: str(req.query.status),
        statuses,
        page: num(req.query.page),
        pageSize: num(req.query.pageSize),
        sort: str(req.query.sort),
        dir: str(req.query.dir),
      }),
    );
  });
  route("POST", "/campaigns", (req) => {
    const body = parseBody(campaignBodySchema, req.body);
    const campaign = createCampaign(
      db,
      {
        name: sanitizeText(body.name, 120),
        description: sanitizeText(body.description, 1000),
        message_template: body.message_template.trim(),
        message_template_2: body.message_template_2.trim(),
        message_template_3: body.message_template_3.trim(),
        status: body.status,
      },
      req.user.id,
      body.lead_ids?.length ? { leadIds: body.lead_ids } : body.lead_filter ? { filter: body.lead_filter } : undefined,
    );
    return ok(201, campaign);
  });
  route("GET", "/campaigns/:id", (req) => {
    return ok(200, getCampaign(db, intParam(req.params.id)));
  });
  route("PUT", "/campaigns/:id", (req) => {
    const id = intParam(req.params.id);
    const body = parseBody(campaignBodySchema, req.body);
    db.transaction(() => {
      if (body.lead_ids?.length) addLeadsToCampaign(db, id, { leadIds: body.lead_ids });
      else if (body.lead_filter) addLeadsToCampaign(db, id, { filter: body.lead_filter });
      updateCampaign(db, id, {
        name: sanitizeText(body.name, 120),
        description: sanitizeText(body.description, 1000),
        message_template: body.message_template.trim(),
        message_template_2: body.message_template_2.trim(),
        message_template_3: body.message_template_3.trim(),
        status: body.status,
      });
    })();
    return ok(200, getCampaign(db, id));
  });
  route("POST", "/campaigns/:id/status", (req) => {
    const body = parseBody(z.object({ status: z.enum(CAMPAIGN_STATUSES) }), req.body);
    return ok(200, changeCampaignStatus(db, intParam(req.params.id), body.status));
  });
  route("POST", "/campaigns/:id/duplicate", (req) => {
    return ok(201, duplicateCampaign(db, intParam(req.params.id), req.user.id));
  });
  route("GET", "/campaigns/:id/leads", (req) => {
    const filter = leadFilterFromQuery(req.query);
    return ok(200, 
      listCampaignLeads(db, intParam(req.params.id), {
        ...filter,
        contact_status: undefined,
        campaign_contact_status: str(req.query.contact_status),
        dir: req.query.dir === "desc" ? "desc" : "asc",
      }),
    );
  });
  route("POST", "/campaigns/:id/leads", (req) => {
    const body = parseBody(z.object({ lead_ids: z.array(z.number().int().positive()).max(20000).optional(), filter: leadFilterSchema.optional() }), req.body);
    if (!body.lead_ids?.length && !body.filter) throw new HttpError(400, "Selecione os leads ou informe um filtro.");
    return ok(200, addLeadsToCampaign(db, intParam(req.params.id), { leadIds: body.lead_ids, filter: body.filter }));
  });
  route("DELETE", "/campaigns/:id/leads/:leadId", (req) => {
    removeLeadFromCampaign(db, intParam(req.params.id), intParam(req.params.leadId, "leadId"));
    return ok(204, null);
  });
  route("GET", "/campaigns/:id/results", (req) => {
    return ok(200, campaignResults(db, intParam(req.params.id)));
  });

  route("GET", "/meta", (_req) => {
    return ok(200, { link_types: LINK_TYPES });
  });


  /** Resolves the current operator (header X-User-Id; falls back to the first user). */
  function resolveUser(userId: unknown): User {
    const id = Number(userId);
    let user = Number.isInteger(id) && id > 0 ? (db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(id) as User | undefined) : undefined;
    if (!user) user = db.prepare("SELECT id, name, email FROM users ORDER BY id LIMIT 1").get() as User | undefined;
    if (!user) throw new HttpError(500, "Nenhum usuário cadastrado. Execute npm run db:migrate.");
    return user;
  }

  /** Dispatches a request. `path` is relative to /api (e.g. "/leads/3"). Throws HttpError. */
  function handle(method: string, path: string, query: Query, body: unknown, userId: unknown): ApiResult {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(path);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return r.handler({ params, query, body, user: resolveUser(userId) });
    }
    throw new HttpError(404, "Rota não encontrada.");
  }

  return { handle };
}
