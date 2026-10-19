// Plays Space Cat Courier with real keyboard events. Each tick it reads the game state and picks the
// height that avoids predicted asteroid hits and reaches the most pizza, then holds Up or Down.
export async function playBot(page, frame, ms, { restart = true } = {}) {
  const end = Date.now() + ms;
  let held = null;
  const hold = async (key) => {
    if (held === key) return;
    if (held) await page.keyboard.up(held);
    held = key;
    if (key) await page.keyboard.down(key);
  };
  while (Date.now() < end) {
    const s = await frame.evaluate(() => {
      const g = window.__game();
      return { started: g.started, over: g.over, y: g.cat.y, vy: g.cat.vy, x: g.cat.x, speed: g.speed, items: g.items.map((i) => ({ k: i.kind, x: i.x, y: i.y, r: i.r })) };
    });
    if (!s.started || s.over) {
      await hold(null);
      if (s.over && restart) { await page.waitForTimeout(1600); await page.keyboard.press('Space'); }
      await page.waitForTimeout(200);
      continue;
    }
    const lat = 0.09;
    const predict = (target, t) => { const d = target - s.y; const move = 360 * Math.max(0, t - lat); return Math.abs(d) <= move ? target : s.y + Math.sign(d) * move; };
    let best = s.y, bestScore = -Infinity;
    for (let target = 50; target <= 490; target += 15) {
      let score = -Math.abs(target - 270) * 0.01 - Math.abs(target - s.y) * 0.002;
      for (const it of s.items) {
        const v = s.speed * (it.k === 'rock' ? 1.12 : 1);
        const t = (it.x - s.x) / v;
        if (t < -0.15 || t > 1.6) continue;
        for (const dt of [-0.08, 0, 0.08]) {
          const y = predict(target, Math.max(0, t + dt));
          const gap = Math.abs(y - it.y);
          if (it.k === 'rock') { if (gap < it.r + 26 - 10 + 22) score -= 1000 * (1.7 - Math.min(t, 1.6)); }
          else if (dt === 0 && gap < 36) score += 40 * (1.7 - t);
        }
      }
      if (score > bestScore) { bestScore = score; best = target; }
    }
    const d = best - s.y;
    await hold(Math.abs(d) < 8 ? null : d < 0 ? 'ArrowUp' : 'ArrowDown');
    await page.waitForTimeout(25);
  }
  await hold(null);
}
