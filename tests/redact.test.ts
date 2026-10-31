import { describe, expect, it } from "vitest";
import { parseHar } from "../src/capture/har.js";
import { analyzeHar } from "../src/pipeline.js";
import { collectSecrets, redactValue, SecretLeakError } from "../src/redact.js";
import { har } from "./helpers.js";

describe("redactValue", () => {
  it("redacts sensitive keys, emails, phones and opaque tokens", () => {
    expect(
      redactValue({
        password: "hunter22",
        csrfToken: "abc",
        contact: { email: "kim@corp.kr", phone: "+82-10-1234-5678" },
        ref: "eyJhbGciOiJIUzI1NiJ9abc123def456",
        name: "Keyboard",
        count: 3,
      }),
    ).toEqual({
      password: "<redacted>",
      csrfToken: "<redacted>",
      contact: { email: "user@example.com", phone: "<phone>" },
      ref: "<token>",
      name: "Keyboard",
      count: 3,
    });
  });
});

describe("collectSecrets", () => {
  it("collects cookie, authorization, sensitive header, query and body values", () => {
    const secrets = collectSecrets(
      parseHar(
        har([
          {
            method: "POST",
            url: "https://shop.com/api/login?access_token=qs-secret-1",
            requestHeaders: { Cookie: "sid=cookie-secret-1; theme=dark", Authorization: "Bearer bearer-secret-1" },
            requestBody: { email: "a@b.co", password: "pw-secret-1" },
            responseHeaders: { "Set-Cookie": "sid=cookie-secret-2; HttpOnly" },
            responseBody: { csrfToken: "csrf-secret-1" },
          },
        ]),
      ),
    );
    for (const s of ["qs-secret-1", "cookie-secret-1", "bearer-secret-1", "pw-secret-1", "cookie-secret-2", "csrf-secret-1"]) {
      expect(secrets).toContain(s);
    }
    expect(secrets).not.toContain("dark"); // too short, and not token-shaped, to search safely
  });

  it("tracks a short token-shaped cookie value and ignores a short word", () => {
    const secrets = collectSecrets(
      parseHar(
        har([
          {
            url: "https://shop.com/api/me",
            requestHeaders: { cookie: "sid=abc12; theme=dark" },
            responseBody: { note: "abc12" },
          },
        ]),
      ),
    );
    expect(secrets).toContain("abc12");
    expect(secrets).not.toContain("dark");
  });
});

describe("analyzeHar leak gate", () => {
  it("refuses to write a spec that would contain a captured credential", () => {
    // The session token is echoed in an innocent-looking field, and --examples would copy it out.
    const text = har([
      { url: "https://shop.com/api/session", responseBody: { sessionToken: "tok-9f8e7d6c", echo: "tok-9f8e7d6c" } },
    ]);
    expect(() => analyzeHar(text, { examples: true })).toThrow(SecretLeakError);
    expect(() => analyzeHar(text, { examples: false })).not.toThrow();
  });

  it("refuses an example that echoes a 5-character token cookie", () => {
    const text = har([
      {
        url: "https://shop.com/api/me",
        requestHeaders: { cookie: "sid=abc12" },
        responseBody: { note: "abc12" },
      },
    ]);
    expect(() => analyzeHar(text, { examples: true })).toThrow(SecretLeakError);
    expect(() => analyzeHar(text, { examples: false })).not.toThrow();
  });
});
