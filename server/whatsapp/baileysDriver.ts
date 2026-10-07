// Real driver: WhatsApp Web protocol through Baileys (no browser needed).
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState as loadMultiFileAuthState } from "baileys";
import pino from "pino";
import type { WaDriver } from "./manager.js";
import type { IncomingWaMessage } from "../services/inbox.js";

type AnyMsg = {
  key: { id?: string | null; remoteJid?: string | null; remoteJidAlt?: string; fromMe?: boolean | null };
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | { toNumber(): number } | null;
  pushName?: string | null;
};

const SKIP_JID = /@(g\.us|broadcast|newsletter)$/;
const HISTORY_DAYS = 7;

/** Text of a WhatsApp message (media shown as a label). */
function textOf(message: Record<string, unknown> | null | undefined): string | null {
  if (!message) return null;
  const m = message as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
    documentMessage?: { fileName?: string; caption?: string };
    audioMessage?: unknown;
    stickerMessage?: unknown;
    locationMessage?: unknown;
    contactMessage?: { displayName?: string };
    ephemeralMessage?: { message?: Record<string, unknown> };
    viewOnceMessageV2?: { message?: Record<string, unknown> };
    documentWithCaptionMessage?: { message?: Record<string, unknown> };
  };
  if (m.ephemeralMessage?.message) return textOf(m.ephemeralMessage.message);
  if (m.viewOnceMessageV2?.message) return textOf(m.viewOnceMessageV2.message);
  if (m.documentWithCaptionMessage?.message) return textOf(m.documentWithCaptionMessage.message);
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage) return `📷 Imagem${m.imageMessage.caption ? `: ${m.imageMessage.caption}` : ""}`;
  if (m.videoMessage) return `🎬 Vídeo${m.videoMessage.caption ? `: ${m.videoMessage.caption}` : ""}`;
  if (m.audioMessage) return "🎤 Áudio";
  if (m.documentMessage) return `📄 ${m.documentMessage.fileName ?? "Documento"}`;
  if (m.stickerMessage) return "Figurinha";
  if (m.locationMessage) return "📍 Localização";
  if (m.contactMessage) return `👤 Contato${m.contactMessage.displayName ? `: ${m.contactMessage.displayName}` : ""}`;
  return null;
}

function toIncoming(list: AnyMsg[], minTime = 0): IncomingWaMessage[] {
  const out: IncomingWaMessage[] = [];
  for (const msg of list) {
    const jid = msg.key?.remoteJid;
    if (!jid || !msg.key.id || SKIP_JID.test(jid)) continue;
    const text = textOf(msg.message);
    if (!text) continue;
    const ts = msg.messageTimestamp;
    const seconds = typeof ts === "number" ? ts : ts && typeof ts === "object" ? ts.toNumber() : Date.now() / 1000;
    const timestamp = seconds * 1000;
    if (timestamp < minTime) continue;
    const alt = msg.key.remoteJidAlt;
    out.push({
      id: msg.key.id,
      chatJid: jid,
      phoneJid: jid.endsWith("@s.whatsapp.net") ? jid : alt && alt.endsWith("@s.whatsapp.net") ? alt : null,
      fromMe: Boolean(msg.key.fromMe),
      text,
      pushName: msg.pushName ?? null,
      timestamp,
    });
  }
  return out;
}

const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL ?? "silent" });

export const baileysDriver: WaDriver = async (authDir, events) => {
  const { state, saveCreds } = await loadMultiFileAuthState(authDir);
  const latest = await fetchLatestBaileysVersion().catch(() => null);
  const sock = makeWASocket({
    auth: state,
    ...(latest?.version ? { version: latest.version } : {}),
    browser: Browsers.macOS("Chrome"),
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    // Recent chats are needed for "Mensagens"; older history is ignored when stored.
    generateHighQualityLinkPreview: false,
  });
  sock.ev.on("creds.update", () => {
    saveCreds().catch((e: Error) => console.error("[whatsapp] falha ao salvar a sessão:", e.message));
  });
  sock.ev.on("messages.upsert", ({ messages }) => {
    try {
      events.onMessages?.(toIncoming(messages as unknown as AnyMsg[]));
    } catch (e) {
      console.error("[whatsapp] erro ao ler mensagens:", (e as Error).message);
    }
  });
  sock.ev.on("messaging-history.set", ({ messages }) => {
    try {
      events.onMessages?.(toIncoming(messages as unknown as AnyMsg[], Date.now() - HISTORY_DAYS * 86400_000));
    } catch (e) {
      console.error("[whatsapp] erro ao ler o histórico:", (e as Error).message);
    }
  });
  sock.ev.on("connection.update", (u) => {
    try {
      handleUpdate(u);
    } catch (e) {
      console.error("[whatsapp] erro ao tratar a conexão:", (e as Error).message);
    }
  });
  function handleUpdate(u: { qr?: string; connection?: string; lastDisconnect?: { error?: unknown } }) {
    if (u.qr) events.onQr(u.qr);
    if (u.connection === "open" && sock.user) events.onOpen({ id: sock.user.id, name: sock.user.name ?? sock.user.verifiedName ?? null });
    if (u.connection === "close") {
      const err = u.lastDisconnect?.error as { output?: { statusCode?: number }; message?: string } | undefined;
      const code = err?.output?.statusCode;
      events.onClose({
        code,
        message: err?.message,
        loggedOut: code === DisconnectReason.loggedOut,
        restartRequired: code === DisconnectReason.restartRequired,
      });
    }
  }
  return {
    requestPairingCode: (phone) => sock.requestPairingCode(phone),
    resolve: async (phone) => {
      const result = await sock.onWhatsApp(phone);
      const hit = result?.find((r) => r.exists);
      return hit ? hit.jid : null;
    },
    sendText: async (jid, text) => {
      const sent = await sock.sendMessage(jid, { text });
      return { id: sent?.key?.id ?? null };
    },
    logout: () => sock.logout(),
    end: () => sock.end(undefined),
  };
};
