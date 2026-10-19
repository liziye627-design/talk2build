import { chromium } from 'playwright';
import fs from 'fs';
import { playBot } from './bot.mjs';
const dur = JSON.parse(fs.readFileSync('aud/dur.json'));
// Minimum scene lengths (seconds). Scene length = max(min, narration + PAD).
const MIN = { s01_hook: 12, s02_goal: 11, s03_design: 13, s04_evidence: 18, s05_pizza: 6.5, s06_phone: 7.5, s07_yes: 19, s08_play: 22, s09_pizza: 6, s10_end: 9 };
const PAD = 1.4;
fs.rmSync('vid', { recursive: true, force: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: 'vid', size: { width: 1920, height: 1080 } } });
const p = await ctx.newPage();
const T0 = Date.now();
const marks = {};
const W = (ms) => p.waitForTimeout(ms);
let mid;
const say = (text, speaker) => p.evaluate(async ([id, text, speaker]) => {
  const r = await fetch(`/api/meetings/${id}/utterance`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, speaker }) });
  const j = await r.json(); return { status: r.status, reply: j.reply };
}, [mid, text, speaker]).then((r) => { console.log(speaker, '|', text, '=>', r.status, r.reply); return r; });
const meeting = () => p.evaluate(async (id) => (await (await fetch(`/api/meetings/${id}`)).json()).meeting, mid);
async function until(fn, ms = 10000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn(await meeting())) return true; await W(250); } console.log('until: timeout'); return false; }

// Camera: CSS transform on <body>, so zoomed text is re-rendered sharp instead of upscaled.
await p.addInitScript(() => {
  window.__cam = { x: 0, y: 0, s: 1 };
  window.__setCam = (x, y, w, ms) => {
    const b = document.body; const s = 1920 / w;
    document.documentElement.style.overflow = 'hidden'; document.documentElement.style.background = '#1c1c1c';
    b.style.transformOrigin = '0 0'; b.style.transition = `transform ${ms}ms cubic-bezier(.45,0,.2,1)`;
    b.style.transform = s === 1 ? 'none' : `translate(${-x * s}px, ${-y * s}px) scale(${s})`;
    window.__cam = { x, y, s };
  };
  window.__rect = (sel) => {
    const e = document.querySelector(sel); if (!e) return null;
    const r = e.getBoundingClientRect(); const c = window.__cam;
    return { x: r.left / c.s + c.x, y: r.top / c.s + c.y, w: r.width / c.s, h: r.height / c.s };
  };
});
async function cam(target, ms = 1000, minW = 560) {
  let r = target;
  if (typeof target === 'string') r = await p.evaluate((s) => window.__rect(s), target);
  if (!r) { console.log('cam: missing', target); return; }
  let w = Math.max(r.w, r.h * 16 / 9, minW); let h = w * 9 / 16;
  w = Math.min(w, 1920); h = Math.min(h, 1080);
  let x = r.x + r.w / 2 - w / 2; let y = r.y + r.h / 2 - h / 2;
  x = Math.max(0, Math.min(1920 - w, x)); y = Math.max(0, Math.min(1080 - h, y));
  await p.evaluate(([x, y, w, ms]) => window.__setCam(x, y, w, ms), [x, y, w, ms]);
}
const full = (ms = 900) => cam({ x: 0, y: 0, w: 1920, h: 1080 }, ms);
// Panel crop: the right-hand panel plus a little of the tiles, top `y` of the visible panel.
const panelAt = (y, w = 860) => cam({ x: 1920 - w, y, w, h: w * 9 / 16 });
async function scrollPanelTo(sel, block = 'start') {
  await p.evaluate(([sel, block]) => { const e = document.querySelector(sel); e && e.scrollIntoView({ behavior: 'smooth', block }); }, [sel, block]);
  await W(700);
}
async function panelCard(title) {
  return p.evaluate((title) => {
    const cards = [...document.querySelectorAll('[data-testid=workstream]')];
    const c = cards.find((e) => e.querySelector('h3')?.textContent?.trim() === title);
    if (!c) return null; c.id = 'cam-target'; return true;
  }, title);
}
async function scene(name, fn) {
  const s = Date.now(); marks[name] = (s - T0) / 1000;
  await fn();
  const len = Math.max(MIN[name] || 0, dur[name] + PAD) * 1000;
  const left = len - (Date.now() - s); if (left > 0) await W(left);
}

await p.goto('http://localhost:43123/'); await p.waitForLoadState('networkidle'); await W(1200);
await scene('s01_hook', async () => {
  await W(1500); await p.hover('[data-testid=start-meeting]'); await W(1800);
  await p.click('[data-testid=start-meeting]'); await p.waitForURL(/meetings\//); mid = p.url().split('/').pop();
  await p.mouse.move(1900, 600); await W(2500);
});
await scene('s02_goal', async () => {
  await say("Goal for this meeting: build Space Cat Courier, a tiny browser game, before the pizza gets here. Milestone is one playable level, then a high score.", 'Maya');
  await W(1200); await panelAt(40);
});
await scene('s03_design', async () => {
  await cam('[data-testid=video-grid]');
  await say("Let's sketch the architecture. A game loop, keyboard and touch input, and a canvas renderer. Asteroids get faster every ten parcels.", 'Chris');
  await until((m) => m.workstreams.some((w) => w.title === 'Game architecture' && w.status === 'ready'), 8000);
  await W(1500);
  await say("Can you wireframe the game screen? The cat on the left, a fuel bar and the parcel count up top.", 'Priya');
  await until((m) => m.workstreams.some((w) => w.title === 'Game screen wireframe' && w.status === 'ready'), 8000);
});
await scene('s04_evidence', async () => {
  await full();
  await say('Phaser or PixiJS, which is more popular?', 'Chris');
  await until((m) => m.workstreams.some((w) => w.kind === 'evidence' && w.status === 'ready'), 12000);
  await W(400);
  await p.waitForSelector('[data-testid=evidence-table]', { timeout: 8000 }).catch(() => console.log('cam: evidence table never rendered'));
  await p.evaluate(() => { const t = document.querySelector('[data-testid=evidence-table]'); const c = t && (t.closest('article') || t.parentElement); if (c) { c.id = 'cam-target'; c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  await W(900);
  { const r = await p.evaluate(() => window.__rect('#cam-target')); if (r) await cam({ x: r.x, y: r.y - 12, w: r.w, h: 380 }, 900, 760); else console.log('cam: no evidence card'); }
  await W(5200);
  await p.evaluate(() => { const e = document.querySelector('[data-testid=evidence-chart]'); e && e.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  await W(900);
  await cam('[data-testid=evidence-chart]', 800, 820);
  await W(2600);
  await full(700);
  await say("Nice. But for one level we'll code it in plain canvas. Zero dependencies.", 'Maya');
});
await scene('s05_pizza', async () => {
  await say("Is the pizza here yet? I'm starving.", 'Priya');
  await W(600);
  await scrollPanelTo('[data-testid=agent-panel] > div', 'start');
  await p.evaluate(() => { const e = document.querySelector('[data-testid=agent-panel]'); e && e.scrollTo({ top: 0, behavior: 'smooth' }); });
  await W(500); await panelAt(40);
});
await scene('s06_phone', async () => {
  await say("Before we build it, check that it's feasible on a phone.", 'Maya');
  await until((m) => m.workstreams.some((w) => w.kind === 'verify' && w.status === 'ready'), 8000);
  await panelCard('Feasibility'); await scrollPanelTo('#cam-target', 'center');
});
await scene('s07_yes', async () => {
  await say('Turn our decisions into a spec, scaffold the prototype, and run the tests.', 'Chris');
  await W(800);
  await p.evaluate(() => { const e = document.querySelector('[data-testid=confirm-wait]'); e && e.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  await W(4200);
  await say('Yes', 'Maya');
  await W(1200);
  await panelCard('Space Cat Courier prototype'); await scrollPanelTo('#cam-target', 'center');
  await W(4000);
  await full(900);
});
await scene('s08_play', async () => {
  await cam('[data-testid=shared-stage]', 900); await W(1200);
  const frame = p.frames().find((f) => f.url().includes('game%2Findex.html') || f.url().includes('game/index.html'));
  await p.frameLocator('[data-testid=shared-prototype]').locator('canvas').click(); await W(200);
  globalThis.__bot = playBot(p, frame, (MIN.s08_play + MIN.s09_pizza) * 1000 - 2500);
});
await scene('s09_pizza', async () => {
  await cam('[data-testid=video-grid]', 700);
  await say("Pizza's here!", 'Priya');
});
await globalThis.__bot;
await scene('s10_end', async () => {
  await full(700);
  await p.click('[data-testid=end-meeting]'); await W(1500);
  await panelAt(40, 900);
});
marks.__end = (Date.now() - T0) / 1000;
fs.writeFileSync('marks.json', JSON.stringify(marks, null, 1));
const g = p.frames().find((f) => f.url().includes('game'));
console.log('game', g ? await g.evaluate(() => { const s = window.__game(); return { parcels: s.parcels, over: s.over, reason: s.reason }; }).catch((e) => String(e)) : 'none');
await ctx.close(); await b.close(); console.log(marks, mid);
