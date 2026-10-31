# Verify

`site2api verify` calls every read-only operation on the live site and checks each response
against the schema inferred from the recording. It answers "does this tool actually work right
now?" before your agent finds out the hard way.

```bash
SITE2API_COOKIE='<Cookie header>' site2api verify out
```

```text
✅ list_orders                  HTTP 200
✅ get_order                    HTTP 200
🟡 search_stories               HTTP 200, but missing: /processingTimingsMS/fetch/total
❌ get_product                  /price: expected number, got string
⏭  get_invoice                  needs input: invoiceId (pass --input get_invoice.invoiceId=…)

2 passed, 1 with missing fields, 1 failed, 1 skipped
```

## What is called

Only operations that become read tools. Writes (`kind: write`) and logins or token endpoints
(`kind: auth`) are never called, whatever the annotations say about including them. A POST whose
path looks like a search is a write until annotations set `kind` to `read`.

Requests are rate-limited to 1 per second by default (`--rate`). `--rate` must be a finite number
>= 0. If the capture cannot be read, verify stops instead of calling the site without it.

## Where inputs come from

In this order:

1. `--input op.name=value` (operation id or tool name),
2. the response of a linked operation: `get_order.orderId` is taken from the `list_orders` result
   verify just fetched,
3. the recorded request for that operation, replayed from the capture.

Inputs with recorded defaults are filled in automatically. An operation whose required input has
no source is skipped, with the flag to pass.

## Credentials

`SITE2API_COOKIE`, `SITE2API_BEARER` and `SITE2API_KEY_<NAME>` from the environment, or with
`--profile`, the persistent cookies of the record browser profile. API keys not in the environment
are taken from the recording. Values are used in memory and never written to `verify.json`, which
records only the source of each input (`link`, `recording` or `user`).

`site2api run` verifies with the session captured at the end of the recording, so it needs no
cookie from you.

## Results

| | Status | Meaning |
|---|---|---|
| ✅ | `pass` | The response matches the recorded schema |
| 🟡 | `warn` | It works and every type matches, but fields that every recorded sample had are missing. Usually optional fields the samples happened to include |
| ❌ | `fail` | A type changed, the status was not one that was recorded, or the body is not JSON. The API probably changed |
| ⚠️ | `error` | Not authorized (expired session), redirected to a login page, or the site was unreachable |
| ⏭ | `skipped` | Needs a credential or an input verify does not have |

A missing field on a schema built from fewer than 3 samples says so: record more samples to make
the schema less strict.

## Using the results

`generate --only-verified` keeps read tools that are ✅ or 🟡. The generated README marks each
tool's result. Write tools are never verified and are kept when you pass `--allow-writes`.

To catch API drift, run verify on a schedule (for example nightly in CI, with a
[capture script](capture-scripts.md) to re-record when it fails).
