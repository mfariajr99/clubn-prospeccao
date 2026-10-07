// Real driver: WhatsApp Web protocol through Baileys (no browser needed).
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState as loadMultiFileAuthState } from "baileys";
import pino from "pino";
import type { WaDriver } from "./manager.js";

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
    generateHighQualityLinkPreview: false,
  });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (u) => {
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
  });
  return {
    requestPairingCode: (phone) => sock.requestPairingCode(phone),
    resolve: async (phone) => {
      const result = await sock.onWhatsApp(phone);
      const hit = result?.find((r) => r.exists);
      return hit ? hit.jid : null;
    },
    sendText: async (jid, text) => {
      await sock.sendMessage(jid, { text });
    },
    logout: () => sock.logout(),
    end: () => sock.end(undefined),
  };
};
