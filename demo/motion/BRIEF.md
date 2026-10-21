---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Every website already has an API. site2api pulls it out for your agent."
destination: website
aspect: 1920x1080
language: en
audience: developers who use coding agents (Claude Code, Cursor, Codex)
length: 15-20s
angle: x-ray reveal
narration: no
---

## Intent

A simple, motion-graphics explainer for the top of site2api's GitHub README, replacing a
screen-recording demo the user found flat. Concept chosen in the pitch round: **X-ray**. A
website floats on screen; a scanner beam sweeps across it and reveals the API calls hidden
under the page as glowing lines; the lines are pulled out and snap into labeled tool blocks
(e.g. `search_stories`); the blocks plug into an AI agent. Someone who has never heard of MCP
should get the idea in three seconds.

## Customizations

- No-capture mode: the on-screen website is an abstract mockup, not HN or any real site, so it
  cannot be mistaken for a particular site.
- site2api's own palette (purple #8b6cff → teal #5ee3c1 on near-black #0b0d14, from the README
  flow diagram).
- Silent: README embeds autoplay muted. On-screen text carries the message, at most ~6 words per
  line.
- Ends on the logo and `npx site2api run <url>`.
- Deliverables: MP4, plus a light GIF for the README (made outside HyperFrames from the MP4).

## Notes

- Product: site2api turns a website you use into a verified MCP server: record traffic →
  find endpoints and auth → trace where inputs come from → name tools → verify against the live
  site → generate the server.
- Stay truthful: show endpoints, tool blocks, a "verified" check and an agent; no invented
  metrics or claims.
- Loops at the top of a README, so the last frame should sit well before the first.
