// Renders demo/video/scenes.html to docs/assets/demo.mp4 and docs/assets/demo.gif.
//   node demo/video/render.mjs        (needs Playwright's Chromium or Chrome, and ffmpeg)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = fileURLToPath(new URL(".", import.meta.url));
const assets = fileURLToPath(new URL("../../docs/assets/", import.meta.url));
const raw = mkdtempSync(join(tmpdir(), "site2api-video-"));

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: raw, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const opened = Date.now();
await page.goto(`file://${join(here, "scenes.html")}`);
await page.waitForFunction(() => document.getElementById("footage").readyState >= 3);
await page.waitForTimeout(300);
const offset = (Date.now() - opened) / 1000;
const total = await page.evaluate(() => {
  window.play();
  return window.TOTAL;
});
await page.waitForTimeout(total * 1000 + 200);
await context.close();
await browser.close();

const webm = join(raw, readdirSync(raw).find((f) => f.endsWith(".webm")));
const mp4 = join(assets, "demo.mp4");
const gif = join(assets, "demo.gif");
const ff = (...args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" });

ff("-ss", offset.toFixed(2), "-t", String(total), "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", mp4);
// The GIF is what README shows inline, so keep it light: 12 fps, 880 wide, 96 colors.
const filters = "fps=12,scale=880:-1:flags=lanczos";
ff("-i", mp4, "-vf", `${filters},split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, gif);
rmSync(raw, { recursive: true, force: true });
console.log(`wrote ${mp4} and ${gif}`);
