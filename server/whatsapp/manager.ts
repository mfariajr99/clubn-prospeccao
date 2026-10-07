// WhatsApp "conexão própria": each operator links their own WhatsApp number to
// the system (QR Code or pairing code, like WhatsApp Web) and messages are sent
// through it — one click = one message, never in batch.
//
// Not the official Meta API: it uses the WhatsApp Web protocol (Baileys).
// Sessions are stored on disk (persistent disk on Render) so a redeploy does not
// require scanning again.
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import type { WhatsAppStatus } from "../../shared/types.js";
import { HttpError } from "../lib/http.js";

export interface WaConnection {
  requestPairingCode(phoneDigits: string): Promise<string>;
  /** WhatsApp id (JID) of a phone number, or null when the number has no WhatsApp. */
  resolve(phoneDigits: string): Promise<string | null>;
  sendText(jid: string, text: string): Promise<void>;
  logout(): Promise<void>;
  end(): void;
}

export interface WaDriverEvents {
  onQr(qr: string): void;
  onOpen(me: { id: string; name?: string | null }): void;
  onClose(info: { loggedOut: boolean; restartRequired: boolean; code?: number; message?: string }): void;
}

/** Starts one WhatsApp Web connection using the credentials stored in `authDir`. */
export type WaDriver = (authDir: string, events: WaDriverEvents) => Promise<WaConnection>;

interface Session {
  key: string;
  dir: string;
  status: WhatsAppStatus;
  conn: WaConnection | null;
  generation: number;
  pairingPhone: string | null;
  pairingRequested: boolean;
  qrCount: number;
  retries: number;
  sending: boolean;
  openWaiters: (() => void)[];
}

const MAX_QR = 6; // ~2 minutes of QR codes before giving up
const MAX_RETRIES = 6;
const SEND_TIMEOUT_MS = 25_000;

const emptyStatus = (): WhatsAppStatus => ({
  state: "disconnected",
  qr: null,
  pairing_code: null,
  phone: null,
  name: null,
  error: null,
  updated_at: new Date().toISOString(),
});

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new HttpError(504, message)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export const normalizePairingPhone = (phone: string) => phone.replace(/\D/g, "");

export class WhatsAppManager {
  private sessions = new Map<string, Session>();

  constructor(
    private baseDir: string,
    private driver: WaDriver,
    private log: (msg: string) => void = () => undefined,
  ) {}

  /** Session key: one WhatsApp per operator inside each workspace. */
  static key(workspace: string, userId: number) {
    return `${workspace.replace(/[^\w.-]/g, "_")}/user-${userId}`;
  }

  private dirFor(key: string) {
    return path.join(this.baseDir, ...key.split("/"));
  }

  private hasCredentials(dir: string) {
    try {
      const creds = JSON.parse(fs.readFileSync(path.join(dir, "creds.json"), "utf8")) as { me?: unknown; registered?: boolean };
      return Boolean(creds.me);
    } catch {
      return false;
    }
  }

  private session(key: string): Session {
    let s = this.sessions.get(key);
    if (!s) {
      s = {
        key,
        dir: this.dirFor(key),
        status: emptyStatus(),
        conn: null,
        generation: 0,
        pairingPhone: null,
        pairingRequested: false,
        qrCount: 0,
        retries: 0,
        sending: false,
        openWaiters: [],
      };
      this.sessions.set(key, s);
    }
    return s;
  }

  private set(s: Session, patch: Partial<WhatsAppStatus>) {
    s.status = { ...s.status, ...patch, updated_at: new Date().toISOString() };
  }

  /** Current status. A saved session (e.g. after a redeploy) reconnects by itself. */
  status(key: string): WhatsAppStatus {
    const s = this.session(key);
    if (s.status.state === "disconnected" && !s.conn && this.hasCredentials(s.dir)) void this.start(s);
    return s.status;
  }

  /** Reconnects every saved session (called when the server starts). */
  restoreAll() {
    const walk = (dir: string, depth: number) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const full = path.join(dir, e.name);
        if (depth === 1 && e.name.startsWith("user-") && this.hasCredentials(full)) {
          const key = path.relative(this.baseDir, full).split(path.sep).join("/");
          void this.start(this.session(key));
        } else if (depth === 0) walk(full, 1);
      }
    };
    walk(this.baseDir, 0);
  }

  /** Starts linking: QR Code, or pairing code for the given phone number. */
  async connect(key: string, options: { method: "qr" | "code"; phone?: string }): Promise<WhatsAppStatus> {
    const s = this.session(key);
    if (s.status.state === "connected") return s.status;
    let phone: string | null = null;
    if (options.method === "code") {
      phone = normalizePairingPhone(options.phone ?? "");
      if (phone.length < 12 || phone.length > 15) {
        throw new HttpError(422, "Informe o número do WhatsApp com DDI e DDD, ex.: 55 11 91234-5678.", { fields: { phone: "Número inválido." } });
      }
    }
    // A new linking attempt always starts from a clean session.
    this.stop(s);
    if (!this.hasCredentials(s.dir)) fs.rmSync(s.dir, { recursive: true, force: true });
    s.pairingPhone = phone;
    s.pairingRequested = false;
    s.qrCount = 0;
    s.retries = 0;
    this.set(s, { state: "connecting", qr: null, pairing_code: null, error: null });
    await this.start(s);
    // Give the first QR / pairing code a moment so the screen can show it right away.
    await this.waitFor(s, () => s.status.state !== "connecting", 8000);
    return s.status;
  }

  async disconnect(key: string): Promise<WhatsAppStatus> {
    const s = this.session(key);
    const conn = s.conn;
    this.stop(s);
    if (conn) await conn.logout().catch(() => undefined);
    fs.rmSync(s.dir, { recursive: true, force: true });
    s.status = emptyStatus();
    return s.status;
  }

  /** Sends ONE text message through the operator's connected WhatsApp. */
  async send(key: string, phoneDigits: string, text: string): Promise<{ jid: string }> {
    const s = this.session(key);
    if (s.status.state !== "connected" && this.hasCredentials(s.dir)) {
      if (!s.conn) void this.start(s);
      await this.waitFor(s, () => s.status.state === "connected", 10_000);
    }
    if (s.status.state !== "connected" || !s.conn) {
      throw new HttpError(409, "Seu WhatsApp não está conectado. Conecte em “Conexão WhatsApp” ou envie pelo WhatsApp do aparelho.", { code: "WA_NOT_CONNECTED" });
    }
    if (s.sending) throw new HttpError(409, "Aguarde: a mensagem anterior ainda está sendo enviada.");
    s.sending = true;
    try {
      const conn = s.conn;
      const jid = await withTimeout(conn.resolve(phoneDigits), SEND_TIMEOUT_MS, "O WhatsApp demorou para responder. Tente novamente.");
      if (!jid) throw new HttpError(422, "Este número não tem WhatsApp. Confira o cadastro do lead.");
      await withTimeout(conn.sendText(jid, text), SEND_TIMEOUT_MS, "O WhatsApp demorou para confirmar o envio. Confira no celular antes de tentar de novo.");
      return { jid };
    } finally {
      s.sending = false;
    }
  }

  shutdown() {
    for (const s of this.sessions.values()) this.stop(s);
  }

  // ---------------------------------------------------------------- internals

  private stop(s: Session) {
    s.generation++;
    const conn = s.conn;
    s.conn = null;
    try {
      conn?.end();
    } catch {
      /* ignore */
    }
  }

  private waitFor(_s: Session, done: () => boolean, ms: number): Promise<void> {
    if (done()) return Promise.resolve();
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (done() || Date.now() - started > ms) return resolve();
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  private async start(s: Session): Promise<void> {
    const generation = ++s.generation;
    const current = () => s.generation === generation;
    fs.mkdirSync(s.dir, { recursive: true });
    if (s.status.state === "disconnected") this.set(s, { state: "connecting", error: null });
    try {
      const conn = await this.driver(s.dir, {
        onQr: (qr) => {
          if (!current()) return;
          s.qrCount++;
          if (s.qrCount > MAX_QR) {
            this.stop(s);
            this.set(s, { state: "disconnected", qr: null, pairing_code: null, error: "Tempo esgotado. Gere um novo QR Code ou código de conexão." });
            return;
          }
          if (s.pairingPhone) {
            if (s.pairingRequested) return;
            s.pairingRequested = true;
            const phone = s.pairingPhone;
            const waitConn = async () => {
              for (let i = 0; i < 50 && !s.conn && current(); i++) await new Promise((r) => setTimeout(r, 100));
              if (!s.conn) throw new Error("conexão não iniciada");
              return s.conn.requestPairingCode(phone);
            };
            void waitConn()
              .then((code) => {
                if (!current()) return;
                const pretty = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
                this.set(s, { state: "pairing", pairing_code: pretty, qr: null, error: null });
              })
              .catch((e: Error) => {
                if (!current()) return;
                this.stop(s);
                this.set(s, { state: "disconnected", error: `Não foi possível gerar o código: ${e.message}. Tente pelo QR Code.` });
              });
            return;
          }
          QRCode.toDataURL(qr, { margin: 1, width: 280 })
            .then((dataUrl) => {
              if (current()) this.set(s, { state: "qr", qr: dataUrl, pairing_code: null, error: null });
            })
            .catch(() => undefined);
        },
        onOpen: (me) => {
          if (!current()) return;
          s.retries = 0;
          s.pairingPhone = null;
          const phone = me.id.split(":")[0].split("@")[0];
          this.set(s, { state: "connected", qr: null, pairing_code: null, error: null, phone, name: me.name ?? null });
          this.log(`WhatsApp conectado: ${s.key}`);
        },
        onClose: (info) => {
          if (!current()) return;
          this.log(`WhatsApp ${s.key}: conexão encerrada (código ${info.code ?? "?"}${info.message ? `: ${info.message}` : ""})`);
          s.conn = null;
          if (info.loggedOut) {
            fs.rmSync(s.dir, { recursive: true, force: true });
            s.status = { ...emptyStatus(), error: "O WhatsApp foi desconectado pelo celular. Conecte novamente." };
            return;
          }
          const registered = this.hasCredentials(s.dir);
          // After scanning/pairing, WhatsApp asks for a restart: reconnect right away.
          if (info.restartRequired || (registered && s.retries < MAX_RETRIES)) {
            s.retries++;
            this.set(s, { state: "connecting", qr: null, pairing_code: null });
            setTimeout(() => current() && void this.start(s), info.restartRequired ? 200 : Math.min(30_000, 1000 * 2 ** s.retries));
            return;
          }
          this.set(s, {
            state: "disconnected",
            qr: null,
            pairing_code: null,
            error: registered
              ? "Conexão perdida com o WhatsApp. Tente conectar novamente."
              : (s.status.error ?? `Não foi possível falar com o WhatsApp${info.code ? ` (código ${info.code})` : ""}. Tente novamente em instantes.`),
          });
        },
      });
      if (!current()) {
        conn.end();
        return;
      }
      s.conn = conn;
    } catch (e) {
      if (!current()) return;
      this.set(s, { state: "disconnected", error: `Falha ao iniciar a conexão: ${(e as Error).message}` });
    }
  }
}
