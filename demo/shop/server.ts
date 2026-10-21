// A tiny local shop used as a test fixture source and demo target.
// It has the shapes real sites have: cookie session, CSRF header, REST + GraphQL.
import express from "express";
import { randomBytes, randomUUID } from "node:crypto";

const DEMO_USER = { email: "demo@example.com", password: "demo-password" };

const products = [
  { id: 1, name: "Mechanical Keyboard", price: 129.0, tags: ["input"], discount: null },
  { id: 2, name: "USB-C Hub", price: 49.5, tags: ["adapter", "usb"], discount: 0.1 },
  { id: 3, name: "4K Monitor", price: 399.0, tags: [], discount: null },
];

const orders = [
  {
    id: "3f6c2a9e-7b1d-4c8e-9a2f-1d5e8b7c6a40",
    createdAt: "2026-09-02T10:00:00Z",
    status: "delivered",
    items: [{ productId: 1, quantity: 1 }],
    shipping: { email: DEMO_USER.email, phone: "+82-10-1234-5678" },
  },
  {
    id: "b2e9d4c1-5a3f-4e7b-8c6d-9f0a1b2c3d4e",
    createdAt: "2026-10-11T08:30:00Z",
    status: "shipped",
    items: [{ productId: 2, quantity: 2 }, { productId: 3, quantity: 1 }],
    shipping: { email: DEMO_USER.email, phone: "+82-10-1234-5678", note: "Leave at door" },
  },
];

type Session = { csrf: string; cart: { productId: number; quantity: number }[] };
const sessions = new Map<string, Session>();

export function createApp() {
  const app = express();
  app.use(express.json());

  const session = (req: express.Request): Session | undefined => {
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    return sid ? sessions.get(sid) : undefined;
  };
  const requireAuth: express.RequestHandler = (req, res, next) => {
    if (!session(req)) return void res.status(401).json({ error: "unauthorized" });
    next();
  };
  const requireCsrf: express.RequestHandler = (req, res, next) => {
    if (req.get("x-csrf-token") !== session(req)?.csrf) {
      return void res.status(403).json({ error: "bad csrf token" });
    }
    next();
  };

  app.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html><html><head><title>Demo Shop</title>
<link rel="stylesheet" href="/static/style.css"></head>
<body><h1>Demo Shop</h1><script src="/static/app.js"></script></body></html>`);
  });
  app.get("/static/style.css", (_req, res) => void res.type("css").send("body{font-family:sans-serif}"));
  app.get("/static/app.js", (_req, res) => void res.type("js").send("console.log('demo shop')"));

  app.post("/api/login", (req, res) => {
    const { email, password } = req.body ?? {};
    if (email !== DEMO_USER.email || password !== DEMO_USER.password) {
      return void res.status(401).json({ error: "invalid credentials" });
    }
    const sid = randomBytes(24).toString("hex");
    sessions.set(sid, { csrf: randomBytes(16).toString("hex"), cart: [] });
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax" });
    res.json({ ok: true, user: { email } });
  });

  app.get("/api/session", requireAuth, (req, res) => {
    res.json({ csrfToken: session(req)!.csrf, user: { email: DEMO_USER.email } });
  });

  app.get("/api/products", (req, res) => {
    const q = String(req.query.q ?? "").toLowerCase();
    const page = Number(req.query.page ?? 1);
    const items = products.filter((p) => p.name.toLowerCase().includes(q));
    res.json({ items, page, total: items.length });
  });

  app.get("/api/products/:id", (req, res) => {
    const product = products.find((p) => p.id === Number(req.params.id));
    if (!product) return void res.status(404).json({ error: "not found" });
    res.json(product);
  });

  app.get("/api/orders", requireAuth, (_req, res) => {
    res.json({ orders: orders.map(({ id, createdAt, status }) => ({ id, createdAt, status })) });
  });

  app.get("/api/orders/:id", requireAuth, (req, res) => {
    const order = orders.find((o) => o.id === req.params.id);
    if (!order) return void res.status(404).json({ error: "not found" });
    res.json(order);
  });

  app.post("/api/cart", requireAuth, requireCsrf, (req, res) => {
    const cart = session(req)!.cart;
    cart.push({ productId: Number(req.body.productId), quantity: Number(req.body.quantity ?? 1) });
    res.status(201).json({ cartId: randomUUID(), items: cart });
  });

  // Minimal GraphQL-shaped endpoint: dispatches on operationName only.
  app.post("/graphql", requireAuth, (req, res) => {
    const { operationName, variables } = req.body ?? {};
    if (operationName === "Viewer") {
      return void res.json({ data: { viewer: { email: DEMO_USER.email, orderCount: orders.length } } });
    }
    if (operationName === "Recommendations") {
      const limit = Number(variables?.limit ?? 2);
      return void res.json({
        data: { recommendations: products.slice(0, limit).map(({ id, name }) => ({ id, name })) },
      });
    }
    res.status(400).json({ errors: [{ message: `unknown operation ${operationName}` }] });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4317);
  createApp().listen(port, () => console.log(`demo shop on http://localhost:${port}`));
}
