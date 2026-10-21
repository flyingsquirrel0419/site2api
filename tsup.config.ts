import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: "esm",
    target: "node20",
  },
  {
    // The generated MCP server: one self-contained file, so users never need `npm install`.
    entry: { "runtime/server": "src/runtime/server.ts" },
    format: "esm",
    target: "node20",
    platform: "node",
    noExternal: [/.*/],
    outExtension: () => ({ js: ".mjs" }),
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  },
]);
