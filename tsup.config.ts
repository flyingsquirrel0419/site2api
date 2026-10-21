import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// The version comes from package.json, so a release only has to bump it there.
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const define = { __SITE2API_VERSION__: JSON.stringify(version) };

export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: "esm",
    target: "node22",
    define,
    // Optional: only `record` needs it, and it is loaded lazily.
    external: ["playwright"],
  },
  {
    // The generated MCP server: one self-contained file, so users never need `npm install`.
    entry: { "runtime/server": "src/runtime/server.ts" },
    format: "esm",
    target: "node22",
    define,
    platform: "node",
    noExternal: [/.*/],
    outExtension: () => ({ js: ".mjs" }),
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  },
]);
