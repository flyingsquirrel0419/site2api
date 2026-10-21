#!/usr/bin/env node
import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { annotationsJsonSchema } from "./infer/annotations.js";
import { renderContext } from "./infer/context.js";
import { analyzeHar } from "./pipeline.js";
import { readCatalog } from "./spec/catalog.js";

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
    const catalog = readCatalog(parse(await readFile(join(dir, "openapi.yaml"), "utf8")));
    await mkdir(join(dir, "infer"), { recursive: true });
    await writeFile(join(dir, "infer", "context.md"), renderContext(catalog));
    await writeFile(join(dir, "infer", "annotations.schema.json"), JSON.stringify(annotationsJsonSchema(), null, 2) + "\n");
    console.log(`wrote ${join(dir, "infer", "context.md")} (${catalog.operations.length} operations)`);
    console.log(`next: read it, write ${join(dir, "annotations.json")}, then run: site2api generate ${dir}`);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(`site2api: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
