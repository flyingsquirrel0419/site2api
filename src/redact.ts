// Two layers of protection:
// 1. redactValue() scrubs example values before they are placed in the spec.
// 2. assertNoSecrets() is the last gate before anything is written: every credential-like
//    value seen in the capture is collected, and the output must contain none of them.
import { createHash, randomBytes } from "node:crypto";
import { cookies, header, parseJson, setCookies, type Exchange } from "./capture/har.js";

// Short names (pw, sig, key, code) only count as the whole name or its last part: `user_pw`, not `pwdth`.
export const SENSITIVE_KEY =
  /pass(?:word|wd)?|pwd|secret|token|auth|session|csrf|xsrf|api[-_]?key|access[-_]?key|private[-_]?key|cookie|otp|pin\b|jwt|signature|credential|(?:^|[-_.])(?:pw|sig|sid|key|code|nonce|hmac)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+?\d[\d\s-]{7,}\d/g;
const LONG_TOKEN = /^[A-Za-z0-9_\-+/=.]{24,}$/;

/** `sensitive`: a parent key was sensitive, so everything under it is ({"auth": {"code": …}}). */
export function redactValue(value: unknown, key = "", sensitive = false): unknown {
  const secret = sensitive || SENSITIVE_KEY.test(key);
  if (secret && value !== null && typeof value !== "object") return "<redacted>";
  if (typeof value === "string") {
    if (LONG_TOKEN.test(value) && /\d/.test(value) && /[A-Za-z]/.test(value)) return "<token>";
    return value.replace(EMAIL, "user@example.com").replace(PHONE, "<phone>");
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, key, secret));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, k, secret)]));
  }
  return value;
}

// Values shorter than this are too generic to search for safely ("1", "true").
const MIN_SECRET_LENGTH = 6;

export function collectSecrets(exchanges: Exchange[]): string[] {
  const secrets = new Set<string>();
  const add = (v: string | undefined) => {
    if (!v || v.length < MIN_SECRET_LENGTH) return;
    // Also the forms it may be echoed in: "a%2Bb" in a cookie comes back as "a+b".
    for (const form of [v, safeDecode(v), encodeURIComponent(v)]) if (form.length >= MIN_SECRET_LENGTH) secrets.add(form);
  };
  const addSensitiveFields = (value: unknown, key = "", sensitive = false) => {
    const secret = sensitive || SENSITIVE_KEY.test(key);
    if (secret && (typeof value === "string" || typeof value === "number")) add(String(value));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) addSensitiveFields(v, Array.isArray(value) ? key : k, secret);
    }
    if (typeof value === "string" && key === "query") for (const v of graphqlSensitiveLiterals(value)) add(v);
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
    const body = parseJson(ex.requestBody);
    if (body !== undefined) addSensitiveFields(body);
    else if (ex.requestBody && /^[^=&\s]+=[^&]*(?:&[^=&\s]+=[^&]*)*$/.test(ex.requestBody.trim())) {
      // A form body (username=…&password=…)
      for (const [k, v] of new URLSearchParams(ex.requestBody)) if (SENSITIVE_KEY.test(k)) add(v);
    }
    addSensitiveFields(parseJson(ex.responseBody));
  }
  return [...secrets];
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v.replace(/\+/g, " "));
  } catch {
    return v;
  }
}

// `name: "literal"` arguments inside GraphQL query text.
const GRAPHQL_STRING_ARG = /\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"((?:[^"\\]|\\.)*)"/g;

function graphqlSensitiveLiterals(query: string): string[] {
  return [...query.matchAll(GRAPHQL_STRING_ARG)].filter(([, name]) => SENSITIVE_KEY.test(name!)).map(([, , value]) => value!);
}

/** Inline credentials and emails in a GraphQL document (`login(password: "…")`) are replaced. */
export function redactGraphqlQuery(query: string): string {
  return query.replace(GRAPHQL_STRING_ARG, (match, name: string, value: string) => {
    if (SENSITIVE_KEY.test(name)) return `${name}: "<redacted>"`;
    const redacted = redactValue(value);
    return redacted === value ? match : `${name}: ${JSON.stringify(redacted)}`;
  });
}

export class SecretLeakError extends Error {}

export function assertNoSecrets(output: string, secrets: string[], label: string): void {
  const leaked = secrets.filter((s) => output.includes(s));
  if (leaked.length > 0) {
    const preview = leaked.map((s) => `${s.slice(0, 3)}…(${s.length} chars)`).join(", ");
    throw new SecretLeakError(`Refusing to write ${label}: it contains captured credential values (${preview}).`);
  }
}

// Later stages (generate) no longer have the HAR, so from-har leaves salted hashes of the
// credential values behind. Output is split into tokens and each token is hashed and looked up,
// which catches a cookie or token pasted anywhere (e.g. into an annotation description).
export interface SecretFingerprint {
  salt: string;
  hashes: string[];
}

export function fingerprintSecrets(secrets: string[]): SecretFingerprint {
  const salt = randomBytes(16).toString("hex");
  return { salt, hashes: [...new Set(secrets.map((s) => hash(salt, s)))].sort() };
}

export function assertNoFingerprintedSecrets(output: string, fp: SecretFingerprint, label: string): void {
  const known = new Set(fp.hashes);
  const leaked = candidates(output).filter((token) => known.has(hash(fp.salt, token)));
  if (leaked.length > 0) {
    throw new SecretLeakError(
      `Refusing to write ${label}: it contains ${leaked.length} value(s) captured as credentials in the HAR. Remove them and retry.`,
    );
  }
}

function candidates(text: string): string[] {
  const out = new Set<string>();
  const addForms = (piece: string) => {
    if (piece.length < MIN_SECRET_LENGTH) return;
    out.add(piece);
    out.add(piece.replace(/[.:!?]+$/, ""));
    out.add(safeDecode(piece));
  };
  for (const token of text.match(/[^\s"'`,;<>(){}\[\]]+/g) ?? []) {
    if (token.length < MIN_SECRET_LENGTH) continue;
    addForms(token);
    // "sid=abc…", "?sid=abc&x=1", "/s/abc/x", "sid:abc" pieces
    const eq = token.indexOf("=");
    if (eq > 0) addForms(token.slice(eq + 1));
    for (const piece of token.split(/[=&?#/:|\\]+/)) addForms(piece);
  }
  return [...out];
}

function hash(salt: string, value: string): string {
  return createHash("sha256").update(salt).update("\0").update(value).digest("hex");
}
