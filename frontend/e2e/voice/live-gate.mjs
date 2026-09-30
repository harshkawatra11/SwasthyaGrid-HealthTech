// Live gate for lane E. Servers are started manually (run book); this script only drives them.
// Usage: node e2e/voice/live-gate.mjs [baseUrl] [--headed]
// Needs a built frontend started with NEXT_PUBLIC_API_BASE and NEXT_PUBLIC_VOICE_WS_URL pointing at a live backend.
// Uses a fake microphone device. It cannot hear audio: it proves frames reach the playback queue.
import { chromium } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";

const base = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "http://127.0.0.1:3004";
const headed = process.argv.includes("--headed");
const outDir = path.resolve(process.cwd(), "..", "docs", "v2-shots");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: !headed,
  args: [...(process.argv.includes("--gpu") ? ["--enable-gpu", "--ignore-gpu-blocklist"] : []), "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
await ctx.addInitScript(() => {
  window.__ws = { frames: [], sent: [] };
  const Native = window.WebSocket;
  window.WebSocket = function (...args) {
    const ws = new Native(...args);
    ws.addEventListener("message", (ev) => {
      try {
        const f = JSON.parse(ev.data);
        window.__ws.frames.push({ t: f.t, turnId: f.turnId, encoding: f.encoding, filler: f.filler, cards: f.cards ? f.cards.map((c) => c.type) : undefined, at: performance.now() });
      } catch {}
    });
    return ws;
  };
  window.WebSocket.prototype = Native.prototype;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  // Track every scheduled and stopped audio source (proves frames reach the playback queue).
  window.__audio = { started: 0, stops: [] };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    window.__audio.started += 1;
    return start.apply(this, a);
  };
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (...a) {
    window.__audio.stops.push(performance.now());
    return stop.apply(this, a);
  };
});
const page = await ctx.newPage();
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error" && !/net::ERR/.test(m.text())) problems.push(m.text().slice(0, 200));
});
const result = {};

await page.goto(`${base}/voice`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Start voice session" }).click();
await page.waitForFunction(() => document.querySelector('[data-testid="connection-chip"]')?.textContent?.includes("Live"), null, { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('[data-testid="orb-stage"]')?.getAttribute("data-mode") === "glass", null, { timeout: 15000 }).catch(() => {});
result.mode = await page.getAttribute('[data-testid="orb-stage"]', "data-mode");
result.hardwareConcurrency = await page.evaluate(() => navigator.hardwareConcurrency);

const fps = (ms) =>
  page.evaluate(
    (dur) =>
      new Promise((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n += 1;
          if (performance.now() - t0 < dur) requestAnimationFrame(tick);
          else resolve((n * 1000) / (performance.now() - t0));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
const phase = () => page.getAttribute('[data-testid="orb-stage"]', "data-phase");
async function waitPhase(p, timeout = 30000) {
  await page.waitForFunction((want) => document.querySelector('[data-testid="orb-stage"]')?.getAttribute("data-phase") === want, p, { timeout });
}

if (process.argv.includes("--fps-only")) {
  await waitPhase("speaking");
  await page.waitForTimeout(500);
  result.fpsSpeakingGreeting = await fps(1500);
  await waitPhase("listening");
  await page.waitForTimeout(1000);
  result.fpsListening = await fps(6000);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
}
// Greeting is spoken: capture the speaking screenshot, then the listening one.
await waitPhase("speaking");
await page.waitForTimeout(700);
result.fpsSpeakingGreeting = await fps(1500);
await page.screenshot({ path: path.join(outDir, "e-orb-speaking.png") });
result.speakingShot = "docs/v2-shots/e-orb-speaking.png";
await waitPhase("listening");
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(outDir, "e-orb-listening.png") });
result.listeningShot = "docs/v2-shots/e-orb-listening.png";

async function ask(text, label) {
  const cardsBefore = await page.locator('[data-testid="fact-card"]').count();
  const audioBefore = await page.evaluate(() => window.__ws.frames.filter((f) => f.t === "audio").length);
  await page.getByLabel("Type a question").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => window.__ws.frames.some((f) => f.t === "turn_end" && f.at > (window.__mark ?? 0)), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const fs = window.__ws.frames;
    return {
      frameTypes: [...new Set(fs.map((f) => f.t))],
      audio: fs.filter((f) => f.t === "audio").map((f) => f.encoding + (f.filler ? ":filler" : "")),
      replyCards: fs.filter((f) => f.t === "reply").map((f) => f.cards),
      toolNames: fs.filter((f) => f.t === "tool").length,
      started: window.__audio.started,
    };
  });
  const cardsAfter = await page.locator('[data-testid="fact-card"]').count();
  const enc = {};
  for (const a of r.audio) enc[a] = (enc[a] ?? 0) + 1;
  result[label] = { cardsRendered: cardsAfter - cardsBefore, audioFramesThisTurn: r.audio.length - audioBefore, audioEncodings: enc, replyCards: r.replyCards, toolFramesTotal: r.toolNames, sourcesScheduledTotal: r.started };
  await page.evaluate(() => { window.__mark = performance.now(); });
}
await page.evaluate(() => { window.__mark = performance.now(); });
await ask("How is Kota district doing right now?", "english");
await waitPhase("listening", 60000).catch(() => {});
await ask("बीकानेर में कौन सी दवाइयाँ खत्म होने वाली हैं?", "hindi");
await page.screenshot({ path: path.join(outDir, "e-voice-page.png"), fullPage: true });

// Stop latency: interrupt while speaking. JS time from the click to the last AudioBufferSourceNode.stop.
result.stop = "not measured";
await page.getByLabel("Type a question").fill("Which district needs attention first?");
await page.getByRole("button", { name: "Send", exact: true }).click();
try {
  await waitPhase("speaking", 60000);
  await page.waitForTimeout(800);
  result.stop = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Stop answer"]');
    const before = window.__audio.stops.length;
    const t0 = performance.now();
    btn.click();
    const t1 = performance.now();
    const stops = window.__audio.stops.slice(before);
    return { stopCalls: stops.length, clickToLastStopMs: stops.length ? Math.max(...stops) - t0 : null, handlerMs: t1 - t0 };
  });
  await page.waitForTimeout(600);
  result.phaseAfterStop = await phase();
} catch (e) {
  result.stop = { error: String(e).slice(0, 200) };
}

// FPS on the Voice page: rAF counter for 6 s while listening.
await waitPhase("listening", 30000).catch(() => {});
result.fpsListening = await fps(6000);

result.consoleProblems = problems;
console.log(JSON.stringify(result, null, 2));
await browser.close();
