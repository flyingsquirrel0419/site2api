# Records docs/assets/demo-terminal.gif (the terminal-only demo; the README uses demo/video/). Run from the repo root after `pnpm build`:
#   vhs demo/demo.tape
# Needs VHS (brew install vhs) and the Cursor CLI logged in (`cursor agent`, then `cursor-agent login`).
# The agent scene uses Cursor's CLI with Grok; any MCP client that reads mcp.json works the same way.

Output docs/assets/demo-terminal.gif

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 900
Set Padding 24
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set TypingSpeed 35ms
Set PlaybackSpeed 2.5

# Setup, off camera: start the demo shop, point `site2api` at this checkout, and log in to the
# shop once (the cookie the agent's MCP server will use, from the environment).
Hide
Type `R=$PWD D=$(mktemp -d) && export SITE2API_PROFILE_DIR=$(mktemp -d) PS1='$ '` Enter
Type `(PORT=4317 node --import tsx $R/demo/shop/server.ts >/dev/null 2>&1 &) ; sleep 2` Enter
Type `site2api(){ node $R/dist/cli.js "$@"; }` Enter
Type `agent(){ ~/.local/bin/cursor-agent -p --model grok-4.7-high-fast --approve-mcps --force --output-format text "$1 Answer in English, at most 4 short lines, no tables."; }` Enter
Type `export SITE2API_COOKIE=$(curl -si -X POST localhost:4317/api/login -H 'content-type: application/json' -d '{"email":"demo@example.com","password":"demo-password"}' | grep -io 'sid=[^;]*')` Enter
Type `cd $D && cp $R/demo/shop/capture.mjs . && mkdir .cursor && clear` Enter
Sleep 2s
Show

Type "# A shop with no public API. Turn it into an MCP server:" Enter
Sleep 600ms
Type "site2api run http://localhost:4317 --script capture.mjs --name shop -o shop" Enter
Sleep 14s

Type "cp shop/mcp/mcp.json .cursor/mcp.json   # register it" Enter
Sleep 600ms
Type `agent "What's in my most recent order?"` Enter
Sleep 26s
Sleep 4s

Hide
Type `pkill -f demo/shop/server.ts; rm -rf $D $SITE2API_PROFILE_DIR` Enter
