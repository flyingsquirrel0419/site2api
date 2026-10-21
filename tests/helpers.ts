// Builds small HAR documents for tests.
export interface EntrySpec {
  method?: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
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
          ...(e.requestBody !== undefined
            ? { postData: { mimeType: "application/json", text: JSON.stringify(e.requestBody) } }
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
