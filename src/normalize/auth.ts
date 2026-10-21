// Detects the *shape* of authentication — which cookie names, header names and schemes
// carry it. Values are never kept.
import { cookies, header, setCookies, type Exchange } from "../capture/har.js";

export interface AuthHints {
  bearer: boolean;
  /** Cookie names that look like session state (sent on 2+ requests, not analytics). */
  sessionCookies: string[];
  /** Request headers that look like CSRF protection. */
  csrfHeaders: string[];
  /** Request headers that look like API keys. */
  apiKeyHeaders: string[];
}

export interface ExchangeAuth {
  bearer: boolean;
  cookies: string[];
  csrfHeaders: string[];
  apiKeyHeaders: string[];
  setsCookies: string[];
}

const ANALYTICS_COOKIE = /^(?:_ga|_gid|_gat|_fbp|_fbc|_hj|amplitude|mp_|ajs_|intercom-|__utm|_clck|_clsk)/i;
const CSRF_HEADER = /^x-(?:csrf|xsrf)(?:-token)?$|csrf/i;
const API_KEY_HEADER = /^x-(?:api-key|apikey|api-token|auth-token)$/i;

export function detectAuth(exchanges: Exchange[]): AuthHints {
  const cookieUse = new Map<string, number>();
  const csrf = new Set<string>();
  const apiKey = new Set<string>();
  let bearer = false;

  for (const ex of exchanges) {
    for (const name of cookies(ex).keys()) {
      if (!ANALYTICS_COOKIE.test(name)) cookieUse.set(name, (cookieUse.get(name) ?? 0) + 1);
    }
    if (/^bearer\s/i.test(header(ex.requestHeaders, "authorization") ?? "")) bearer = true;
    for (const h of ex.requestHeaders) {
      if (CSRF_HEADER.test(h.name)) csrf.add(h.name);
      if (API_KEY_HEADER.test(h.name)) apiKey.add(h.name);
    }
  }

  return {
    bearer,
    sessionCookies: [...cookieUse].filter(([, n]) => n >= 2).map(([name]) => name).sort(),
    csrfHeaders: [...csrf].sort(),
    apiKeyHeaders: [...apiKey].sort(),
  };
}

export function exchangeAuth(ex: Exchange, hints: AuthHints): ExchangeAuth {
  const sent = cookies(ex);
  const names = new Set(ex.requestHeaders.map((h) => h.name));
  return {
    bearer: hints.bearer && /^bearer\s/i.test(header(ex.requestHeaders, "authorization") ?? ""),
    cookies: hints.sessionCookies.filter((c) => sent.has(c)),
    csrfHeaders: hints.csrfHeaders.filter((h) => names.has(h)),
    apiKeyHeaders: hints.apiKeyHeaders.filter((h) => names.has(h)),
    setsCookies: [...setCookies(ex).keys()].filter((c) => !ANALYTICS_COOKIE.test(c)).sort(),
  };
}
