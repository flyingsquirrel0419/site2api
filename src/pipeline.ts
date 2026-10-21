import { stringify } from "yaml";
import { parseHar } from "./capture/har.js";
import { detectAuth } from "./normalize/auth.js";
import { filterExchanges, type FilterResult } from "./normalize/filter.js";
import { assertNoSecrets, collectSecrets } from "./redact.js";
import { renderReport } from "./report.js";
import { buildSpec } from "./spec/openapi.js";
import { groupOperations, type Operation } from "./spec/operations.js";

export interface AnalyzeOptions {
  source?: string;
  site?: string;
  includeOrigins?: string[];
  examples?: boolean;
}

export interface AnalyzeResult {
  spec: Record<string, unknown>;
  yaml: string;
  report: string;
  operations: Operation[];
  filter: FilterResult;
}

export function analyzeHar(text: string, options: AnalyzeOptions = {}): AnalyzeResult {
  const exchanges = parseHar(text);
  const filter = filterExchanges(exchanges, { site: options.site, includeOrigins: options.includeOrigins });
  const hints = detectAuth(filter.kept);
  const operations = groupOperations(filter.kept, hints);
  const spec = buildSpec(operations, hints, { site: filter.site, examples: options.examples });

  const yaml = stringify(spec, { lineWidth: 0 });
  const report = renderReport({
    source: options.source ?? "<stdin>",
    total: exchanges.length,
    filter,
    hints,
    operations,
  });

  // Last gate: nothing captured as a credential may appear in what we write.
  const secrets = collectSecrets(exchanges);
  assertNoSecrets(yaml, secrets, "openapi.yaml");
  assertNoSecrets(report, secrets, "report.md");

  return { spec, yaml, report, operations, filter };
}
