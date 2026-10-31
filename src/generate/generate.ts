// `site2api generate <dir>`: openapi.yaml (+ annotations.json) → <dir>/mcp/, a runnable MCP server.
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Annotations } from "../infer/annotations.js";
import { assertNoFingerprintedSecrets } from "../redact.js";
import type { VerifyReport } from "../verify/verify.js";
import { loadAnnotations, loadCatalog, loadFingerprint, readOptional, SECRETS_FILE, VERIFY_FILE } from "../workspace.js";
import { buildTools } from "./tools.js";
import type { ToolDef, ToolsFile } from "./types.js";

export { AnnotationsError, SECRETS_FILE, VERIFY_FILE } from "../workspace.js";

export interface GenerateOptions {
  allowWrites?: boolean;
  onlyVerified?: boolean;
  /** Server name (default: the site name from annotations, else the recorded host). */
  name?: string;
  /** Path of the bundled runtime (dist/runtime/server.mjs). */
  runtimePath: string;
  /** Write the server even though `.site2api/secrets.json` is missing. The leak check is skipped. */
  allowMissingFingerprint?: boolean;
}

export interface GenerateResult {
  outDir: string;
  tools: ToolsFile;
  annotated: boolean;
  warnings: string[];
}

export async function generate(dir: string, options: GenerateOptions): Promise<GenerateResult> {
  const catalog = await loadCatalog(dir);
  const warnings: string[] = [];

  const loaded = await loadAnnotations(dir, catalog);
  const annotations: Annotations = loaded ?? { version: 1, operations: {} };
  if (!loaded) {
    warnings.push("No annotations.json: tools use heuristic names. Run `site2api infer-prompt` and let your agent annotate.");
  }

  let verified: Map<string, NonNullable<ToolDef["verified"]>> | undefined;
  const rawVerify = await readOptional(join(dir, VERIFY_FILE));
  if (rawVerify !== undefined) {
    const report = JSON.parse(rawVerify) as VerifyReport;
    verified = new Map(report.results.map((r) => [r.operationId, r.status]));
  } else if (options.onlyVerified) {
    throw new Error(`--only-verified needs ${VERIFY_FILE}; run \`site2api verify ${dir}\` first.`);
  } else {
    warnings.push("Not verified yet: run `site2api verify` to check every read tool against the live site.");
  }

  const tools = buildTools(catalog, annotations, {
    allowWrites: options.allowWrites,
    verified,
    onlyVerified: options.onlyVerified,
    name: options.name,
  });
  const toolsJson = JSON.stringify(tools, null, 2) + "\n";
  const serverPath = resolve(dir, "mcp", "server.mjs");
  const readme = renderReadme(tools, serverPath);
  // Standard mcpServers config. Credentials are ${VAR} references, expanded from the environment
  // by clients that support it (Claude Code, Codex); never values.
  const mcpJson =
    JSON.stringify({ mcpServers: { [slug(tools.site.name)]: { command: "node", args: [serverPath], ...envRefs(tools) } } }, null, 2) + "\n";

  const fp = await loadFingerprint(dir);
  if (fp) {
    assertNoFingerprintedSecrets(toolsJson, fp, "tools.json");
    assertNoFingerprintedSecrets(readme, fp, "README.md");
    assertNoFingerprintedSecrets(mcpJson, fp, "mcp.json");
  } else if (options.allowMissingFingerprint) {
    warnings.push(`No ${SECRETS_FILE} found, so the output could not be checked for leaked credentials.`);
  } else {
    throw new Error(
      `Refusing to generate: ${SECRETS_FILE} is missing, so the output cannot be checked for leaked credentials. Run from-har or record in this directory first, or pass --unsafe-no-fingerprint.`,
    );
  }
  if (tools.tools.length === 0) warnings.push("No tools were generated. See `skipped` in tools.json.");

  const outDir = join(dir, "mcp");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "tools.json"), toolsJson);
  await writeFile(join(outDir, "README.md"), readme);
  await writeFile(join(outDir, "mcp.json"), mcpJson);
  await writeFile(
    join(outDir, "package.json"),
    JSON.stringify(
      { name: `${slug(tools.site.name)}-mcp`, private: true, type: "module", bin: "server.mjs", scripts: { start: "node server.mjs" } },
      null,
      2,
    ) + "\n",
  );
  await copyFile(options.runtimePath, join(outDir, "server.mjs"));

  return { outDir, tools, annotated: loaded !== undefined, warnings };
}

function renderReadme(tools: ToolsFile, serverPath: string): string {
  const name = slug(tools.site.name);
  const needsCookie = tools.tools.some((t) => t.auth.cookie);
  const needsBearer = tools.tools.some((t) => t.auth.bearer);
  const keyEnvs = [...new Map(tools.tools.flatMap((t) => t.auth.apiKeys).map((k) => [k.env, k])).values()];
  const envLines = [
    ...(needsCookie ? [`SITE2API_COOKIE: "<Cookie header copied from your browser>"`] : []),
    ...(needsBearer ? [`SITE2API_BEARER: "<token>"`] : []),
    ...keyEnvs.map((k) => `${k.env}: "<value of the ${k.name} ${k.in === "query" ? "query parameter" : "header"}>"`),
  ];
  const envJson = Object.fromEntries(envLines.map((l) => [l.split(":")[0]!, l.slice(l.indexOf(":") + 2).replace(/"/g, "")]));

  const lines = [
    `# ${tools.site.name} MCP server`,
    "",
    tools.site.description ?? "Generated by site2api from recorded traffic.",
    "",
    "## Tools",
    "",
    "| Tool | Kind | Verified | Description |",
    "|---|---|---|---|",
    ...tools.tools.map(
      (t) =>
        `| \`${t.name}\` | ${t.kind} | ${VERIFIED_MARK[t.verified ?? "none"]} | ${t.description.split("\n")[0]!.replace(/\|/g, "\\|")} |`,
    ),
    "",
  ];
  if (tools.skipped.length > 0) {
    lines.push("Not exposed:", "", ...tools.skipped.map((s) => `- \`${s.operationId}\`: ${s.reason}`), "");
  }
  lines.push(
    "## Register",
    "",
    "Claude Code:",
    "",
    "```bash",
    `claude mcp add ${name} ${envLines.map((l) => `--env ${l.split(":")[0]}=...`).join(" ")} -- node ${shellQuote(serverPath)}`.replace(/\s+--/, " --"),
    "```",
    "",
    "Cursor (`.cursor/mcp.json`) and other clients that use the same format:",
    "",
    "```json",
    JSON.stringify({ mcpServers: { [name]: { command: "node", args: [serverPath], ...(envLines.length > 0 && { env: envJson }) } } }, null, 2),
    "```",
    "",
  );
  if (needsCookie || needsBearer || keyEnvs.length > 0) {
    lines.push(
      "## Credentials",
      "",
      "The server reads credentials only from environment variables and never stores them.",
      needsCookie
        ? "To get the cookie: open the site logged in, open DevTools → Network, select any request to the site, and copy the value of the `Cookie` request header. Do not paste it into a chat."
        : "",
      keyEnvs.length > 0
        ? `API keys: in DevTools → Network, open a request to the site's API and copy the value of ${keyEnvs.map((k) => `\`${k.name}\``).join(", ")} (from the ${keyEnvs.some((k) => k.in === "query") ? "query string" : "request headers"}).`
        : "",
      "",
    );
  }
  lines.push(
    "## Safety",
    "",
    "- Tools that change data require `confirm: true` on every call.",
    "- Requests are limited to 1 per second by default (`SITE2API_RATE`).",
    "- Use this only with your own account and within the site's terms of service.",
    "",
  );
  return lines.join("\n");
}

function envRefs(tools: ToolsFile): { env?: Record<string, string> } {
  const names = [
    ...(tools.tools.some((t) => t.auth.cookie) ? ["SITE2API_COOKIE"] : []),
    ...(tools.tools.some((t) => t.auth.bearer) ? ["SITE2API_BEARER"] : []),
    ...new Set(tools.tools.flatMap((t) => t.auth.apiKeys.map((k) => k.env))),
  ];
  return names.length > 0 ? { env: Object.fromEntries(names.map((n) => [n, `\${${n}}`])) } : {};
}

const VERIFIED_MARK: Record<string, string> = {
  pass: "✅",
  warn: "✅ (fields missing)",
  fail: "⚠️ fail",
  error: "⚠️ error",
  skipped: "—",
  none: "—",
};

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
}

/** For a command the user pastes: a path with spaces or `$(…)` must stay one literal argument. */
function shellQuote(text: string): string {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}
