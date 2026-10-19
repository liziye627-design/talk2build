/**
 * Space Cat Courier: the game-jam prototype template. This is plain, pre-written template code.
 * Talk2Build copies it into the meeting workspace when the room says yes to the scaffold.
 * No backticks or template placeholders in here: the text is embedded verbatim in index.html.
 */
export const GAME_LOGIC = String.raw`// Space Cat Courier - game logic (template scaffolded by Talk2Build)
export const W = 960;
export const H = 540;
export const CAT_X = 170;
export const MAX_FUEL = 100;
export const FUEL_DRAIN = 6.5;
export const FUEL_PER_PARCEL = 14;

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s % 1000000) / 1000000;
  };
}

export function speedFor(parcels) {
  return 250 + Math.floor(parcels / 10) * 70;
}

export function createGame(seed) {
  return {
    seed: seed || 7,
    rand: rng(seed || 7),
    t: 0,
    started: false,
    over: false,
    reason: "",
    cat: { x: CAT_X, y: H / 2, vy: 0, r: 26 },
    fuel: MAX_FUEL,
    parcels: 0,
    best: 0,
    speed: speedFor(0),
    spawnIn: 0.8,
    items: [],
    events: [],
  };
}

export function start(game) {
  const best = game.best;
  const fresh = createGame(game.seed + 1);
  fresh.best = best;
  fresh.started = true;
  return fresh;
}

export function hit(a, b, slack) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const reach = a.r + b.r - (slack || 0);
  return dx * dx + dy * dy < reach * reach;
}

function spawn(game) {
  const rand = game.rand;
  const pizza = rand() < 0.46;
  const y = 70 + rand() * (H - 140);
  game.items.push(pizza
    ? { kind: "pizza", x: W + 40, y: y, r: 20, spin: rand() * 6 }
    : { kind: "rock", x: W + 50, y: y, r: 20 + rand() * 18, spin: rand() * 6, shape: Math.floor(rand() * 1000) });
  game.spawnIn = Math.max(0.32, 0.62 - game.parcels * 0.012) * (0.75 + rand() * 0.5);
}

export function step(game, dt, input) {
  game.events = [];
  if (!game.started || game.over) return game;
  game.t += dt;
  const target = input && input.up ? -380 : input && input.down ? 380 : 0;
  game.cat.vy += (target - game.cat.vy) * Math.min(1, dt * 9);
  game.cat.y = Math.max(42, Math.min(H - 42, game.cat.y + game.cat.vy * dt));
  game.fuel = Math.max(0, game.fuel - FUEL_DRAIN * dt);
  game.speed = speedFor(game.parcels);
  game.spawnIn -= dt;
  if (game.spawnIn <= 0) spawn(game);
  const kept = [];
  for (const item of game.items) {
    item.x -= game.speed * (item.kind === "rock" ? 1.12 : 1) * dt;
    item.spin += dt * (item.kind === "rock" ? 1.4 : 2.2);
    if (item.kind === "pizza" && hit(game.cat, item, 0)) {
      game.parcels += 1;
      game.fuel = Math.min(MAX_FUEL, game.fuel + FUEL_PER_PARCEL);
      game.events.push({ type: "parcel", x: item.x, y: item.y });
      if (game.parcels % 10 === 0) game.events.push({ type: "faster", x: item.x, y: item.y });
      continue;
    }
    if (item.kind === "rock" && hit(game.cat, item, 10)) {
      game.over = true;
      game.reason = "Asteroid!";
      game.events.push({ type: "crash", x: game.cat.x, y: game.cat.y });
    }
    if (item.x > -80) kept.push(item);
  }
  game.items = kept;
  if (!game.over && game.fuel <= 0) {
    game.over = true;
    game.reason = "Out of fuel!";
    game.events.push({ type: "crash", x: game.cat.x, y: game.cat.y });
  }
  if (game.parcels > game.best) game.best = game.parcels;
  return game;
}
`;

export const GAME_TESTS = String.raw`import test from "node:test";
import assert from "node:assert/strict";
import { createGame, start, step, speedFor, H, MAX_FUEL } from "../game/logic.mjs";

function running(seed) {
  return start(createGame(seed || 3));
}

test("fuel drains while the cat flies", () => {
  const game = running();
  game.spawnIn = 99;
  step(game, 1, {});
  assert.ok(game.fuel < MAX_FUEL);
});

test("a pizza parcel scores and refuels", () => {
  const game = running();
  game.spawnIn = 99;
  game.fuel = 50;
  game.items.push({ kind: "pizza", x: game.cat.x, y: game.cat.y, r: 20, spin: 0 });
  step(game, 0.016, {});
  assert.equal(game.parcels, 1);
  assert.ok(game.fuel > 50);
});

test("an asteroid ends the run", () => {
  const game = running();
  game.spawnIn = 99;
  game.items.push({ kind: "rock", x: game.cat.x, y: game.cat.y, r: 30, spin: 0, shape: 1 });
  step(game, 0.016, {});
  assert.equal(game.over, true);
  assert.equal(game.reason, "Asteroid!");
});

test("running out of fuel ends the run", () => {
  const game = running();
  game.spawnIn = 99;
  game.fuel = 0.01;
  step(game, 0.5, {});
  assert.equal(game.over, true);
  assert.equal(game.reason, "Out of fuel!");
});

test("asteroids get faster every ten parcels", () => {
  assert.equal(speedFor(9), speedFor(0));
  assert.ok(speedFor(10) > speedFor(9));
  assert.ok(speedFor(20) > speedFor(10));
});

test("the cat stays on screen", () => {
  const game = running();
  game.spawnIn = 99;
  for (let i = 0; i < 200; i += 1) step(game, 0.016, { up: true });
  assert.ok(game.cat.y >= 0);
  for (let i = 0; i < 400; i += 1) step(game, 0.016, { down: true });
  assert.ok(game.cat.y <= H);
});

test("the same seed lays out the same level", () => {
  const a = running(11);
  const b = running(11);
  for (let i = 0; i < 120; i += 1) {
    step(a, 0.016, {});
    step(b, 0.016, {});
  }
  assert.deepEqual(a.items.map((item) => [item.kind, Math.round(item.y)]), b.items.map((item) => [item.kind, Math.round(item.y)]));
});
`;
