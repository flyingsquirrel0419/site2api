// Drives a real (headless) browser through the demo shop with record(), the way a person would
// in the visible window, then checks the capture analyzes and verifies with the in-memory cookies.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../demo/shop/server.js";
import { cookieHeaderFor, loadCaptureScript, record } from "../src/capture/record.js";
import { analyzeHar } from "../src/pipeline.js";
import { readCatalog } from "../src/spec/catalog.js";
import { verify } from "../src/verify/verify.js";

let shop: Server;
let baseUrl: string;
beforeAll(async () => {
  shop = createApp().listen(0);
  await new Promise((r) => shop.once("listening", r));
  baseUrl = `http://localhost:${(shop.address() as AddressInfo).port}`;
});
afterAll(() => shop?.close());

// Same steps as scripts/record-fixture.ts, issued from the page like the shop's own frontend would.
const scenario = String.raw`(async () => {
  const json = (r) => r.json();
  const post = (url, body, headers = {}) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }).then(json);
  await fetch("/api/products?q=usb").then(json);
  for (const id of [1, 2]) await fetch("/api/products/" + id).then(json);
  await post("/api/login", { email: "demo@example.com", password: "demo-password" });
  const { orders } = await fetch("/api/orders").then(json);
  for (const o of orders) await fetch("/api/orders/" + o.id).then(json);
})()`;

describe("record", () => {
  it("records a HAR, returns the session cookie in memory, and the result verifies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "site2api-record-"));
    const harPath = join(dir, "capture.har");
    const result = await record({
      url: baseUrl,
      harPath,
      profileDir: join(dir, "profile"),
      headless: true,
      channel: null,
      onPage: async (page) => void (await page.evaluate(scenario)),
      waitForUser: async () => {},
    });

    expect(result.endedBy).toBe("user");
    expect(result.cookieHeader).toMatch(/^sid=[0-9a-f]+$/);

    const analysis = analyzeHar(await readFile(harPath, "utf8"));
    expect(analysis.operations.map((op) => `${op.method} ${op.template}`)).toEqual([
      "POST /api/login",
      "GET /api/orders",
      "GET /api/orders/{orderId}",
      "GET /api/products",
      "GET /api/products/{productId}",
    ]);

    const report = await verify(readCatalog(analysis.spec), { version: 1, operations: {} }, {
      credentials: { cookie: result.cookieHeader },
      rate: 0,
      recorded: analysis.operations,
    });
    expect(report.summary).toEqual({ pass: 4, fail: 0, skipped: 0, error: 0 });
  });

  it("ends when the last tab is closed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "site2api-record-"));
    const result = await record({
      url: baseUrl,
      harPath: join(dir, "capture.har"),
      profileDir: join(dir, "profile"),
      headless: true,
      channel: null,
      onPage: async (page) => void setTimeout(() => void page.close(), 50),
    });
    expect(result.endedBy).toBe("browser-closed");
    await expect(readFile(join(dir, "capture.har"), "utf8")).resolves.toContain('"entries"');
  });
});

describe("cookieHeaderFor", () => {
  it("keeps cookies of the site and its subdomains only", () => {
    const cookies = [
      { name: "sid", value: "a", domain: ".shop.com" },
      { name: "api", value: "b", domain: "api.shop.com" },
      { name: "_ga", value: "c", domain: ".google.com" },
      { name: "x", value: "d", domain: "notshop.com" },
    ];
    expect(cookieHeaderFor(cookies, "https://www.shop.com/app")).toBe("sid=a; api=b");
    expect(cookieHeaderFor([], "https://www.shop.com")).toBeUndefined();
  });
});

describe("record with a capture script", () => {
  const run = async (script: Parameters<typeof record>[0]["script"], extra: Partial<Parameters<typeof record>[0]> = {}) => {
    const dir = await mkdtemp(join(tmpdir(), "site2api-script-"));
    const harPath = join(dir, "capture.har");
    const result = await record({ url: baseUrl, harPath, profileDir: join(dir, "profile"), headless: true, channel: null, paceMs: 0, script, ...extra });
    return { result, har: await readFile(harPath, "utf8") };
  };

  it("ends when the script returns, and paces steps", async () => {
    const started = Date.now();
    const { result, har } = await run(
      async (page, { pause }) => {
        await page.evaluate(() => fetch("/api/products?q=hub").then((r) => r.json()));
        await pause(200);
        await page.evaluate(() => fetch("/api/products/2").then((r) => r.json()));
      },
    );
    expect(result).toMatchObject({ endedBy: "script", requests: 3 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(analyzeHar(har).operations.map((op) => op.template)).toEqual(["/api/products", "/api/products/{productId}"]);
  });

  it("stops a script that goes over its request budget", async () => {
    const { result } = await run(
      async (page) => {
        for (let i = 0; i < 50; i++) await page.evaluate(() => fetch("/api/products").then((r) => r.json()));
      },
      { maxRequests: 5 },
    );
    expect(result.endedBy).toBe("request-limit");
    expect(result.requests).toBeLessThan(15);
  });

  it("keeps what was recorded when the script fails", async () => {
    const { result, har } = await run(async (page) => {
      await page.evaluate(() => fetch("/api/products").then((r) => r.json()));
      throw new Error("selector not found");
    });
    expect(result).toMatchObject({ endedBy: "script", scriptError: "selector not found" });
    expect(har).toContain("/api/products");
  });

  it("loads a script file's default export", async () => {
    const dir = await mkdtemp(join(tmpdir(), "site2api-script-"));
    const file = join(dir, "capture.mjs");
    await writeFile(file, "export default async (page, { pause }) => { await page.evaluate(() => fetch('/api/products')); await pause(); };");
    const script = await loadCaptureScript(file);
    const { result } = await run(script);
    expect(result.endedBy).toBe("script");

    await writeFile(join(dir, "bad.mjs"), "export const nope = 1;");
    await expect(loadCaptureScript(join(dir, "bad.mjs"))).rejects.toThrow("must default-export an async function");
  });
});
