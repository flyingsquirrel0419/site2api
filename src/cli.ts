#!/usr/bin/env node
import { Command } from "commander";
import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cookieHeaderFor, cookiesFromProfile, DEFAULT_PROFILE_DIR, loadCaptureScript, record, type StoredCookie } from "./capture/record.js";
import { generate } from "./generate/generate.js";
import { annotationsJsonSchema } from "./infer/annotations.js";
import { renderContext } from "./infer/context.js";
import { inferAnnotations, providerFromEnv, type ProviderName } from "./infer/llm/infer.js";
import { LlmError } from "./infer/llm/provider.js";
import { analyzeHar } from "./pipeline.js";
import { assertNoFingerprintedSecrets } from "./redact.js";
import { verify, type VerifyReport } from "./verify/verify.js";
import {
  ANNOTATIONS_FILE,
  AnnotationsError,
  CAPTURE_FILE,
  findCapture,
  loadAnnotations,
  loadCatalog,
  loadFingerprint,
  readOptional,
  SECRETS_FILE,
  SOURCE_FILE,
  VERIFY_FILE,
} from "./workspace.js";

// Set by tsup from package.json.
declare const __SITE2API_VERSION__: string;

const program = new Command()
  .name("site2api")
  .description("Turn any website you use into a verified MCP server.")
  .version(__SITE2API_VERSION__);

program
  .command("from-har")
  .description("Analyze a HAR capture and write an OpenAPI 3.1 spec plus a report")
  .argument("<file>", "HAR file exported from browser devtools or Playwright")
  .option("-o, --out <dir>", "output directory", "out")
  .option("--site <site>", "first-party site (eTLD+1); inferred when omitted")
  .option("--include-origin <host...>", "extra hosts or sites to keep")
  .option("--examples", "include redacted example values in the spec", false)
  .action(async (file: string, opts: AnalyzeCliOptions) => {
    await analyzeToDir(file, opts);
  });

interface AnalyzeCliOptions {
  out: string;
  site?: string;
  includeOrigin?: string[];
  examples: boolean;
}

/** out/.site2api holds the recording and the secret fingerprints: readable by this user only. */
async function privateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

/** from-har's work, shared with record and run. */
async function analyzeToDir(file: string, opts: AnalyzeCliOptions) {
  const result = analyzeHar(await readFile(file, "utf8"), {
    source: basename(file),
    site: opts.site,
    includeOrigins: opts.includeOrigin,
    examples: opts.examples,
  });
  await privateDir(join(opts.out, dirname(SECRETS_FILE)));
  await writeFile(join(opts.out, "openapi.yaml"), result.yaml);
  await writeFile(join(opts.out, "report.md"), result.report);
  await writeFile(join(opts.out, SECRETS_FILE), JSON.stringify(result.secrets) + "\n", { mode: 0o600 });
  await writeFile(join(opts.out, SOURCE_FILE), JSON.stringify({ har: resolve(file) }) + "\n");

  const rest = result.operations.filter((op) => !op.graphql).length;
  const graphql = result.operations.length - rest;
  console.log(`site: ${result.filter.site}`);
  console.log(`kept ${result.filter.kept.length} requests → ${rest} REST + ${graphql} GraphQL operations`);
  console.log(`wrote ${join(opts.out, "openapi.yaml")} and ${join(opts.out, "report.md")}`);
  return result;
}

program
  .command("record")
  .description("Open a browser, record while you use the site, then analyze the traffic")
  .argument("<url>", "where to start, e.g. https://app.example.com")
  .option("-o, --out <dir>", "output directory", "out")
  .option("--include-origin <host...>", "extra hosts or sites to keep")
  .option("--profile-dir <dir>", "browser profile to use (keeps your login between runs)", DEFAULT_PROFILE_DIR)
  .option("--discard-har", "delete the recording after analysis", false)
  .option("--script <file>", "drive the site with a capture script (.mjs) instead of by hand; runs headless")
  .option("--headed", "show the browser window while a script runs", false)
  .option("--max-requests <n>", "stop a script after this many page loads + API calls", "60")
  .action(async (url: string, opts: RecordCliOptions) => {
    await recordToDir(url, opts);
  });

interface RecordCliOptions {
  out: string;
  includeOrigin?: string[];
  profileDir: string;
  discardHar: boolean;
  script?: string;
  headed?: boolean;
  maxRequests?: string;
}

/** Returns the profile's cookies at the end of the recording, in memory only. */
async function recordToDir(url: string, opts: RecordCliOptions): Promise<StoredCookie[]> {
  const harPath = join(opts.out, CAPTURE_FILE);
  const maxRequests = Number(opts.maxRequests ?? 60);
  if (!Number.isInteger(maxRequests) || maxRequests < 1) throw new Error(`--max-requests must be a whole number of at least 1, not "${opts.maxRequests}"`);
  await privateDir(dirname(harPath));
  const script = opts.script ? await loadCaptureScript(opts.script) : undefined;
  if (script) {
    console.log(`Running ${opts.script} against ${url} (at most ${maxRequests} requests).`);
  } else {
    console.log(`Opening ${url} in a separate browser profile (${opts.profileDir}).`);
    console.log("Log in if needed, then use each feature you want as a tool, twice or more.");
    console.log("When you are done, press Enter here (or close the tab).");
  }

  const { cookies, endedBy, requests, scriptError } = await record({
    url,
    harPath,
    profileDir: opts.profileDir,
    waitForUser: pressEnter,
    script,
    headless: script ? !opts.headed : false,
    maxRequests,
  });
  try {
    await access(harPath);
  } catch {
    throw new Error("The browser quit before the recording was saved. Next time, press Enter here to finish.");
  }
  const how = {
    user: "Recording saved.",
    "browser-closed": "Tab closed; recording saved.",
    script: "Script finished; recording saved.",
    "request-limit": `Stopped the script at the ${maxRequests}-request limit; recording saved.`,
  }[endedBy];
  console.log(`${how} (${requests} page loads + API calls)`);
  if (scriptError) console.warn(`warning: the capture script failed: ${scriptError}. Analyzing what was recorded so far.`);

  try {
    await analyzeToDir(harPath, { out: opts.out, includeOrigin: opts.includeOrigin, examples: false });
  } finally {
    // Also when analysis fails: --discard-har means the session must not stay on disk.
    if (opts.discardHar) {
      await rm(harPath, { force: true });
      await rm(join(opts.out, SOURCE_FILE), { force: true });
      console.log("Deleted the recording (--discard-har).");
    }
  }
  if (!opts.discardHar) console.log(`recording kept at ${harPath} (it holds your session: don't share or commit it)`);
  return cookies;
}

function pressEnter(): Promise<void> {
  if (!process.stdin.isTTY) return new Promise(() => {});
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    rl.once("line", () => {
      rl.close();
      resolve();
    });
  });
}

program
  .command("infer-prompt")
  .description("Write infer/context.md and infer/annotations.schema.json for your agent to annotate")
  .argument("[dir]", "output directory of from-har", "out")
  .action(async (dir: string) => {
    const catalog = await loadCatalog(dir);
    await mkdir(join(dir, "infer"), { recursive: true });
    await writeFile(join(dir, "infer", "context.md"), renderContext(catalog));
    await writeFile(join(dir, "infer", "annotations.schema.json"), JSON.stringify(annotationsJsonSchema(), null, 2) + "\n");
    console.log(`wrote ${join(dir, "infer", "context.md")} (${catalog.operations.length} operations)`);
    console.log(`next: read it, write ${join(dir, "annotations.json")}, then run: site2api generate ${dir}`);
  });

program
  .command("infer")
  .description("Annotate operations with an LLM API instead of a coding agent (Claude or any OpenAI-compatible API)")
  .argument("[dir]", "output directory of from-har", "out")
  .option("--provider <name>", "anthropic or openai (OpenAI-compatible); inferred from env when omitted")
  .option("--model <id>", "model id (default: claude-opus-5-5 for anthropic; SITE2API_LLM_MODEL for openai)")
  .option("--force", "overwrite an existing annotations.json", false)
  .action(async (dir: string, opts: InferCliOptions) => {
    await inferDir(dir, opts);
  });

interface InferCliOptions {
  provider?: string;
  model?: string;
  force: boolean;
}

async function inferDir(dir: string, opts: InferCliOptions) {
  if (opts.provider && opts.provider !== "anthropic" && opts.provider !== "openai") {
    throw new Error(`--provider must be anthropic or openai, got "${opts.provider}"`);
  }
  if (!opts.force && (await readOptional(join(dir, ANNOTATIONS_FILE))) !== undefined) {
    throw new Error(`${join(dir, ANNOTATIONS_FILE)} already exists; pass --force to replace it.`);
  }
  const catalog = await loadCatalog(dir);
  const context = renderContext(catalog);
  const fp = await loadFingerprint(dir);
  if (fp) assertNoFingerprintedSecrets(context, fp, "the LLM request");

  const provider = providerFromEnv(opts.provider as ProviderName | undefined, opts.model);
  console.log(`annotating ${catalog.operations.length} operations with ${provider.label}…`);
  const { annotations, attempts } = await inferAnnotations(catalog, provider, context);
  const text = JSON.stringify(annotations, null, 2) + "\n";
  if (fp) assertNoFingerprintedSecrets(text, fp, ANNOTATIONS_FILE);
  await writeFile(join(dir, ANNOTATIONS_FILE), text);

  for (const [id, a] of Object.entries(annotations.operations)) {
    const label = a.include === false ? "excluded" : a.kind;
    console.log(`  ${(a.tool ?? id).padEnd(28)} ${label}`);
  }
  console.log(`wrote ${join(dir, ANNOTATIONS_FILE)}${attempts > 1 ? ` after ${attempts} attempts` : ""}; review it, then: site2api generate ${dir}`);
}

program
  .command("generate")
  .description("Generate a runnable MCP server in <dir>/mcp from openapi.yaml and annotations.json")
  .argument("[dir]", "output directory of from-har", "out")
  .option("--allow-writes", "include tools that change data (they still require confirm: true)", false)
  .option("--only-verified", "keep only read tools that passed `site2api verify` (warnings count as passing)", false)
  .option("--name <name>", "server name (default: from annotations, else the recorded host)")
  .action(async (dir: string, opts: GenerateCliOptions) => {
    await generateDir(dir, opts);
  });

interface GenerateCliOptions {
  allowWrites: boolean;
  onlyVerified: boolean;
  name?: string;
  /** Set by `run`, which already said that annotation was skipped. */
  quietAnnotations?: boolean;
}

async function generateDir(dir: string, opts: GenerateCliOptions) {
  const runtimePath = fileURLToPath(new URL("./runtime/server.mjs", import.meta.url));
  try {
    const result = await generate(dir, { allowWrites: opts.allowWrites, onlyVerified: opts.onlyVerified, name: opts.name, runtimePath });
    for (const w of result.warnings) {
      if (opts.quietAnnotations && w.startsWith("No annotations.json")) continue;
      console.warn(`warning: ${w}`);
    }
    console.log(`${result.tools.tools.length} tools → ${result.outDir}`);
    for (const t of result.tools.tools) console.log(`  ${t.kind === "write" ? "✎" : "·"} ${t.name}`);
    if (result.tools.skipped.length > 0) console.log(`  (${result.tools.skipped.length} left out; see tools.json)`);
    console.log(`register it: ${join(result.outDir, "mcp.json")} (setup in ${join(result.outDir, "README.md")})`);
  } catch (err) {
    if (err instanceof AnnotationsError) {
      console.error(err.message);
      console.error("Fix annotations.json and run generate again.");
      process.exit(2);
    }
    throw err;
  }
}

program
  .command("verify")
  .description("Call every read-only operation on the live site and check responses against the spec")
  .argument("[dir]", "output directory of from-har", "out")
  .option("--base-url <url>", "call this origin instead of the recorded one")
  .option("--input <op.name=value...>", "value for a required input, e.g. get_product.productId=2")
  .option("--har <file>", "capture to replay input values from (default: the one from-har used)")
  .option("--rate <n>", "max requests per second", "1")
  .option("--profile", "use the persistent cookies of the record browser profile", false)
  .option("--profile-dir <dir>", "browser profile for --profile", DEFAULT_PROFILE_DIR)
  .action(async (dir: string, opts: VerifyCliOptions) => {
    await verifyDir(dir, opts);
  });

interface VerifyCliOptions {
  baseUrl?: string;
  input?: string[];
  har?: string;
  rate: string;
  profile?: boolean;
  profileDir?: string;
  /** Set by `run`: cookies captured at the end of the recording, in memory. */
  cookie?: string;
}

async function verifyDir(dir: string, opts: VerifyCliOptions): Promise<VerifyReport> {
  const catalog = await loadCatalog(dir);
  const annotations = (await loadAnnotations(dir, catalog)) ?? { version: 1 as const, operations: {} };
  const harPath = opts.har ?? (await findCapture(dir));
  let recorded;
  if (harPath) {
    try {
      recorded = analyzeHar(await readFile(harPath, "utf8")).operations;
    } catch {
      console.warn(`warning: could not read ${harPath}; recorded input values will not be replayed`);
    }
  }
  let cookie = opts.cookie ?? process.env.SITE2API_COOKIE;
  if (!cookie && opts.profile) {
    // Cookies for the host the requests go to, as a browser would send them.
    cookie = await cookiesFromProfile(opts.baseUrl ?? catalog.baseUrl, opts.profileDir);
    const needsCookie = catalog.operations.some((op) => op.auth.cookies.length > 0);
    if (!cookie && needsCookie) console.warn("warning: the profile has no persistent cookies for this site (session cookies end with the browser)");
  }
  const report = await verify(catalog, annotations, {
    credentials: { cookie, bearer: process.env.SITE2API_BEARER },
    baseUrl: opts.baseUrl,
    rate: Number(opts.rate),
    inputs: parseInputs(opts.input ?? []),
    recorded,
  });
  const text = JSON.stringify(report, null, 2) + "\n";
  const fp = await loadFingerprint(dir);
  if (fp) assertNoFingerprintedSecrets(text, fp, VERIFY_FILE);
  await writeFile(join(dir, VERIFY_FILE), text);
  printVerify(report);
  console.log(`wrote ${join(dir, VERIFY_FILE)}`);
  return report;
}

function parseInputs(pairs: string[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const pair of pairs) {
    const m = /^([^.=]+)\.([^=]+)=(.*)$/s.exec(pair);
    if (!m) throw new Error(`--input must look like operation.input=value, got "${pair}"`);
    (out[m[1]!] ??= {})[m[2]!] = m[3]!;
  }
  return out;
}

function printVerify(report: VerifyReport) {
  const mark = { pass: "✅", warn: "🟡", fail: "❌", skipped: "⏭ ", error: "⚠️" } as const;
  for (const r of report.results) {
    const detail =
      r.status === "pass"
        ? `HTTP ${r.httpStatus}`
        : r.status === "warn"
          ? `HTTP ${r.httpStatus}, but missing: ${r.warnings!.map((w) => w.replace(/: missing/, "")).join("; ")}`
          : (r.reason ?? r.errors?.join("; ") ?? "");
    console.log(`${mark[r.status]} ${r.tool.padEnd(28)} ${detail}`);
  }
  const s = report.summary;
  const counts = [
    [s.pass, "passed"],
    [s.warn, "with missing fields"],
    [s.fail, "failed"],
    [s.error, "errors"],
    [s.skipped, "skipped"],
  ].filter(([n]) => (n as number) > 0);
  console.log(`\n${counts.map(([n, label]) => `${n} ${label}`).join(", ") || "nothing to verify"}`);
  if (s.warn > 0) console.log("Missing fields are usually optional ones every recorded sample happened to include; they count as passing.");
}

program
  .command("run")
  .description("Record → analyze → annotate (if an LLM is configured) → verify → generate, in one go")
  .argument("<url>", "where to start, e.g. https://app.example.com")
  .option("-o, --out <dir>", "output directory", "out")
  .option("--include-origin <host...>", "extra hosts or sites to keep")
  .option("--profile-dir <dir>", "browser profile to use (keeps your login between runs)", DEFAULT_PROFILE_DIR)
  .option("--provider <name>", "LLM for annotations: anthropic or openai (default: from env; skipped if none)")
  .option("--model <id>", "LLM model id")
  .option("--allow-writes", "include tools that change data (they still require confirm: true)", false)
  .option("--discard-har", "delete the recording after analysis", false)
  .option("--script <file>", "drive the site with a capture script (.mjs) instead of by hand; runs headless")
  .option("--headed", "show the browser window while a script runs", false)
  .option("--max-requests <n>", "stop a script after this many page loads + API calls", "60")
  .option("--name <name>", "server name (default: from annotations, else the recorded host)")
  .action(async (url: string, opts: RecordCliOptions & { provider?: string; model?: string; allowWrites: boolean; name?: string }) => {
    const dir = opts.out;
    console.log("── 1/4 record");
    const cookies = await recordToDir(url, opts);
    // For the API's host, which may differ from the start URL (app.example.com → api.example.com).
    const cookie = cookieHeaderFor(cookies, (await loadCatalog(dir)).baseUrl);

    console.log("\n── 2/4 annotate");
    try {
      await inferDir(dir, { provider: opts.provider, model: opts.model, force: true });
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      console.log("no LLM key set: kept heuristic tool names (refine with `site2api infer` or the skill)");
    }

    console.log("\n── 3/4 verify");
    await verifyDir(dir, { rate: "1", cookie });

    console.log("\n── 4/4 generate");
    await generateDir(dir, { allowWrites: opts.allowWrites, onlyVerified: true, name: opts.name, quietAnnotations: true });
    console.log("\nDone.");
  });

program.parseAsync().catch((err: unknown) => {
  console.error(`site2api: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
