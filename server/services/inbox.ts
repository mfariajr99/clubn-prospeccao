// "Mensagens": WhatsApp conversations of each operator's connected number.
// Runtime-agnostic (server + demo). Messages are stored per operator.
import type { ContactStatus } from "../../shared/constants.js";
import type { InboxConversation, InboxMessage } from "../../shared/types.js";
import { nowIso, type DB } from "../db/core.js";

export interface IncomingWaMessage {
  id: string;
  chatJid: string;
  /** "<digits>@s.whatsapp.net" when known (the chat may use a privacy id, @lid). */
  phoneJid?: string | null;
  fromMe: boolean;
  text: string;
  pushName?: string | null;
  timestamp: number; // ms
}

const phoneOf = (jid: string | null | undefined) => (jid && jid.endsWith("@s.whatsapp.net") ? jid.split("@")[0].split(":")[0] : null);

/** Brazilian numbers may come with or without the 9th digit. */
export function phoneVariants(digits: string): string[] {
  const out = new Set([digits]);
  const m12 = /^55(\d{2})(\d{8})$/.exec(digits);
  if (m12) out.add(`55${m12[1]}9${m12[2]}`);
  const m13 = /^55(\d{2})9(\d{8})$/.exec(digits);
  if (m13) out.add(`55${m13[1]}${m13[2]}`);
  return [...out];
}

function findLead(db: DB, phone: string | null): { id: number; contact_status: ContactStatus } | undefined {
  if (!phone) return undefined;
  const variants = phoneVariants(phone);
  return db
    .prepare(`SELECT id, contact_status FROM leads WHERE whatsapp IN (${variants.map(() => "?").join(",")}) ORDER BY id LIMIT 1`)
    .get(...variants) as { id: number; contact_status: ContactStatus } | undefined;
}

const AWAITING_REPLY: ContactStatus[] = ["whatsapp_opened", "message_sent"];

/** Stores one message. A new reply from a lead moves it (and its campaigns) to "Respondeu". */
export function storeWhatsAppMessage(db: DB, userId: number, m: IncomingWaMessage): { stored: boolean; leadId: number | null } {
  const phone = phoneOf(m.phoneJid) ?? phoneOf(m.chatJid);
  const lead = findLead(db, phone);
  return db.transaction(() => {
    const info = db
      .prepare(
        `INSERT OR IGNORE INTO whatsapp_messages (user_id, wa_id, chat_jid, phone, contact_name, from_me, body, sent_at, read, lead_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, m.id, m.chatJid, phone, m.fromMe ? null : (m.pushName ?? null), m.fromMe ? 1 : 0, m.text.slice(0, 4000), new Date(m.timestamp).toISOString(), m.fromMe ? 1 : 0, lead?.id ?? null);
    const stored = info.changes > 0;
    if (stored && phone) {
      // keep phone/lead on older messages of the same chat (e.g. chat first seen as @lid)
      db.prepare("UPDATE whatsapp_messages SET phone = COALESCE(phone, ?), lead_id = COALESCE(lead_id, ?) WHERE user_id = ? AND chat_jid = ?").run(phone, lead?.id ?? null, userId, m.chatJid);
    }
    // A reply received in the last 2 days updates the funnel (history sync of old chats does not).
    if (stored && !m.fromMe && lead && Date.now() - m.timestamp < 2 * 86400_000) {
      const now = nowIso();
      const campaignRows = db
        .prepare(
          `SELECT cl.id, cl.campaign_id, cl.contact_status FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id
           WHERE cl.lead_id = ? AND c.status IN ('in_progress','paused')`,
        )
        .all(lead.id) as { id: number; campaign_id: number; contact_status: ContactStatus }[];
      for (const cl of campaignRows) {
        if (!AWAITING_REPLY.includes(cl.contact_status)) continue;
        db.prepare("UPDATE campaign_leads SET contact_status = 'replied', last_contact_at = ?, updated_at = ? WHERE id = ?").run(now, now, cl.id);
        db.prepare(
          `INSERT INTO contact_history (lead_id, campaign_id, event_type, previous_status, new_status, notes, changed_by, changed_at)
           VALUES (?, ?, 'status_change', ?, 'replied', 'Resposta recebida pelo WhatsApp', ?, ?)`,
        ).run(lead.id, cl.campaign_id, cl.contact_status, userId, now);
      }
      if (AWAITING_REPLY.includes(lead.contact_status)) {
        db.prepare("UPDATE leads SET contact_status = 'replied', updated_at = ? WHERE id = ?").run(now, lead.id);
        if (!campaignRows.some((r) => AWAITING_REPLY.includes(r.contact_status))) {
          db.prepare(
            `INSERT INTO contact_history (lead_id, campaign_id, event_type, previous_status, new_status, notes, changed_by, changed_at)
             VALUES (?, NULL, 'status_change', ?, 'replied', 'Resposta recebida pelo WhatsApp', ?, ?)`,
          ).run(lead.id, lead.contact_status, userId, now);
        }
      }
    }
    return { stored, leadId: lead?.id ?? null };
  })();
}

export function listConversations(db: DB, userId: number, q?: string): InboxConversation[] {
  const rows = db
    .prepare(
      `SELECT m.chat_jid,
         MAX(m.phone) AS phone,
         MAX(m.lead_id) AS lead_id,
         (SELECT contact_name FROM whatsapp_messages x WHERE x.user_id = m.user_id AND x.chat_jid = m.chat_jid AND x.contact_name IS NOT NULL ORDER BY x.sent_at DESC LIMIT 1) AS contact_name,
         MAX(m.sent_at) AS last_at,
         SUM(CASE WHEN m.read = 0 AND m.from_me = 0 THEN 1 ELSE 0 END) AS unread
       FROM whatsapp_messages m WHERE m.user_id = ? GROUP BY m.chat_jid ORDER BY last_at DESC LIMIT 300`,
    )
    .all(userId) as { chat_jid: string; phone: string | null; lead_id: number | null; contact_name: string | null; last_at: string; unread: number }[];
  const last = db.prepare("SELECT body, from_me FROM whatsapp_messages WHERE user_id = ? AND chat_jid = ? ORDER BY sent_at DESC, id DESC LIMIT 1");
  const leadName = db.prepare("SELECT establishment_name FROM leads WHERE id = ?");
  const term = q?.trim().toLowerCase();
  return rows
    .map((r) => {
      const l = last.get(userId, r.chat_jid) as { body: string; from_me: 0 | 1 };
      const lead = r.lead_id ? (leadName.get(r.lead_id) as { establishment_name: string } | undefined) : undefined;
      return {
        chat_jid: r.chat_jid,
        phone: r.phone,
        lead_id: lead ? r.lead_id : null,
        lead_name: lead?.establishment_name ?? null,
        contact_name: r.contact_name,
        last_body: l.body,
        last_from_me: l.from_me === 1,
        last_at: r.last_at,
        unread: r.unread,
      };
    })
    .filter((c) => !term || [c.lead_name, c.contact_name, c.phone, c.last_body].some((v) => v?.toLowerCase().includes(term)));
}

export function conversationMessages(db: DB, userId: number, chatJid: string): InboxMessage[] {
  db.prepare("UPDATE whatsapp_messages SET read = 1 WHERE user_id = ? AND chat_jid = ? AND read = 0").run(userId, chatJid);
  return (
    db
      .prepare("SELECT id, wa_id, from_me, body, sent_at FROM whatsapp_messages WHERE user_id = ? AND chat_jid = ? ORDER BY sent_at DESC, id DESC LIMIT 300")
      .all(userId, chatJid) as { id: number; wa_id: string; from_me: 0 | 1; body: string; sent_at: string }[]
  )
    .reverse()
    .map((m) => ({ id: m.id, from_me: m.from_me === 1, body: m.body, sent_at: m.sent_at }));
}

export function unreadCount(db: DB, userId: number): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE user_id = ? AND read = 0 AND from_me = 0").get(userId) as { c: number }).c;
}
