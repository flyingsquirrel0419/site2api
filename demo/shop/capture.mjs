// Capture script for the demo shop: uses each feature twice, like a person would.
//   site2api record http://localhost:4317 --script demo/shop/capture.mjs
// The shop has no UI, so the page calls its API the way the shop's frontend would.
export default async (page, { pause }) => {
  const call = (path, init) =>
    page.evaluate(
      ([p, i]) => fetch(p, i && { ...i, headers: { "content-type": "application/json", ...i.headers } }).then((r) => r.json()),
      [path, init],
    );

  await call("/api/products?q=usb");
  await call("/api/products/1");
  await call("/api/products/2");
  await pause();

  await call("/api/login", { method: "POST", body: JSON.stringify({ email: "demo@example.com", password: "demo-password" }) });
  const { orders } = await call("/api/orders");
  await pause();

  for (const order of orders) await call(`/api/orders/${order.id}`);
  await pause();

  const gql = (operationName, query, variables) =>
    call("/graphql", { method: "POST", body: JSON.stringify({ operationName, query, variables }) });
  await gql("Viewer", "query Viewer { viewer { email orderCount } }");
  await gql("Recommendations", "query Recommendations($limit: Int) { recommendations(limit: $limit) { id name } }", { limit: 2 });
  await gql("Recommendations", "query Recommendations($limit: Int) { recommendations(limit: $limit) { id name } }", { limit: 3 });
};
