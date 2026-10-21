// HAR 1.2 → Exchange[]: the one shape every later stage works on.

export interface Header {
  name: string; // lowercased
  value: string;
}

export interface Exchange {
  method: string;
  url: URL;
  requestHeaders: Header[];
  requestMime?: string;
  requestBody?: string;
  status: number;
  responseHeaders: Header[];
  responseMime?: string;
  responseBody?: string;
}

interface HarEntry {
  request: {
    method: string;
    url: string;
    headers?: { name: string; value: string }[];
    postData?: { mimeType?: string; text?: string };
  };
  response: {
    status: number;
    headers?: { name: string; value: string }[];
    content?: { mimeType?: string; text?: string; encoding?: string };
  };
}

export function parseHar(text: string): Exchange[] {
  let doc: { log?: { entries?: HarEntry[] } };
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("Not a HAR file: invalid JSON");
  }
  const entries = doc.log?.entries;
  if (!Array.isArray(entries)) throw new Error("Not a HAR file: missing log.entries");

  const exchanges: Exchange[] = [];
  for (const entry of entries) {
    let url: URL;
    try {
      url = new URL(entry.request.url);
    } catch {
      continue; // data:, blob: and friends
    }
    const content = entry.response.content;
    exchanges.push({
      method: entry.request.method.toUpperCase(),
      url,
      requestHeaders: normalizeHeaders(entry.request.headers),
      requestMime: entry.request.postData?.mimeType,
      requestBody: entry.request.postData?.text,
      status: entry.response.status,
      responseHeaders: normalizeHeaders(entry.response.headers),
      responseMime: content?.mimeType,
      responseBody:
        content?.text !== undefined && content.encoding === "base64"
          ? Buffer.from(content.text, "base64").toString("utf8")
          : content?.text,
    });
  }
  return exchanges;
}

function normalizeHeaders(headers: { name: string; value: string }[] = []): Header[] {
  return headers.map((h) => ({ name: h.name.toLowerCase(), value: h.value }));
}

export function header(headers: Header[], name: string): string | undefined {
  return headers.find((h) => h.name === name)?.value;
}

export function cookies(ex: Exchange): Map<string, string> {
  const result = new Map<string, string>();
  for (const h of ex.requestHeaders) {
    if (h.name !== "cookie") continue;
    for (const part of h.value.split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) result.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }
  return result;
}

export function setCookies(ex: Exchange): Map<string, string> {
  const result = new Map<string, string>();
  for (const h of ex.responseHeaders) {
    if (h.name !== "set-cookie") continue;
    // Some HAR writers join multiple Set-Cookie headers with newlines.
    for (const line of h.value.split("\n")) {
      const first = line.split(";")[0] ?? "";
      const eq = first.indexOf("=");
      if (eq > 0) result.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }
  return result;
}

export function parseJson(text: string | undefined): unknown {
  if (text === undefined || text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
