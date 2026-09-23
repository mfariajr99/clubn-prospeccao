// Optional visual capture using a headless Chromium (Playwright).
// Enabled with PREVIEW_SCREENSHOTS=on. Each capture runs in a brand-new,
// cookie-less browser context; every request made by the page is re-validated
// against the SSRF guard, downloads and service workers are blocked.

import fs from "node:fs";
import path from "node:path";
import { assertUrlAllowed, resolvePublicAddress, systemResolver, type Resolver } from "./ssrf.js";

export type Screenshotter = (url: string, outputFile: string) => Promise<void>;

interface MinimalBrowser {
  newContext(options: Record<string, unknown>): Promise<{
    route(pattern: string, handler: (route: { request(): { url(): string }; abort(): Promise<void>; continue(): Promise<void> }) => Promise<void>): Promise<void>;
    newPage(): Promise<{ goto(url: string, o: Record<string, unknown>): Promise<unknown>; waitForTimeout(ms: number): Promise<void>; screenshot(o: Record<string, unknown>): Promise<Buffer> }>;
    close(): Promise<void>;
  }>;
  close(): Promise<void>;
}

let browserPromise: Promise<MinimalBrowser> | null = null;

async function getBrowser(): Promise<MinimalBrowser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const mod = (await import("playwright-core")) as unknown as { chromium: { launch(o: Record<string, unknown>): Promise<MinimalBrowser> } };
      return mod.chromium.launch({
        headless: true,
        executablePath: process.env.PREVIEW_CHROMIUM_PATH || undefined,
        args: ["--disable-dev-shm-usage", "--disable-extensions", "--disable-background-networking", "--no-first-run", "--mute-audio"],
      });
    })().catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

export function screenshotsEnabled(): boolean {
  return ["on", "1", "true"].includes(String(process.env.PREVIEW_SCREENSHOTS ?? "").toLowerCase());
}

export function createPlaywrightScreenshotter(resolver: Resolver = systemResolver, timeoutMs = 15000): Screenshotter {
  return async (url, outputFile) => {
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      acceptDownloads: false,
      serviceWorkers: "block",
      javaScriptEnabled: true,
      ignoreHTTPSErrors: false,
      userAgent: "Mozilla/5.0 ClubnPreviewBot/1.0",
      locale: "pt-BR",
    });
    const allowedHosts = new Map<string, boolean>();
    try {
      await context.route("**/*", async (route) => {
        const requestUrl = route.request().url();
        if (requestUrl.startsWith("data:") || requestUrl.startsWith("blob:")) return route.continue();
        try {
          const parsed = assertUrlAllowed(requestUrl);
          let ok = allowedHosts.get(parsed.hostname);
          if (ok === undefined) {
            ok = await resolvePublicAddress(parsed.hostname, resolver).then(
              () => true,
              () => false,
            );
            allowedHosts.set(parsed.hostname, ok);
          }
          return ok ? route.continue() : route.abort();
        } catch {
          return route.abort();
        }
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(1200);
      const image = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false, timeout: timeoutMs });
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      fs.writeFileSync(outputFile, image);
    } finally {
      await context.close().catch(() => undefined);
    }
  };
}
