import { GAME_LOGIC } from "@/lib/agent/game-jam/logic";

/** Canvas renderer and input for the Space Cat Courier template. Embedded verbatim; no backticks inside. */
const RENDERER = String.raw`
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const keys = { up: false, down: false };
let game = createGame(7);
try { game.best = Number(localStorage.getItem("scc-best") || 0); } catch (e) {}
const stars = [];
const starRand = rng(99);
for (let i = 0; i < 140; i += 1) stars.push({ x: starRand() * W, y: starRand() * H, z: 0.2 + starRand() * 0.8 });
const particles = [];
const floaters = [];
let shake = 0;
let banner = 0;
window.__game = function () { return game; };

function press(code, down) {
  if (code === "ArrowUp" || code === "KeyW") keys.up = down;
  if (code === "ArrowDown" || code === "KeyS") keys.down = down;
  if (down && (code === "Space" || code === "Enter") && (!game.started || game.over)) game = start(game);
}
addEventListener("keydown", function (e) { press(e.code, true); if (e.code.indexOf("Arrow") === 0 || e.code === "Space") e.preventDefault(); });
addEventListener("keyup", function (e) { press(e.code, false); });
canvas.addEventListener("pointerdown", function (e) {
  if (!game.started || game.over) { game = start(game); return; }
  const rect = canvas.getBoundingClientRect();
  const y = (e.clientY - rect.top) / rect.height * H;
  keys.up = y < game.cat.y; keys.down = y >= game.cat.y;
});
addEventListener("pointerup", function () { keys.up = false; keys.down = false; });

function burst(x, y, color, n) {
  for (let i = 0; i < n; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const v = 60 + Math.random() * 220;
    particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.5, color: color });
  }
}

function drawBackground(t) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0b0630");
  g.addColorStop(1, "#1d0b3d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const px = W - ((t * 12) % (W + 400)) + 200;
  const pg = ctx.createRadialGradient(px - 30, 120, 10, px, 140, 110);
  pg.addColorStop(0, "#ff9f6e");
  pg.addColorStop(1, "#7a2d6b");
  ctx.fillStyle = pg;
  ctx.beginPath(); ctx.arc(px, 140, 90, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,210,170,0.55)"; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.ellipse(px, 140, 150, 26, -0.25, 0, Math.PI * 2); ctx.stroke();
  for (const s of stars) {
    const x = (s.x - t * 60 * s.z * (game.speed / 250) + W * 10) % W;
    ctx.fillStyle = "rgba(255,255,255," + (0.35 + s.z * 0.65) + ")";
    ctx.fillRect(x, s.y, 1 + s.z * 2, 1 + s.z * 2);
  }
}

function drawCat(c, t) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(Math.max(-0.35, Math.min(0.35, c.vy / 900)));
  const flick = 18 + Math.sin(t * 40) * 6;
  const fg = ctx.createLinearGradient(-60, 0, -30, 0);
  fg.addColorStop(0, "rgba(255,80,0,0)");
  fg.addColorStop(1, "#ffd23f");
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.moveTo(-30, 2); ctx.lineTo(-30 - flick - 20, 10); ctx.lineTo(-30, 18); ctx.fill();
  ctx.fillStyle = "#8d99ae"; ctx.fillRect(-34, -4, 16, 26);
  ctx.fillStyle = "#c97b2a"; ctx.fillRect(-24, -16, 22, 18);
  ctx.strokeStyle = "#6b3e12"; ctx.lineWidth = 2; ctx.strokeRect(-24, -16, 22, 18);
  ctx.strokeStyle = "#f4a259"; ctx.lineWidth = 6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-14, 18); ctx.quadraticCurveTo(-40, 30 + Math.sin(t * 6) * 8, -46, 14); ctx.stroke();
  ctx.fillStyle = "#f4a259";
  ctx.beginPath(); ctx.ellipse(0, 10, 22, 16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(14, -10, 17, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(2, -20); ctx.lineTo(4, -38); ctx.lineTo(14, -25); ctx.fill();
  ctx.beginPath(); ctx.moveTo(18, -26); ctx.lineTo(28, -38); ctx.lineTo(30, -20); ctx.fill();
  ctx.fillStyle = "#1b1b1b";
  ctx.beginPath(); ctx.arc(10, -12, 2.6, 0, Math.PI * 2); ctx.arc(22, -12, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ff7aa2"; ctx.beginPath(); ctx.arc(17, -6, 2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(180,230,255,0.9)"; ctx.lineWidth = 2.5;
  ctx.fillStyle = "rgba(160,220,255,0.18)";
  ctx.beginPath(); ctx.arc(15, -12, 25, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.beginPath(); ctx.ellipse(6, -24, 6, 3, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawPizza(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.sin(p.spin) * 0.5);
  ctx.shadowColor = "#ffcf5a"; ctx.shadowBlur = 18;
  ctx.fillStyle = "#ffcf5a";
  ctx.beginPath(); ctx.moveTo(0, 22); ctx.lineTo(-20, -14); ctx.quadraticCurveTo(0, -26, 20, -14); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#c8792b";
  ctx.beginPath(); ctx.moveTo(-20, -14); ctx.quadraticCurveTo(0, -26, 20, -14); ctx.lineTo(18, -9); ctx.quadraticCurveTo(0, -20, -18, -9); ctx.fill();
  ctx.fillStyle = "#d62828";
  ctx.beginPath(); ctx.arc(-6, -4, 4, 0, Math.PI * 2); ctx.arc(6, -2, 4, 0, Math.PI * 2); ctx.arc(0, 9, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawRock(r) {
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.rotate(r.spin);
  const rand = rng(r.shape + 1);
  ctx.fillStyle = "#6c5f5b"; ctx.strokeStyle = "#3d3533"; ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 9; i += 1) {
    const a = i / 9 * Math.PI * 2;
    const rr = r.r * (0.78 + rand() * 0.3);
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#4f4441";
  ctx.beginPath(); ctx.arc(-r.r * 0.3, -r.r * 0.2, r.r * 0.2, 0, Math.PI * 2); ctx.arc(r.r * 0.25, r.r * 0.3, r.r * 0.14, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawHud() {
  ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(0, 0, W, 52);
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 18px system-ui, sans-serif"; ctx.textBaseline = "middle";
  ctx.fillText("SPACE CAT COURIER", 18, 26);
  ctx.fillStyle = "#c9c3ff"; ctx.font = "14px system-ui, sans-serif"; ctx.fillText("FUEL", 250, 26);
  ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(294, 17, 220, 18);
  const f = game.fuel / MAX_FUEL;
  ctx.fillStyle = f > 0.5 ? "#3ddc97" : f > 0.25 ? "#ffcf5a" : "#ff4d6d";
  ctx.fillRect(294, 17, 220 * f, 18);
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 18px system-ui, sans-serif";
  drawPizza({ x: 566, y: 28, spin: 0 });
  ctx.fillStyle = "#ffffff"; ctx.fillText("x " + game.parcels, 592, 26);
  ctx.fillStyle = "#c9c3ff"; ctx.font = "14px system-ui, sans-serif";
  ctx.fillText("BEST " + game.best + "   SPEED " + Math.round(game.speed), 690, 26);
}

function centerText(lines) {
  ctx.fillStyle = "rgba(5,2,20,0.55)"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  for (const line of lines) {
    ctx.fillStyle = line.color || "#ffffff";
    ctx.font = line.font;
    ctx.fillText(line.text, W / 2, line.y);
  }
  ctx.textAlign = "left";
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  step(game, dt, keys);
  for (const ev of game.events) {
    if (ev.type === "parcel") { burst(ev.x, ev.y, "#ffcf5a", 14); floaters.push({ x: ev.x, y: ev.y, life: 0.9, text: "+1 delivered" }); }
    if (ev.type === "faster") banner = 1.6;
    if (ev.type === "crash") { burst(ev.x, ev.y, "#ff7a3d", 40); shake = 0.45; try { localStorage.setItem("scc-best", String(game.best)); } catch (e) {} }
  }
  ctx.save();
  if (shake > 0) { shake -= dt; ctx.translate((Math.random() - 0.5) * 16 * shake / 0.45, (Math.random() - 0.5) * 16 * shake / 0.45); }
  drawBackground(t);
  for (const item of game.items) item.kind === "pizza" ? drawPizza(item) : drawRock(item);
  if (!game.over || shake > 0.2) drawCat(game.cat, t);
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, p.life * 2); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 4, 4); ctx.globalAlpha = 1;
  }
  for (let i = floaters.length - 1; i >= 0; i -= 1) {
    const f = floaters[i];
    f.life -= dt; f.y -= 50 * dt;
    if (f.life <= 0) { floaters.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, f.life * 2); ctx.fillStyle = "#ffe8a3"; ctx.font = "bold 16px system-ui, sans-serif"; ctx.fillText(f.text, f.x - 20, f.y); ctx.globalAlpha = 1;
  }
  ctx.restore();
  drawHud();
  if (banner > 0) {
    banner -= dt;
    ctx.globalAlpha = Math.min(1, banner);
    ctx.textAlign = "center"; ctx.fillStyle = "#ff8fab"; ctx.font = "bold 34px system-ui, sans-serif";
    ctx.fillText("ASTEROIDS SPEED UP!", W / 2, 110); ctx.textAlign = "left"; ctx.globalAlpha = 1;
  }
  if (!game.started) {
    centerText([
      { text: "SPACE CAT COURIER", y: 200, font: "bold 56px system-ui, sans-serif", color: "#ffcf5a" },
      { text: "Deliver the pizza. Dodge the asteroids. Watch the fuel.", y: 262, font: "22px system-ui, sans-serif" },
      { text: "Press Space to launch  ·  Up/Down or W/S  ·  tap above or below the cat", y: 312, font: "18px system-ui, sans-serif", color: "#c9c3ff" },
    ]);
  } else if (game.over && shake <= 0) {
    centerText([
      { text: game.reason, y: 210, font: "bold 52px system-ui, sans-serif", color: "#ff8fab" },
      { text: "Parcels delivered: " + game.parcels + "   ·   Best: " + game.best, y: 268, font: "24px system-ui, sans-serif" },
      { text: "Press Space to fly again", y: 316, font: "18px system-ui, sans-serif", color: "#c9c3ff" },
    ]);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
`;

/** The playable page: logic inlined (exports stripped) plus the renderer. */
export function gamePage(spec: { title: string; footer: string }) {
  const logic = GAME_LOGIC.replace(/^export /gm, "");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(spec.title)}</title>`,
    "<style>html,body{margin:0;height:100%;background:#05020f;color:#c9c3ff;font-family:system-ui,sans-serif}",
    "body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}",
    "canvas{width:min(100vw,calc((100vh - 40px)*16/9));aspect-ratio:16/9;border-radius:12px;box-shadow:0 0 60px rgba(120,80,255,.35);touch-action:none}",
    "p{margin:0;font-size:12px;opacity:.75}</style>",
    "</head>",
    "<body>",
    '<canvas id="game" width="960" height="540" tabindex="0"></canvas>',
    `<p>${escapeHtml(spec.footer)}</p>`,
    "<script>",
    logic,
    RENDERER,
    "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}
