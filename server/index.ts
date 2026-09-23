import path from "node:path";
import { createApp } from "./app.js";
import { defaultDbFile, ensureDefaultUser, openDatabase, runMigrations } from "./db/connection.js";
import { PreviewService } from "./services/preview/previewService.js";
import { createPlaywrightScreenshotter, screenshotsEnabled } from "./services/preview/screenshot.js";

const db = openDatabase(defaultDbFile());
runMigrations(db);
ensureDefaultUser(db);

const storageDir = process.env.PREVIEW_STORAGE_DIR ?? path.resolve(process.cwd(), "data", "screenshots");
const previews = new PreviewService(db, {
  storageDir,
  screenshotter: screenshotsEnabled() ? createPlaywrightScreenshotter() : null,
});

const app = createApp({ db, previews, staticDir: path.resolve(process.cwd(), "dist") });
const port = Number(process.env.PORT ?? 3333);
const server = app.listen(port, () => {
  console.log(`Club'n API em http://localhost:${port} (capturas visuais: ${screenshotsEnabled() ? "ativadas" : "desativadas"})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
