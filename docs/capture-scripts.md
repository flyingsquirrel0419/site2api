# Capture scripts

A capture script drives the browser instead of you. Use one when there is no screen (a Linux
server, CI), when you want the same recording every time (to re-record on a schedule and catch API
drift), or when your agent does the whole job for you.

## Writing one

A capture script is an ES module whose default export receives a
[Playwright `page`](https://playwright.dev/docs/api/class-page), already at the start URL:

```js
// capture.mjs
export default async (page, { url, pause }) => {
  // search, twice
  for (const query of ["rust", "python"]) {
    await page.fill("input[type=search]", query);
    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle");
    await pause();
  }

  // open two results
  for (const i of [0, 1]) {
    await page.locator(".result a").nth(i).click();
    await page.waitForLoadState("networkidle");
    await pause();
    await page.goBack();
  }
};
```

```bash
site2api record https://app.example.com --script capture.mjs -o out
```

The context argument has:

| | |
|---|---|
| `url` | The URL the recording started at |
| `pause(ms?)` | Wait between steps. Never shorter than the minimum pace (1 second) |

## Guidelines

- **Use each feature twice or more, with different inputs.** site2api compares samples to tell ids
  from constants and optional fields from required ones.
- **Look before you click.** Inspect the page (or have your agent print its inputs and buttons)
  rather than guessing selectors.
- **Wait for the network, not for time.** `waitForLoadState("networkidle")` or
  `page.waitForResponse(...)` after an action, then `pause()`.
- **Log in once by hand.** Run `site2api record <url>` without `--script` once, log in, and close
  the tab. The dedicated profile keeps the login for later scripted runs. Persistent cookies
  survive; session-only cookies end with the browser.
- **If the site shows a CAPTCHA or a "verify you are human" page, stop.** site2api does not get
  around them.

## Limits

| | Default | Flag |
|---|---|---|
| Page loads + API calls (images, scripts and styles are not counted) | 60 | `--max-requests` |
| Minimum pause between steps | 1 second | (fixed) |
| Window | Headless | `--headed` to watch |

When the request limit is reached, the script is stopped and what was recorded so far is analyzed.
If the script throws, the same happens and the error is printed. Fix the script and rerun if a
feature is missing from `report.md`.

## Example

[`demo/shop/capture.mjs`](../demo/shop/capture.mjs) drives the bundled demo shop. The shop has no
UI, so the script calls its API from the page the way a frontend would.
