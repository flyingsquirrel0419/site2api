// Two layers of protection:
// 1. redactValue() scrubs example values before they are placed in the spec.
// 2. assertNoSecrets() is the last gate before anything is written: every credential-like
//    value seen in the capture is collected, and the output must contain none of them.
import { cookies, header, parseJson, setCookies, type Exchange } from "./capture/har.js";

const SENSITIVE_KEY = /pass(?:word|wd)?|secret|token|auth|session|csrf|xsrf|api[-_]?key|cookie|otp|pin\b/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+?\d[\d\s-]{7,}\d/g;
const LONG_TOKEN = /^[A-Za-z0-9_\-+/=.]{24,}$/;

export function redactValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key) && value !== null && typeof value !== "object") return "<redacted>";
  if (typeof value === "string") {
    if (LONG_TOKEN.test(value) && /\d/.test(value) && /[A-Za-z]/.test(value)) return "<token>";
    return value.replace(EMAIL, "user@example.com").replace(PHONE, "<phone>");
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, k)]));
  }
  return value;
}

// Values shorter than this are too generic to search for safely ("1", "true").
const MIN_SECRET_LENGTH = 6;

export function collectSecrets(exchanges: Exchange[]): string[] {
  const secrets = new Set<string>();
  const add = (v: string | undefined) => {
    if (v && v.length >= MIN_SECRET_LENGTH) secrets.add(v);
  };
  const addSensitiveFields = (value: unknown, key = "") => {
    if (typeof value === "string" && SENSITIVE_KEY.test(key)) add(value);
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) addSensitiveFields(v, Array.isArray(value) ? key : k);
    }
  };

  for (const ex of exchanges) {
    for (const v of cookies(ex).values()) add(v);
    for (const v of setCookies(ex).values()) add(v);
    const authorization = header(ex.requestHeaders, "authorization");
    add(authorization);
    add(authorization?.replace(/^\w+\s+/, ""));
    for (const h of ex.requestHeaders) {
      if (SENSITIVE_KEY.test(h.name) && h.name !== "cookie") add(h.value);
    }
    for (const [k, v] of ex.url.searchParams) if (SENSITIVE_KEY.test(k)) add(v);
    addSensitiveFields(parseJson(ex.requestBody));
    addSensitiveFields(parseJson(ex.responseBody));
  }
  return [...secrets];
}

export class SecretLeakError extends Error {}

export function assertNoSecrets(output: string, secrets: string[], label: string): void {
  const leaked = secrets.filter((s) => output.includes(s));
  if (leaked.length > 0) {
    const preview = leaked.map((s) => `${s.slice(0, 3)}…(${s.length} chars)`).join(", ");
    throw new SecretLeakError(`Refusing to write ${label}: it contains captured credential values (${preview}).`);
  }
}
