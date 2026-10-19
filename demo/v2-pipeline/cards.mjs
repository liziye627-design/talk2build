import { chromium } from "playwright";
const base = `*{margin:0;box-sizing:border-box}body{width:1920px;height:1080px;background:radial-gradient(ellipse at 30% 20%,#1f2a52,#0b0f1e 70%);color:#eef2ff;font-family:Inter,"DejaVu Sans",sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
.k{font-size:30px;letter-spacing:6px;color:#8fa4ff;text-transform:uppercase}.t{font-size:120px;font-weight:800;margin:24px 0}.s{font-size:44px;color:#c7d0f5}.n{position:absolute;bottom:60px;font-size:26px;color:#7d88b3}
.row{display:flex;gap:28px;align-items:center;margin:60px 0 30px}.box{background:#18213f;border:2px solid #3a4a8a;border-radius:22px;padding:30px 36px;font-size:36px;font-weight:700;min-width:270px}.box small{display:block;font-size:22px;font-weight:400;color:#9aa6d6;margin-top:10px}.ar{font-size:50px;color:#8fa4ff}`;
const cards = {
 title: `<div class=k>Talk2Build · demo v2</div><div class=t>The meeting that ships 🍕</div><div class=s>Pizza Game Jam: three friends, one prototype</div><div class=n>Demo mode · recorded fixtures · no live model calls · the game comes from a pre-written template</div>`,
 how: `<div class=k>Under the hood</div><div class=row><div class=box>Alexa+<small>voice in the meeting</small></div><div class=ar>→</div><div class=box>MCP server<small>self-hosted · Streamable HTTP<br>spec 2025-11-25</small></div><div class=ar>→</div><div class=box>Tools<small>plan · design · evidence<br>scaffold · run_tests</small></div><div class=ar>→</div><div class=box>Workspace<small>spec.md · SVGs · game/</small></div></div><div class=s style="font-size:34px;max-width:1500px">This demo: mock mode, recorded fixtures. Evidence numbers are fetched live from GitHub and npm.</div>`,
 end: `<div class=t>Talk2Build</div><div class=s>Open source · github.com/liziye627-design/talk2build</div><div class=n>Spec written from the meeting's decisions · prototype scaffolded from a game-jam template, not generated live</div>`,
};
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [k, h] of Object.entries(cards)) { await p.setContent(`<style>${base}</style>${h}`); await p.screenshot({ path: `cards/${k}.png` }); }
await b.close();
