#!/usr/bin/env node
import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "./generate/generate.js";
import { annotationsJsonSchema } from "./infer/annotations.js";
import { renderContext } from "./infer/context.js";
import { analyzeHar } from "./pipeline.js";
import { assertNoFingerprintedSecrets } from "./redact.js";
import { verify, type VerifyReport } from "./verify/verify.js";
import {
  AnnotationsError,
  findCapture,
  loadAnnotations,
  loadCatalog,
  loadFingerprint,
  SECRETS_FILE,
  SOURCE_FILE,
  VERIFY_FILE,
} from "./workspace.js";

const program = new Command()
  .name("site2api")
  .description("Turn any website you use into a verified MCP server.")
  .version("0.0.1");

program
  .command("from-har")
  .description("Analyze a HAR capture and write an OpenAPI 3.1 spec plus a report")
  .argument("<file>", "HAR file exported from browser devtools or Playwright")
  .option("-o, --out <dir>", "output directory", "out")
  .option("--site <site>", "first-party site (eTLD+1); inferred when omitted")
  .option("--include-origin <host...>", "extra hosts or sites to keep")
  .option("--examples", "include redacted example values in the spec", false)
  .action(async (file: string, opts: { out: string; site?: string; includeOrigin?: string[]; examples: boolean }) => {
    const result = analyzeHar(await readFile(file, "utf8"), {
      source: basename(file),
      site: opts.site,
      includeOrigins: opts.includeOrigin,
      examples: opts.examples,
    });
    await mkdir(opts.out, { recursive: true });
    await writeFile(join(opts.out, "openapi.yaml"), result.yaml);
    await writeFile(join(opts.out, "report.md"), result.report);
    await mkdir(join(opts.out, dirname(SECRETS_FILE)), { recursive: true });
    await writeFile(join(opts.out, SECRETS_FILE), JSON.stringify(result.secrets) + "\n");
    await writeFile(join(opts.out, SOURCE_FILE), JSON.stringify({ har: resolve(file) }) + "\n");

    const rest = result.operations.filter((op) => !op.graphql).length;
    const graphql = result.operations.length - rest;
    console.log(`site: ${result.filter.site}`);
    console.log(`kept ${result.filter.kept.length} requests → ${rest} REST + ${graphql} GraphQL operations`);
    console.log(`wrote ${join(opts.out, "openapi.yaml")} and ${join(opts.out, "report.md")}`);
  });

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
  .command("generate")
  .description("Generate a runnable MCP server in <dir>/mcp from openapi.yaml and annotations.json")
  .argument("[dir]", "output directory of from-har", "out")
  .option("--allow-writes", "include tools that change data (they still require confirm: true)", false)
  .option("--only-verified", "keep only read tools that passed `site2api verify`", false)
  .action(async (dir: string, opts: { allowWrites: boolean; onlyVerified: boolean }) => {
    const runtimePath = fileURLToPath(new URL("./runtime/server.mjs", import.meta.url));
    try {
      const result = await generate(dir, { allowWrites: opts.allowWrites, onlyVerified: opts.onlyVerified, runtimePath });
      for (const w of result.warnings) console.warn(`warning: ${w}`);
      console.log(`${result.tools.tools.length} tools, ${result.tools.skipped.length} skipped → ${result.outDir}`);
      for (const t of result.tools.tools) console.log(`  ${t.kind === "write" ? "✎" : "·"} ${t.name}`);
      console.log(`see ${join(result.outDir, "README.md")} to register it with your agent`);
    } catch (err) {
      if (err instanceof AnnotationsError) {
        console.error(err.message);
        console.error("Fix annotations.json and run generate again.");
        process.exit(2);
      }
      throw err;
    }
  });

program
  .command("verify")
  .description("Call every read-only operation on the live site and check responses against the spec")
  .argument("[dir]", "output directory of from-har", "out")
  .option("--base-url <url>", "call this origin instead of the recorded one")
  .option("--input <op.name=value...>", "value for a required input, e.g. get_product.productId=2")
  .option("--har <file>", "capture to replay input values from (default: the one from-har used)")
  .option("--rate <n>", "max requests per second", "1")
  .action(async (dir: string, opts: { baseUrl?: string; input?: string[]; har?: string; rate: string }) => {
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
    const report = await verify(catalog, annotations, {
      credentials: { cookie: process.env.SITE2API_COOKIE, bearer: process.env.SITE2API_BEARER },
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
    console.log(`wrote ${join(dir, VERIFY_FILE)}; next: site2api generate ${dir} --only-verified`);
  });

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
  const mark = { pass: "✅", fail: "❌", skipped: "⏭ ", error: "⚠️" } as const;
  for (const r of report.results) {
    const detail = r.status === "pass" ? `HTTP ${r.httpStatus}` : (r.reason ?? r.errors?.join("; ") ?? "");
    console.log(`${mark[r.status]} ${r.tool.padEnd(28)} ${detail}`);
  }
  const s = report.summary;
  console.log(`\n${s.pass} passed, ${s.fail} failed, ${s.error} errors, ${s.skipped} skipped`);
}

program.parseAsync().catch((err: unknown) => {
  console.error(`site2api: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
