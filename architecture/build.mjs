import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../.agents/skills/anatomy/kit/iso-kit.mjs";
import { kitScript } from "../../.agents/skills/anatomy/scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";
const WIDTH = 680;
const HEIGHT = 430;
const PLATE = { x: -148, y: -82, w: 300, d: 164, r: 9 };
const BASE_H = 13;
const FOOT_H = 5;

const DRAWER_BANK = { x: -13, y: -5, w: 63, d: 72, r: 4 };
const BED = { x: 38, y: 34, w: 112, d: 38, r: 3 };
const GATE_X = 160;
const FEED = { x: -130, y: -50, w: 59, d: 38, r: 4 };
const LOCK = { x: -59, y: -36, w: 40, d: 40, r: 4 };
const D1 = { x: -5, y: 58, w: 51, d: 35, r: 3 };
const KV = { x: 83, y: 57, w: 57, d: 36, r: 3 };
const CHUTE_Y = -53;

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -BASE_H - FOOT_H, 0),
    [DRAWER_BANK.x, DRAWER_BANK.y, 74],
    [BED.x + BED.w, BED.y, 38],
    [GATE_X + 8, 20, 55],
    [KV.x + KV.w, KV.y, 37],
  ],
  WIDTH,
  HEIGHT,
  { pad: 28, azimuth: 43 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

function screws(plan, z, inset = 4) {
  const pts = k.corners(plan, inset);
  return `${L(pts.map(([x, y]) => k.ring(x, y, 1.6, z, P, 12)).join(""), { tone: "lo" })}${D(pts.map(([x, y]) => at([x, y, z])), { size: 0.42, tone: "mid" })}`;
}

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -BASE_H - FOOT_H, BASE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
    out.push(S(k.cylinder(x, y, 7, -BASE_H - FOOT_H, 1.5, P, 24), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.2, -BASE_H - FOOT_H + 1.5, FOOT_H - 1.5, P, 24), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -BASE_H, BASE_H, P, 8, 1.7), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  out.push(screws(PLATE, 0, 11));
  const ruler = { x: -126, y: 91, w: 252, d: 6, r: 1 };
  out.push(S(k.slabOf(ruler, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(ruler.x + 3, ruler.x + ruler.w - 3, 4, 5, ruler.y + 0.8, 0.8, [2, 3.5], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  return out.join("");
}

function feedTray() {
  const out = [];
  out.push(S(k.slabOf(FEED, 0, 4, P, 4, 0.7), { tone: "mid" }));
  out.push(S(k.slabOf({ x: FEED.x, y: FEED.y, w: FEED.w, d: 4, r: 1 }, 4, 7, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf({ x: FEED.x, y: FEED.y + FEED.d - 4, w: FEED.w, d: 4, r: 1 }, 4, 7, P, 2), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(FEED, 3), 4.1, P), { tone: "faint" }));
  out.push(screws(FEED, 4, 5));
  for (const x of [-119, -108, -97, -86]) {
    out.push(S(k.cylinder(x, -31, 3.1, 6.8, 2.2, P, 20), { tone: "lo" }));
    out.push(L(k.sideArc(x, -31, 3.1, 8.2, P, 14), { tone: "faint" }));
  }
  return out.join("");
}

function normalizer() {
  const out = [];
  const plan = { x: -85, y: -48, w: 19, d: 34, r: 3 };
  out.push(S(k.slabOf(plan, 0, 13, P, 4, 0.8), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(plan, 2), 13, P), { tone: "faint" }));
  for (let i = 0; i < 8; i++) {
    const x = -82.5 + i * 2.1;
    out.push(S(k.slabOf({ x, y: -45, w: 1.2, d: 28, r: 0.5 }, 13, 7 + (i % 2), P, 1.2), { tone: "hi" }));
    out.push(D([at([x + 0.6, -44, 20])], { size: 0.35, tone: "lo" }));
  }
  const knob = [-74, -28];
  out.push(S(k.cylinder(knob[0], knob[1], 4.2, 20, 4, P, 24), { tone: "mid" }));
  out.push(L(k.ring(knob[0], knob[1], 3.5, 24, P, 24), { tone: "lo" }));
  return out.join("");
}

function exactLock() {
  const out = [];
  out.push(S(k.slabOf(LOCK, 0, 32, P, 5, 0.8), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan(LOCK, 3), 32, 4, P, 3, 0.5), { tone: "hi" }));
  out.push(L(k.planOutline(k.insetPlan(LOCK, 5), 32.1, P), { tone: "faint" }));
  out.push(screws(LOCK, 32, 5));
  for (let i = 0; i < 6; i++) {
    const x = -53 + i * 5.7;
    const h = 9 + (i % 3) * 3;
    out.push(S(k.slabOf({ x, y: -30, w: 3.2, d: 8, r: 1 }, 36, h, P, 2), { tone: "hi" }));
    out.push(D([at([x + 1.6, -25.5, 36 + h])], { size: 0.38, tone: "mid" }));
  }
  out.push(S(k.cylinder(-41, -26, 7, 36, 2.6, P, 28), { tone: "mid" }));
  out.push(L(k.ring(-41, -26, 4.5, 38.6, P, 24), { tone: "lo" }));
  return out.join("");
}

function drawerBank() {
  const out = [];
  out.push(S(k.slabOf(DRAWER_BANK, 0, 71, P, 5, 1), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(DRAWER_BANK, 3), 71, P), { tone: "faint" }));
  out.push(screws(DRAWER_BANK, 71, 5));
  const drawerHeight = 10;
  for (let i = 0; i < 5; i++) {
    const z = 4 + i * 13;
    const drawer = { x: -9, y: 0, w: 55, d: 64, r: 1.4 };
    out.push(S(k.slabOf(drawer, z, drawerHeight, P, 3, 0.45), { tone: i === 2 ? "hi" : "mid" }));
    out.push(L(k.planOutline(k.insetPlan(drawer, 2.5), z + drawerHeight + 0.1, P), { tone: "faint" }));
    const pullY = -1.5;
    out.push(S(k.slabOf({ x: 13, y: pullY, w: 4, d: 4, r: 1 }, z + drawerHeight, 2.4, P, 2), { tone: "lo", crease: "none" }));
    out.push(S(k.slabOf({ x: 21, y: pullY, w: 4, d: 4, r: 1 }, z + drawerHeight, 2.4, P, 2), { tone: "lo", crease: "none" }));
    out.push(S(k.slabOf({ x: 13, y: pullY, w: 12, d: 3, r: 1 }, z + drawerHeight + 2.4, 1.4, P, 1), { tone: "mid", crease: "none" }));
    out.push(D([at([29, 2.5, z + drawerHeight + 0.2]), at([35, 2.5, z + drawerHeight + 0.2])], { size: 0.35, tone: "lo" }));
  }
  return out.join("");
}

function comparisonBed() {
  const out = [];
  out.push(S(k.slabOf(BED, 0, 6, P, 4, 0.7), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(BED, 3), 6.1, P), { tone: "faint" }));
  out.push(screws(BED, 6, 4));
  for (let i = 0; i < 12; i++) {
    const x = 43 + i * 8.6;
    const h = 19 + (i % 4) * 3;
    const slat = { x, y: 38, w: 5.6, d: 29, r: 1 };
    out.push(S(k.slabOf(slat, 6, h, P, 2.5, 0.45), { tone: i === 6 ? "hi" : "mid" }));
    out.push(L(k.planOutline(k.insetPlan(slat, 1.1), 6 + h, P), { tone: "faint" }));
    out.push(D([at([x + 2.8, 39.5, 6 + h])], { size: 0.38, tone: "lo" }));
  }
  const dimStrip = { x: 43, y: 32.5, w: 103, d: 3, r: 0.5 };
  out.push(S(k.slabOf(dimStrip, 6.5, 1.2, P, 1.5), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(dimStrip.x + 2, dimStrip.x + dimStrip.w - 2, 4, 4, dimStrip.y, 1.2, [1.2, 2.5], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  return out.join("");
}

function similarityGate() {
  const out = [];
  const rail = { x: 104, y: 14, w: 74, d: 4, r: 1 };
  out.push(S(k.slabOf(rail, 6, 4, P, 2, 0.4), { tone: "mid" }));
  for (let i = 0; i < 8; i++) {
    const x = rail.x + 4 + i * 9;
    out.push(L(k.lineOnTop([x, rail.y], [x, rail.y + 4], 10, P), { tone: i === 7 ? "hi" : "lo" }));
  }
  const gate = { x: GATE_X - 7, y: 7, w: 14, d: 20, r: 2 };
  out.push(S(k.slabOf(gate, 10, 26, P, 3, 0.6), { tone: "hi" }));
  out.push(L(k.planOutline(k.insetPlan(gate, 2), 36, P), { tone: "faint" }));
  out.push(S(k.cylinder(GATE_X, 19, 4.2, 36, 5, P, 24), { tone: "mid" }));
  out.push(L(k.ring(GATE_X, 19, 3.5, 41, P, 24), { tone: "lo" }));
  return out.join("");
}

function cabinet(plan, count, tone = "mid") {
  const out = [S(k.slabOf(plan, 0, 31, P, 4, 0.7), { tone }), L(k.planOutline(k.insetPlan(plan, 2), 31, P), { tone: "faint" }), screws(plan, 31, 4)];
  for (let i = 0; i < count; i++) {
    const z = 4 + i * 8;
    const drawer = { x: plan.x + 3, y: plan.y + 3, w: plan.w - 6, d: plan.d - 6, r: 1 };
    out.push(S(k.slabOf(drawer, z, 6, P, 2, 0.35), { tone: i === 1 ? "hi" : "mid" }));
    out.push(L(k.planOutline(k.insetPlan(drawer, 1.2), z + 6.1, P), { tone: "faint" }));
    out.push(S(k.slabOf({ x: plan.x + plan.w / 2 - 5, y: plan.y - 1.5, w: 10, d: 3, r: 0.8 }, z + 6, 1.5, P, 1), { tone: "lo", crease: "none" }));
  }
  return out.join("");
}

function chutes() {
  const out = [];
  for (const [x, tone] of [[-104, "mid"], [138, "mid"]]) {
    const tray = { x, y: CHUTE_Y, w: 38, d: 18, r: 3 };
    out.push(S(k.slabOf(tray, 0, 5, P, 3, 0.6), { tone }));
    out.push(S(k.slabOf({ x, y: CHUTE_Y, w: 4, d: 18, r: 1 }, 5, 10, P, 2), { tone }));
    out.push(S(k.slabOf({ x: x + 34, y: CHUTE_Y, w: 4, d: 18, r: 1 }, 5, 10, P, 2), { tone }));
    out.push(L(k.planOutline(k.insetPlan(tray, 3), 5.1, P), { tone: "faint" }));
    out.push(screws(tray, 5, 4));
  }
  return out.join("");
}

function cartridge(x, y, z) {
  const plan = { x: x - 11, y: y - 6, w: 22, d: 12, r: 2 };
  const out = [];
  out.push(S(k.slabOf(plan, z, 8, P, 3, 0.7), { tone: "hi", lit: true }));
  out.push(L(k.planOutline(k.insetPlan(plan, 1.7), z + 8.1, P), { tone: "lit" }));
  out.push(D([at([x - 6, y, z + 8]), at([x, y, z + 8]), at([x + 6, y, z + 8])], { size: 0.5, tone: "lit" }));
  return out.join("");
}

const SCENARIOS = [
  {
    key: "exact",
    name: "exact hit",
    score: 1.00,
    detail: "exact-key path; no embedding",
    stages: ["feed tray", "normalization comb", "exact-key lock", "KV response vault"],
    waypoints: [[-113, -31, 15], [-76, -30, 24], [-41, -26, 39], [112, 59, 39]],
    result: "KV response vault",
  },
  {
    key: "semantic",
    name: "semantic hit",
    score: 0.94,
    detail: "embedding + subject scan",
    stages: ["feed tray", "normalization comb", "exact-key miss", "subject drawer", "384-dimension scan", "similarity gate", "KV response vault"],
    waypoints: [[-113, -31, 15], [-76, -30, 24], [-41, -26, 39], [20, 2, 58], [86, 49, 37], [160, 19, 41], [112, 59, 39]],
    result: "KV response vault",
  },
  {
    key: "miss",
    name: "miss",
    score: 0.72,
    detail: "below 0.90 threshold",
    stages: ["feed tray", "normalization comb", "exact-key miss", "subject drawer", "384-dimension scan", "similarity gate", "miss chute"],
    waypoints: [[-113, -31, 15], [-76, -30, 24], [-41, -26, 39], [20, 2, 58], [86, 49, 37], [160, 19, 41], [157, -44, 15]],
    result: "miss chute",
  },
];

const start = SCENARIOS[0].waypoints[0];
const bodySvg = [
  base(),
  feedTray(),
  normalizer(),
  exactLock(),
  drawerBank(),
  comparisonBed(),
  similarityGate(),
  cabinet(D1, 3),
  cabinet(KV, 3),
  chutes(),
  `<g data-part="cartridge" transform="${k.translateAlong(P, start)}">${cartridge(0, 0, 0)}</g>`,
].join("");

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "Isometric semantic cache sorting instrument. A request cartridge is normalized, checked by an exact-key lock, scanned in one of five subject drawers against a 384-dimension comparison bed, and accepted by a 0.90 similarity gate into the KV response vault or sent to the miss chute.",
  body: bodySvg,
});

const initialReadout = `${SCENARIOS[0].name} · ${SCENARIOS[0].stages[0]} · ${SCENARIOS[0].score.toFixed(2)} · ready`;
const controls = `<div class="cache-controls" role="group" aria-label="Cache scenarios"><button type="button" data-scenario="0" aria-pressed="true">Exact hit</button><button type="button" data-scenario="1" aria-pressed="false">Semantic hit</button><button type="button" data-scenario="2" aria-pressed="false">Miss</button><button type="button" data-run>Run route</button></div>`;
const plate = k.plateHtml({
  fig: "Fig 1",
  title: "Semantic edge cache",
  hint: "← → choose · Space run · Home/End",
  readout: initialReadout,
  keys: [
    { mark: "lit", label: "Request cartridge and active route" },
    { mark: "raised", label: "Subject drawers · 384-slot comparison bed" },
  ],
  caption: "A postal sorting instrument for the local semantic cache: normalization precedes the exact-key lock; only a miss visits a subject drawer and the 384-dimension comparison bed, where 0.90 is the reuse threshold.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Semantic cache scenario" aria-valuemin="0" aria-valuemax="2" aria-valuenow="0" aria-valuetext="${initialReadout}">${svg}</div>${controls}`,
});
const body = `${plate.replace("data-readout", "data-readout aria-live=\"polite\"")}<style>
.cache-controls{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:12px;flex-wrap:wrap}
.cache-controls button{font:12px/1.2 var(--anatomy-mono);color:var(--anatomy-text);background:var(--anatomy-card);border:1px solid color-mix(in srgb,var(--anatomy-text) 25%,transparent);border-radius:999px;padding:7px 11px;cursor:pointer;transition:color .2s ease,border-color .2s ease,background .2s ease}
.cache-controls button:hover,.cache-controls button:focus-visible{color:var(--anatomy-strong);border-color:var(--anatomy-text);outline:none}
.cache-controls button[aria-pressed="true"]{color:var(--anatomy-strong);border-color:var(--anatomy-strong);background:color-mix(in srgb,var(--anatomy-text) 10%,transparent)}
@media (max-width:520px){.cache-controls{justify-content:center}.cache-controls button{font-size:11px;padding:6px 9px}}
@media (max-width:560px){.iso-plate-corner[data-corner="hint"]{max-width:44%;white-space:normal;line-height:1.2}.iso-plate-corner[data-corner="readout"]{max-width:48%;white-space:normal;text-align:right;line-height:1.2}}
</style>`;

const live = `
const P = ${JSON.stringify(P)};
const SCENARIOS = ${JSON.stringify(SCENARIOS)};
const stage = document.querySelector('.iso-stage');
const svg = stage.querySelector('svg');
const cartridge = svg.querySelector('[data-part="cartridge"]');
const readout = document.querySelector('[data-readout]');
const buttons = [...document.querySelectorAll('[data-scenario]')];
const runButton = document.querySelector('[data-run]');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let selected = 0, routeSegment = 0, progress = 0, running = false, touring = true, visible = false, last = 0, frame = 0, idle, tourPause, phase = 'feed', currentPoint = [...SCENARIOS[0].waypoints[0]], fromPoint = [...currentPoint];
let previousStage = '';
const ease = (t) => t * t * (3 - 2 * t);
const lerpPoint = (a, b, t) => a.map((value, index) => value + (b[index] - value) * ease(t));
const feedPoint = () => SCENARIOS[selected].waypoints[0];
const stageText = (scenario, label, done = false) => scenario.name + ' · ' + label + ' · ' + scenario.score.toFixed(2) + ' · ' + (done ? scenario.result : scenario.detail);
function announce(scenario, label, done = false) {
  const text = stageText(scenario, label, done);
  if (label !== previousStage || done) {
    readout.textContent = text;
    stage.setAttribute('aria-live', 'polite');
    previousStage = label;
  }
  stage.setAttribute('aria-valuenow', String(selected));
  stage.setAttribute('aria-valuetext', text + (done ? ' · complete' : ''));
  buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === selected)));
}
function render() {
  const scenario = SCENARIOS[selected];
  cartridge.setAttribute('transform', translateAlong(P, currentPoint));
  if (phase === 'feed') announce(scenario, scenario.stages[0]);
  else if (phase === 'to-feed') announce(scenario, scenario.stages[0]);
  else {
    const at = Math.min(scenario.stages.length - 1, routeSegment + (progress >= 0.5 ? 1 : 0));
    announce(scenario, scenario.stages[at], phase === 'done');
  }
}
function begin(index, replay = false, keepTour = false) {
  selected = clamp(index, 0, SCENARIOS.length - 1);
  const destination = feedPoint();
  fromPoint = replay ? [...currentPoint] : [...currentPoint];
  phase = 'to-feed';
  routeSegment = 0;
  progress = 0;
  running = true;
  touring = keepTour;
  clearTimeout(idle);
  render();
  run();
  if (replay && fromPoint.every((value, i) => Math.abs(value - destination[i]) < 0.05)) { phase = 'route'; currentPoint = [...destination]; }
}
function steer(index) { touring = false; clearTimeout(tourPause); begin(index); idle = setTimeout(() => { if (!reduced.matches) { touring = true; begin((selected + 1) % SCENARIOS.length, true, true); } }, 4800); }
function runRoute() { clearTimeout(idle); clearTimeout(tourPause); touring = false; begin(selected, true); }
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
  last = now;
  if (phase === 'to-feed') {
    progress = reduced.matches ? 1 : Math.min(1, progress + dt / 0.65);
    currentPoint = lerpPoint(fromPoint, feedPoint(), progress);
    if (progress >= 1) { phase = 'route'; routeSegment = 0; progress = 0; currentPoint = [...feedPoint()]; }
  } else if (running) {
    const scenario = SCENARIOS[selected];
    const from = scenario.waypoints[routeSegment];
    const to = scenario.waypoints[Math.min(routeSegment + 1, scenario.waypoints.length - 1)];
    progress = reduced.matches ? 1 : Math.min(1, progress + dt / 0.8);
    currentPoint = lerpPoint(from, to, progress);
    if (progress >= 1) {
      if (routeSegment < scenario.waypoints.length - 2) { routeSegment += 1; progress = 0; }
      else { running = false; phase = 'done'; render(); if (touring && !reduced.matches) tourPause = setTimeout(() => begin((selected + 1) % SCENARIOS.length, true, true), 900); }
    }
  }
  render();
  frame = visible && (running || phase === 'to-feed' || touring) ? requestAnimationFrame(tick) : 0;
}
function run() { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } }
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: '120px 0px' }).observe(stage);
buttons.forEach((button, index) => button.addEventListener('click', () => steer(index)));
runButton.addEventListener('click', runRoute);
stage.addEventListener('keydown', (event) => {
  let next = null;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = selected + 1;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = selected - 1;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = SCENARIOS.length - 1;
  if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); runRoute(); return; }
  if (next === null) return;
  event.preventDefault(); steer(next);
});
stage.addEventListener('pointerdown', () => { touring = false; clearTimeout(idle); });
if (reduced.matches) touring = false;
phase = reduced.matches ? 'feed' : 'route';
currentPoint = [...SCENARIOS[0].waypoints[0]];
running = !reduced.matches;
announce(SCENARIOS[0], SCENARIOS[0].stages[0]);
render();
`;

writeFileSync(join(HERE, theme === "light" ? "semantic-cache-light.html" : "semantic-cache.html"), k.pageHtml({ title: "Semantic edge cache", theme, body, script: kitScript() + live, width: 720 }));
console.log("wrote", theme === "light" ? "semantic-cache-light.html" : "semantic-cache.html");
