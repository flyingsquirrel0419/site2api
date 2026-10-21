---
name: site2api
description: Turn a website the user uses into a verified MCP server by recording its traffic and inferring a typed API. (Work in progress — inference steps land in v0.2.)
---

# site2api

Not ready yet. For now, run the deterministic core directly:

```bash
npx site2api from-har <capture.har> -o out/
```

It writes `out/openapi.yaml` and `out/report.md`.
