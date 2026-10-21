// Keeps only the requests that look like the site's own API: JSON or GraphQL, first-party, not analytics.
import type { Exchange } from "../capture/har.js";
import { graphqlCall } from "./graphql.js";

export type DropReason = "method" | "static" | "analytics" | "third-party" | "not-json";

export interface FilterResult {
  kept: Exchange[];
  dropped: Record<DropReason, number>;
  site: string;
}

export interface FilterOptions {
  /** Site (eTLD+1) to treat as first-party. Inferred from the most frequent API host when omitted. */
  site?: string;
  /** Extra hosts or sites to keep, e.g. a separate api.example-cdn.com. */
  includeOrigins?: string[];
}

const STATIC_EXT = /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wasm|html?)$/i;

const ANALYTICS_HOSTS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "segment.io",
  "segment.com",
  "sentry.io",
  "hotjar.com",
  "mixpanel.com",
  "amplitude.com",
  "facebook.net",
  "clarity.ms",
  "datadoghq.com",
  "newrelic.com",
  "nr-data.net",
  "intercom.io",
];

// Second-level labels under which registrable domains take three labels (example.co.kr).
const SECOND_LEVEL = new Set(["co", "com", "or", "ne", "go", "ac", "net", "org", "gov", "edu"]);

// Shared hosting where every subdomain belongs to someone else (from the Public Suffix List's
// private section). alice.github.io and bob.github.io are different sites: their cookies and
// sessions must never mix.
const SHARED_SUFFIXES = [
  "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "herokuapp.com",
  "onrender.com", "fly.dev", "web.app", "firebaseapp.com", "appspot.com", "azurewebsites.net",
  "cloudfront.net", "blogspot.com", "glitch.me", "replit.app", "deno.dev", "surge.sh", "ngrok.app",
  "ngrok-free.app", "trycloudflare.com", "s3.amazonaws.com", "amplifyapp.com", "railway.app",
];

export function siteOf(host: string): string {
  if (host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":")) return host;
  const shared = SHARED_SUFFIXES.find((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (shared) {
    const labels = host.slice(0, -shared.length - 1).split(".").filter(Boolean);
    return labels.length > 0 ? `${labels.at(-1)}.${shared}` : host;
  }
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const take = SECOND_LEVEL.has(labels[labels.length - 2]!) && labels.at(-1)!.length === 2 ? 3 : 2;
  return labels.slice(-take).join(".");
}

function isJson(mime: string | undefined): boolean {
  return !!mime && /(?:^|\/|\+)json\b|graphql/i.test(mime);
}

function isAnalytics(host: string): boolean {
  return ANALYTICS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function filterExchanges(exchanges: Exchange[], options: FilterOptions = {}): FilterResult {
  const dropped: Record<DropReason, number> = {
    method: 0,
    static: 0,
    analytics: 0,
    "third-party": 0,
    "not-json": 0,
  };

  const candidates: Exchange[] = [];
  for (const ex of exchanges) {
    if (ex.method === "OPTIONS" || ex.method === "HEAD") dropped.method++;
    else if (isAnalytics(ex.url.hostname)) dropped.analytics++;
    else if (STATIC_EXT.test(ex.url.pathname)) dropped.static++;
    else if (!isJson(ex.responseMime) && !graphqlCall(ex)) dropped["not-json"]++;
    else candidates.push(ex);
  }

  const site = options.site ?? mostFrequentSite(candidates);
  const extra = new Set(options.includeOrigins ?? []);
  const kept: Exchange[] = [];
  for (const ex of candidates) {
    const host = ex.url.hostname;
    if (siteOf(host) === site || extra.has(host) || extra.has(siteOf(host))) kept.push(ex);
    else dropped["third-party"]++;
  }
  return { kept, dropped, site };
}

function mostFrequentSite(exchanges: Exchange[]): string {
  const counts = new Map<string, number>();
  for (const ex of exchanges) {
    const site = siteOf(ex.url.hostname);
    counts.set(site, (counts.get(site) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [site, count] of counts) {
    if (count > bestCount) [best, bestCount] = [site, count];
  }
  return best;
}
