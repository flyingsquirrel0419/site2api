#!/usr/bin/env node
// Decides whether a pushed tag may be published to npm, before anything is built.
//
//   node scripts/check-release.mjs v0.1.0
//
// Fails when the tag is malformed, does not match package.json, the version is already on npm
// (or was published and unpublished, which npm never allows again), or a stable version would
// move `latest` backwards. A package that is not on npm yet is a first publish, not an error.
// In GitHub Actions the result goes to $GITHUB_OUTPUT: version, dist_tag, first_publish.
import { appendFileSync, readFileSync } from "node:fs";

const REGISTRY = (process.env.NPM_REGISTRY ?? "https://registry.npmjs.org").replace(/\/$/, "");
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

class ReleaseError extends Error {}

function fail(message) {
  throw new ReleaseError(message);
}

function parse(version) {
  const m = SEMVER.exec(version);
  return m && { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] };
}

// Compares release cores only; enough to stop `latest` going backwards.
function compareCore(a, b) {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  return 0;
}

async function fetchPackument(name) {
  const url = `${REGISTRY}/${name.replace("/", "%2f")}`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (res.status === 404) return null;
      if (res.ok) return await res.json();
      lastError = `${res.status} ${res.statusText}`;
      // A 4xx other than 404 will not get better by retrying.
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  fail(`Could not read ${url} from the registry (${lastError}). Nothing was published; re-run the job.`);
}

async function main() {
  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
  if (!tag) fail("No tag given. Usage: node scripts/check-release.mjs v1.2.3");
  if (!tag.startsWith("v") || !parse(tag.slice(1))) {
    fail(`Tag "${tag}" is not a release tag. Use v<major>.<minor>.<patch>, e.g. v0.1.0 or v0.2.0-beta.1.`);
  }
  const version = tag.slice(1);

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  } catch (err) {
    fail(`Could not read package.json: ${err instanceof Error ? err.message : err}`);
  }
  if (pkg.private) fail('package.json has "private": true, so npm would refuse it.');
  if (!pkg.name) fail("package.json has no name.");
  if (pkg.version !== version) {
    fail(`Tag ${tag} does not match package.json version ${pkg.version}. Bump package.json, commit, then tag that commit.`);
  }

  const next = parse(version);
  const distTag = next.pre ? "next" : "latest";
  const packument = await fetchPackument(pkg.name);
  const firstPublish = packument === null;

  if (firstPublish) {
    console.log(`${pkg.name} is not on npm yet: ${version} will be its first publish (registers the name).`);
  } else {
    if (packument.versions?.[version]) fail(`${pkg.name}@${version} is already on npm. Bump the version and tag again.`);
    if (packument.time?.[version]) {
      fail(`${pkg.name}@${version} was published before and unpublished; npm never accepts that version again. Bump it.`);
    }
    const latest = packument["dist-tags"]?.latest;
    const current = latest && parse(latest);
    if (distTag === "latest" && current && compareCore(next, current) < 0) {
      fail(`${version} is older than latest (${latest}). Publishing it would move "latest" backwards.`);
    }
    console.log(`${pkg.name}@${version} is not on npm yet (latest is ${latest ?? "unset"}).`);
  }

  let changelog = "";
  try {
    changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  } catch {
    // Reported as a missing section below.
  }
  if (!changelog.includes(`## [${version}]`)) {
    const msg = `CHANGELOG.md has no "## [${version}]" section.`;
    if (process.env.GITHUB_ACTIONS) console.log(`::warning file=CHANGELOG.md::${msg}`);
    else console.warn(`warning: ${msg}`);
  }

  console.log(`Will publish ${pkg.name}@${version} with dist-tag "${distTag}".`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ndist_tag=${distTag}\nfirst_publish=${firstPublish}\n`);
  }
}

main().catch((err) => {
  const message = err instanceof ReleaseError ? err.message : `Unexpected error: ${err?.stack ?? err}`;
  if (process.env.GITHUB_ACTIONS) console.log(`::error::${message.replaceAll("\n", "%0A")}`);
  else console.error(`error: ${message}`);
  process.exit(1);
});
