import path from "node:path";
import { createApp } from "./app.js";
import { defaultDbFile, ensureDefaultUser, openDatabase, runMigrations } from "./db/connection.js";
import { PreviewService } from "./services/preview/previewService.js";
import { createPlaywrightScreenshotter, screenshotsEnabled } from "./services/preview/screenshot.js";
import os from "node:os";
import { WhatsAppManager } from "./whatsapp/manager.js";
import { baileysDriver } from "./whatsapp/baileysDriver.js";

const db = openDatabase(defaultDbFile());
runMigrations(db);
ensureDefaultUser(db);

const storageDir = process.env.PREVIEW_STORAGE_DIR ?? path.resolve(process.cwd(), "data", "screenshots");
const previews = new PreviewService(db, {
  storageDir,
  screenshotter: screenshotsEnabled() ? createPlaywrightScreenshotter() : null,
});

// Each client account has its own database file next to the main one
// (on Render: inside the persistent disk), so client data never mixes.
const mainFile = defaultDbFile();
const tenantDbs: { close(): void }[] = [];
// WhatsApp sessions live on the same persistent disk as the databases, so a
// redeploy keeps every operator connected.
const whatsappDir = process.env.WHATSAPP_SESSIONS_DIR ?? (mainFile === ":memory:" ? path.join(os.tmpdir(), "clubn-whatsapp") : path.join(path.dirname(mainFile), "whatsapp"));
const whatsapp = new WhatsAppManager(whatsappDir, baileysDriver, (msg) => console.log(msg));
whatsapp.restoreAll();
const app = createApp({
  db,
  previews,
  staticDir: path.resolve(process.cwd(), "dist"),
  whatsapp,
  openTenant: ({ id: accountId, storageKey }) => {
    const file = mainFile === ":memory:" ? ":memory:" : path.join(path.dirname(mainFile), "accounts", `cliente-${accountId}-${storageKey}.db`);
    const tdb = openDatabase(file);
    tenantDbs.push(tdb);
    return {
      db: tdb,
      previews: new PreviewService(tdb, {
        storageDir: path.join(storageDir, `cliente-${accountId}-${storageKey}`),
        screenshotter: screenshotsEnabled() ? createPlaywrightScreenshotter() : null,
      }),
    };
  },
});
const port = Number(process.env.PORT ?? 3333);
const server = app.listen(port, () => {
  console.log(`Club'n API em http://localhost:${port} (capturas visuais: ${screenshotsEnabled() ? "ativadas" : "desativadas"})`);
});

function shutdown() {
  server.close(() => {
    whatsapp.shutdown();
    for (const t of tenantDbs) t.close();
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
