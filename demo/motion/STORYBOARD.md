---
format: 1920x1080
duration: 18s
message: "Every website already has an API. site2api pulls it out for your agent."
arc: Future Pacing — reveal → mechanism → outcome → CTA
audience: developers who use coding agents (Claude Code, Cursor, Codex)
mode: autonomous
music: none
---

Silent explainer for the top of a GitHub README (autoplays muted, loops). No narration, no
`SCRIPT.md`: the on-screen line of each frame (`onscreen`) is what the viewer reads, and it paces
the reveals the way a voiceover would. One continuous world — the same website card carries from
frame 1 into frame 2, and the endpoint lines from frame 2 become the tools of frame 3.

## Video direction

- **palette system** (from `frame.md`, dark register only): ground `ink-black` #0b0d14; text `cream`
  #eef1f8; the one accent `fire-orange` slot = site2api purple #8b6cff (scanner beam, endpoint
  lines, the agent node); `cream-muted` slot = teal #5ee3c1, used only for the "verified" checks and
  the final caret, so the purple→teal move reads as raw → proven. Hairlines `border-dark`. No other
  hues.
- **type**: `frame.md` roles only. On-screen lines use `h2` (lowercase Barlow 700) except Frame 5's
  wordmark (`display`); endpoint paths, tool names and the command use the `label` mono role at
  larger size (IBM Plex Mono). Every line ≤ 6 words.
- **motion grammar**: one camera, one world. Long-tail `power3` settles, never bouncy. Each frame
  reveals its pieces on the cue order of its `onscreen` line and its scene, spread across the back
  half; the only aliveness in a hold is subtle jitter. The scanner beam and the tracing dash are
  the two "light" moves of the film — nothing else glows.
- **rhythm**: Frame 1 and Frame 5 are held reads (calm in, calm out, so the README loop seams
  quietly); Frames 2–4 carry the motion, with Frame 2's sweep as the climax of the mechanism.
- **continuity**: the website card is the same object in Frames 1→2 (handoff below); the three
  endpoint lines of Frame 2 are the source of the three tool cards of Frame 3; the cards of Frame 3
  are the satellites of Frame 4.
- **negative list**: no browser chrome of a real site, no logos of real companies, no stock "AI"
  purple-blue gradients or bokeh, no particles, no floating icons; no slideshow (front-load then
  freeze), no screensaver (many things drifting); no breathing, no back-half pan/push; no
  `repeat`/`yoyo`, no randomness. Keep content in the top ~83% (caption band clear, though captions
  are off).

## Frame 1 — A website, and a secret

- scene: An ordinary website card floats on a near-black field; a line of type states that it already has an API
- onscreen: "Every website already has an API."
- voiceover: ""
- duration: 3.5s
- poster: 2.8s
- transition_in: cut
- status: animated
- src: compositions/frames/01-secret.html
- type: hook
- persuasion: Curiosity gap — a claim the viewer half-knows (sites talk to a backend) stated as a reveal
- beat: curiosity
- blueprint: compose
- asset_candidates:
- focal: the website card (built in HTML — an abstract page: a header bar, a search field, three result rows, no real brand)
- roles: website card = cutout · headline = supporting · ground = background
- handoff_out: website card — center x 960 y 430, scale 1, opacity 1, rotation 0, still (no motion at the cut)

Compose: a one-card set plus a statement that builds onto a payoff word (`spring-pop-entrance` + `dynamic-content-sequencing`).
Scene 1 (0.0–1.2s): solid ink-black ground; the website card rises into the upper-center on a smooth long-tail settle (`spring-pop-entrance`, smooth register), ~45% of frame wide — Centered, 3 depth layers (ground, faint grid hairlines, card).
Scene 2 (1.2–2.6s): the line "every website already has" reveals word by word under the card (`dynamic-content-sequencing`), cream `h2`.
Scene 3 (2.6–3.5s): the last words "an API." land last, "API" set in the purple accent color from its first frame (no glow, no loop); everything holds still — the held read.

narrativeRole: Opens on the promise in outcome language: the API the viewer's agent needs already exists.
keyMessage: The website you use is already backed by an API.

## Frame 2 — The x-ray

- scene: A scanner beam sweeps across the website card; under it the page turns to wireframe and glowing request lines light up, each labeled with a real endpoint
- onscreen: "site2api finds it."
- voiceover: ""
- duration: 4.5s
- poster: 3.6s
- transition_in: cut
- status: animated
- src: compositions/frames/02-xray.html
- type: product_intro
- persuasion: Show-don't-tell proof — the hidden layer becomes visible instead of being described
- beat: intrigue + clarity
- blueprint: compose
- asset_candidates:
- focal: the scanner beam crossing the website card
- roles: website card = cutout · endpoint lines + labels = supporting · ground = background
- handoff_in: website card — center x 960 y 430, scale 1, opacity 1, rotation 0, still
- handoff_out: three endpoint lines — stacked under the card at y 760 / 820 / 880, left-aligned at x 640, opacity 1, still

Compose (no blueprint has a scan): built from `svg-path-draw` + `depth-of-field-blur` + `per-word staggered reveal`.
Scene 1 (0.0–0.8s): the card from Frame 1 is already in place (handoff); Frame 1's headline is gone; a thin vertical purple beam enters at the card's left edge.
Scene 2 (0.8–2.6s): the beam sweeps left→right across the card on one long `power3` move; behind the beam the card turns to wireframe (fills drop to hairline outlines) — the x-ray; a faint purple glow travels with the beam only (`ambient-glow-bloom`, bounded to the sweep).
Scene 3 (2.6–3.8s): as the beam exits, three request lines self-draw out of the card downward (`svg-path-draw`), each ending in a mono label that types in: `GET /api/search`, `GET /api/orders`, `GET /api/orders/{id}` — one per cue, staggered.
Scene 4 (3.8–4.5s): the line "site2api finds it." reveals at the top-left in `h2` (`dynamic-content-sequencing`); the wireframe card dims slightly (`depth-of-field-blur` on the card only) so the three endpoint lines read as the subject; hold.

narrativeRole: Lands the value by beat 2 (story spine § 2): site2api is the thing that makes the hidden API visible.
keyMessage: site2api sees the API under the page — GET /api/orders, POST /search.

## Frame 3 — Pulled out, verified

- scene: The glowing lines lift off the page and snap into three tool cards (search_stories, list_orders, get_order); each card's badge flips to a green "verified" check
- onscreen: "Real tools. Verified live."
- voiceover: ""
- duration: 4s
- poster: 3.4s
- transition_in: cut
- status: animated
- src: compositions/frames/03-tools.html
- type: feature_showcase
- persuasion: Risk reversal — every tool is checked against the live site before you use it
- beat: confidence
- blueprint: agent-progress-theater (Adapt)
- asset_candidates:
- focal: the three tool cards and their verified badges
- roles: tool cards = cutout · headline = supporting · ground = background
- handoff_in: three endpoint lines — stacked at y 760 / 820 / 880, left-aligned at x 640, opacity 1, still
- handoff_out: three tool cards — in a horizontal row centered at y 460, centers x 560 / 960 / 1360, scale 1, opacity 1, still

Adapt: keep the receipt cascade whose rows CHECK OFF; the "work" is the endpoint lines becoming named tools, no loaders.
Scene 1 (0.0–1.4s): the three endpoint lines (handoff) lift and travel up into a horizontal row of three cards (`scale-swap-transition` from line to card), each card titled in mono: `search_stories`, `list_orders`, `get_order`, with a small grey "checking…" badge — Triptych, ~60% of frame.
Scene 2 (1.4–2.8s): the badges flip one by one, left to right, to a teal check + "verified" (`press-release-spring`, smooth register; one per cue).
Scene 3 (2.8–4.0s): the line "real tools. verified live." reveals above the row (`dynamic-content-sequencing`); hold still.

narrativeRole: Evidence for the promise: the API becomes named, verified tools, not raw traffic.
keyMessage: You get tools that are already proven to work.

## Frame 4 — Plugged into the agent

- scene: The three tool cards fly into a ring around an agent node labeled MCP; connectors light up and the agent pulses once
- onscreen: "Your agent can use it now."
- voiceover: ""
- duration: 3.5s
- poster: 2.9s
- transition_in: cut
- status: animated
- src: compositions/frames/04-agent.html
- type: benefit_highlight
- persuasion: Future pacing — the outcome the viewer wanted, shown happening
- beat: relief + power
- blueprint: constellation-hub (Adapt)
- asset_candidates:
- focal: registry block `tracing-beam` — the glowing dash that travels each connector into the agent node
- roles: agent node = cutout · tool cards = supporting · ground = background
- handoff_in: three tool cards — in a horizontal row centered at y 460, centers x 560 / 960 / 1360, scale 1, opacity 1, still

Adapt: keep nodes settling into a ring around a center and resolving onto the core; three satellites instead of a full ring, no camera push.
Scene 1 (0.0–1.0s): an agent node (a rounded hub labeled `MCP` in mono, purple rim) rises at center; the three cards (handoff) shrink and travel to a triangle around it (`center-outward-expansion`, inverted: row → ring) — Centered, ~55% of frame.
Scene 2 (1.0–2.4s): one connector per card draws toward the hub and a purple dash travels each into it in turn (`tracing-beam`), the hub brightening a step with each arrival.
Scene 3 (2.4–3.5s): the line "your agent can use it now." reveals under the hub; hold, subtle jitter at most.

narrativeRole: The payoff: the viewer's agent now has the site as tools.
keyMessage: One MCP server, and your agent can use the site.

## Frame 5 — One command

- scene: The site2api wordmark lands; under it a terminal pill types `npx site2api run <url>` and holds with a blinking caret
- onscreen: "npx site2api run <url>"
- voiceover: ""
- duration: 2.5s
- poster: 2.2s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/05-cta.html
- type: cta
- persuasion: Friction reduction — the whole thing is one command
- beat: motivation
- blueprint: prompt-type-submit-generate (Adapt — CTA variant)
- asset_candidates:
- focal: the terminal pill with the install command
- roles: wordmark = supporting · command pill = cutout · ground = background

Adapt: the install-command end card — wordmark first, then the command types into a pill and holds with a blinking caret; no headline demotion (the previous frame carries none).
Scene 1 (0.0–0.8s): the wordmark "site2api" (`display`, the "2" in purple) settles at upper-center (`spring-pop-entrance`, smooth register).
Scene 2 (0.8–2.0s): a dark terminal pill grows under it; `npx site2api run <url>` types character by character behind a teal block caret (`discrete-text-sequence` + `context-sensitive-cursor`).
Scene 3 (2.0–2.5s): a small mono line `github.com/flyingsquirrel0419/site2api` fades in below; hold on the blinking caret to the end — the only motion.

narrativeRole: Turns understanding into action; the final frame sits well before frame 1 so the loop is seamless.
keyMessage: It is one command away.
