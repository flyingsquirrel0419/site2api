// The MCP end-to-end test runs the bundled runtime (dist/runtime/server.mjs), so build first.
import { execSync } from "node:child_process";

export default function setup() {
  execSync("pnpm build", { stdio: "ignore" });
}
