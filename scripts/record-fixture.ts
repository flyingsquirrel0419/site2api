// Records tests/fixtures/demo-shop.har by driving the demo shop in a real browser.
// Requests are issued from the page (like an SPA would), so cookies and headers are genuine.
import { chromium } from "playwright";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createApp } from "../demo/shop/server.js";

const harPath = fileURLToPath(new URL("../tests/fixtures/demo-shop.har", import.meta.url));

// Fixed port keeps the recorded host stable, so the golden snapshot only changes when behavior does.
const server = createApp().listen(4317);
await new Promise((resolve) => server.once("listening", resolve));
const { port } = server.address() as AddressInfo;
const base = `http://localhost:${port}`;

const browser = await chromium.launch();
const context = await browser.newContext({ recordHar: { path: harPath, content: "embed" } });
const page = await context.newPage();
await page.goto(base);

// Passed as source text: tsx would otherwise inject helpers (__name) that do not exist in the page.
const scenario = String.raw`(async () => {
  const json = (r) => r.json();
  const post = (url, body, headers = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }).then(json);

  await fetch("/api/products").then(json);
  await fetch("/api/products?q=usb&page=1").then(json);
  for (const id of [1, 2, 3]) await fetch("/api/products/" + id).then(json);

  await post("/api/login", { email: "demo@example.com", password: "demo-password" });
  const { csrfToken } = await fetch("/api/session").then(json);

  const { orders } = await fetch("/api/orders").then(json);
  for (const o of orders) await fetch("/api/orders/" + o.id).then(json);

  await post("/api/cart", { productId: 2, quantity: 1 }, { "x-csrf-token": csrfToken });
  await post("/api/cart", { productId: 3 }, { "x-csrf-token": csrfToken });

  await post("/graphql", { operationName: "Viewer", query: "query Viewer { viewer { email orderCount } }" });
  for (const limit of [2, 3]) {
    await post("/graphql", {
      operationName: "Recommendations",
      query: "query Recommendations($limit: Int) { recommendations(limit: $limit) { id name } }",
      variables: { limit },
    });
  }
})()`;
await page.evaluate(scenario);

await context.close();
await browser.close();
server.close();
console.log(`wrote ${harPath}`);
