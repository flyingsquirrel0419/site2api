// Builds small HAR documents for tests.
export interface EntrySpec {
  method?: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  /** Request body text as is, e.g. a form body. Overrides requestBody. */
  rawRequestBody?: string;
  /** Content type the HAR records for the request body (default application/json). */
  requestMime?: string;
  status?: number;
  responseMime?: string;
  responseBody?: unknown;
  responseHeaders?: Record<string, string>;
}

export function har(entries: EntrySpec[]): string {
  return JSON.stringify({
    log: {
      version: "1.2",
      entries: entries.map((e) => ({
        request: {
          method: e.method ?? "GET",
          url: e.url,
          headers: Object.entries(e.requestHeaders ?? {}).map(([name, value]) => ({ name, value })),
          ...(e.rawRequestBody !== undefined || e.requestBody !== undefined
            ? { postData: { mimeType: e.requestMime ?? "application/json", text: e.rawRequestBody ?? JSON.stringify(e.requestBody) } }
            : {}),
        },
        response: {
          status: e.status ?? 200,
          headers: Object.entries(e.responseHeaders ?? {}).map(([name, value]) => ({ name, value })),
          content: {
            mimeType: e.responseMime ?? "application/json",
            text: typeof e.responseBody === "string" ? e.responseBody : JSON.stringify(e.responseBody ?? {}),
          },
        },
      })),
    },
  });
}
