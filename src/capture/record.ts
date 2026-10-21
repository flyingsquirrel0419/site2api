// `site2api record`: opens a browser on a dedicated profile and records a HAR while the site is
// used, either by a person in a visible window or by a capture script (headless, for servers, CI
// and agents). Either way it is a plain browser: no stealth, no bot-detection evasion, and a
// script is held to a request budget and a human pace.
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserContext, Page } from "playwright";
import { siteOf } from "../normalize/filter.js";

export const DEFAULT_PROFILE_DIR = process.env.SITE2API_PROFILE_DIR ?? join(homedir(), ".site2api", "profile");

export interface RecordOptions {
  url: string;
  harPath: string;
  profileDir?: string;
  headless?: boolean;
  /** Browser channel. Defaults to the installed Chrome, falling back to Playwright's Chromium. */
  channel?: string | null;
  /** Called once the page is open; tests use it to drive the site. */
  onPage?: (page: Page) => Promise<void>;
  /** Resolves when the user says they are done (e.g. Enter in the terminal). */
  waitForUser?: () => Promise<void>;
  /** Drives the site instead of a person; recording ends when it returns. */
  script?: CaptureScript;
  /** Most page loads + API calls a script may cause before it is stopped (default 60). */
  maxRequests?: number;
  /** Minimum pause between a script's steps, in ms (default 1000). */
  paceMs?: number;
}

export interface CaptureScriptContext {
  /** The URL the recording started at. */
  url: string;
  /** Wait like a person would between steps. Call it between actions. */
  pause: (ms?: number) => Promise<void>;
}

/** Default export of a capture script file: `export default async (page, { url, pause }) => { … }` */
export type CaptureScript = (page: Page, ctx: CaptureScriptContext) => Promise<void>;

export async function loadCaptureScript(path: string): Promise<CaptureScript> {
  const mod = (await import(pathToFileURL(resolve(path)).href)) as { default?: unknown };
  if (typeof mod.default !== "function") {
    throw new Error(`${path} must default-export an async function (page, { url, pause }) => { … }`);
  }
  return mod.default as CaptureScript;
}

export interface RecordResult {
  /** Cookie header for the site at the end of the recording. Kept in memory only, never written. */
  cookieHeader?: string;
  /** How the recording ended. */
  endedBy: "user" | "browser-closed" | "script" | "request-limit";
  /** Page loads + API calls seen during the recording. */
  requests: number;
  /** The capture script's error, if it failed. What it recorded up to then is still saved. */
  scriptError?: string;
}

export class PlaywrightMissingError extends Error {
  constructor() {
    super("Recording needs Playwright: run `npm install playwright` (and `npx playwright install chromium` if Chrome is not installed).");
  }
}

async function loadPlaywright(): Promise<typeof import("playwright")> {
  try {
    return await import("playwright");
  } catch {
    throw new PlaywrightMissingError();
  }
}

async function launch(
  profileDir: string,
  options: { headless: boolean; channel?: string | null; harPath?: string },
): Promise<BrowserContext> {
  const { chromium } = await loadPlaywright();
  const base = {
    headless: options.headless,
    viewport: null,
    ...(options.harPath && { recordHar: { path: options.harPath, content: "embed" as const } }),
  };
  if (options.channel === null) return chromium.launchPersistentContext(profileDir, base);
  try {
    return await chromium.launchPersistentContext(profileDir, { ...base, channel: options.channel ?? "chrome" });
  } catch (err) {
    if (options.channel) throw err;
    // No installed Chrome: use Playwright's own Chromium.
    try {
      return await chromium.launchPersistentContext(profileDir, base);
    } catch {
      throw new Error("Could not start Chrome or Chromium. Install Chrome, or run `npx playwright install chromium`.");
    }
  }
}

export async function record(options: RecordOptions): Promise<RecordResult> {
  const context = await launch(options.profileDir ?? DEFAULT_PROFILE_DIR, {
    headless: options.headless ?? false,
    channel: options.channel,
    harPath: options.harPath,
  });

  let browserClosed = false;
  const closed = new Promise<"browser-closed">((resolve) =>
    context.once("close", () => {
      browserClosed = true;
      resolve("browser-closed");
    }),
  );
  // Closing the last tab ends the recording too (on macOS the browser itself keeps running).
  const lastTabClosed = new Promise<"browser-closed">((resolve) => {
    const watch = (page: Page) => page.once("close", () => context.pages().length === 0 && resolve("browser-closed"));
    context.pages().forEach(watch);
    context.on("page", watch);
  });

  // Count what reaches the site: navigations and API calls, not images or scripts.
  const maxRequests = options.maxRequests ?? 60;
  let requests = 0;
  let overBudget: () => void = () => {};
  const limitReached = new Promise<"request-limit">((resolve) => (overBudget = () => resolve("request-limit")));
  context.on("request", (req) => {
    if (!["document", "fetch", "xhr"].includes(req.resourceType())) return;
    if (++requests > maxRequests && options.script) overBudget();
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(options.url);
  await options.onPage?.(page);

  let finished: Promise<"user" | "script">;
  let scriptError: string | undefined;
  if (options.script) {
    const paceMs = options.paceMs ?? 1000;
    const pause = (ms = paceMs) => new Promise<void>((r) => setTimeout(r, Math.max(ms, paceMs)));
    finished = options.script(page, { url: options.url, pause }).then(
      () => "script" as const,
      (err: unknown) => {
        scriptError = err instanceof Error ? err.message : String(err);
        return "script" as const;
      },
    );
  } else {
    finished = (options.waitForUser ?? (() => new Promise<void>(() => {})))().then(() => "user" as const);
  }
  const endedBy = await Promise.race([finished, closed, lastTabClosed, limitReached]);

  let cookieHeader: string | undefined;
  if (!browserClosed) {
    cookieHeader = cookieHeaderFor(await context.cookies(), options.url);
    await context.close(); // flushes the HAR; a script still running fails from here on
  }
  if (endedBy !== "script") scriptError = undefined; // errors after we closed the browser are expected
  return { cookieHeader, endedBy, requests, ...(scriptError && { scriptError }) };
}

/** Persistent cookies stored in the dedicated profile (session cookies do not survive a restart). */
export async function cookiesFromProfile(url: string, profileDir = DEFAULT_PROFILE_DIR, channel?: string | null): Promise<string | undefined> {
  const context = await launch(profileDir, { headless: true, channel });
  try {
    return cookieHeaderFor(await context.cookies(), url);
  } finally {
    await context.close();
  }
}

/** One Cookie header with every cookie of the site (any subdomain), like copying it from DevTools. */
export function cookieHeaderFor(cookies: { name: string; value: string; domain: string }[], url: string): string | undefined {
  const site = siteOf(new URL(url).hostname);
  const matching = cookies.filter((c) => {
    const domain = c.domain.replace(/^\./, "");
    return domain === site || domain.endsWith(`.${site}`);
  });
  return matching.length > 0 ? matching.map((c) => `${c.name}=${c.value}`).join("; ") : undefined;
}
