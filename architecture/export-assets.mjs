import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "semantic-cache-light.html"), "utf8");
const cssSource = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const sourceSvg = html.match(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="iso-svg"[\s\S]*?<\/svg>/)?.[0];

if (!cssSource || !sourceSvg) throw new Error("Could not extract the existing light-theme SVG source");

const colors = {
  paper: "#fbfbfa",
  face: "#ffffff",
  top: "#ffffff",
  "shade-0": "#dcdcd9",
  "shade-1": "#e5e5e2",
  "shade-2": "#ededea",
  "shade-3": "#f4f4f1",
  "lit-top": "#ffffff",
  "lit-shade": "#eeeeeb",
  hi: "#26262a",
  mid: "#8a8a8f",
  lo: "#b4b4b8",
  faint: "#d4d4d6",
  lit: "#000000",
  halo: "#8a8a80",
  "halo-opacity": ".32",
  dot: "#3a3a3e",
  red: "#e5484d",
  green: "#30a46c",
  blue: "#3e63dd",
  weight: ".6px",
  mono: "monospace",
  ease: "ease",
  lift: "none",
};

// librsvg does not resolve CSS custom properties consistently. Resolve the
// existing theme values at export time instead of changing the source figure.
const css = cssSource
  .replace(/var\(--anatomy-([^)]+)\)/g, (_, name) => colors[name] ?? "inherit")
  .replace(/color-mix\([^;]+\)/g, "#fbfbfa");

const P = { origin: [337.3774265731861, 198.60775700427104], scale: 1.520037628647102, azimuth: 43, elevation: 30 };
const scenarios = [
  {
    key: "exact",
    label: "EXACT HIT",
    score: "1.00",
    detail: "exact key → KV response",
    color: "#2f7d57",
    waypoints: [[-113, -31, 15], [-76, -30, 24], [-41, -26, 39], [112, 59, 39]],
  },
  {
    key: "semantic",
    label: "SEMANTIC HIT",
    score: "0.94",
    detail: "subject scan → passes 0.90",
    color: "#3e63dd",
    waypoints: [[-113, -31, 15], [-76, -30, 24], [-41, -26, 39], [20, 2, 58], [86, 49, 37], [160, 19, 41], [112, 59, 39]],
  },
  {
    key: "miss",
    label: "MISS",
    score: "0.72",
    detail: "below 0.90 → miss chute",
    color: "#b34c4c",
    waypoints: [[-113, -31, 15], [-76, -30, 24], [-41, -26, 39], [20, 2, 58], [86, 49, 37], [160, 19, 41], [157, -44, 15]],
  },
];

const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const camera = () => {
  const a = P.azimuth * Math.PI / 180;
  const e = P.elevation * Math.PI / 180;
  return { sinA: Math.sin(a), cosA: Math.cos(a), sinE: Math.sin(e), cosE: Math.cos(e), k: P.scale * Math.sqrt(1.6) };
};
const iso = ([x, y, z]) => {
  const { sinA, cosA, sinE, cosE, k } = camera();
  return [P.origin[0] + (x * sinA - y * cosA) * k, P.origin[1] + ((x * cosA + y * sinA) * sinE - z * cosE) * k];
};
const origin = iso([0, 0, 0]);
const translate = (point) => {
  const [x, y] = iso(point);
  return `translate(${(x - origin[0]).toFixed(2)} ${(y - origin[1]).toFixed(2)})`;
};
const ease = (value) => value * value * (3 - 2 * value);
const lerp = (from, to, t) => from.map((value, index) => value + (to[index] - value) * ease(t));

function scene(position) {
  return sourceSvg
    .replace('class="iso-svg"', 'class="iso iso-svg" data-theme="light"')
    .replace('><path', `><style>${css}</style><path`)
    .replace(/(<g data-part="cartridge" transform=")[^"]+(">)/, `$1${translate(position)}$2`);
}

function chip(x, scenario, active) {
  const fill = active ? `${scenario.color}16` : "#ffffff";
  const stroke = active ? scenario.color : "#d4d4d6";
  return `<rect x="${x}" y="47" width="210" height="28" rx="14" fill="${fill}" stroke="${stroke}"/><text x="${x + 105}" y="65" text-anchor="middle" fill="${active ? scenario.color : "#6d6d72"}" font-family="monospace" font-size="12" letter-spacing=".04em">${scenario.label}</text>`;
}

function frameSvg(scenario, position, done = false) {
  const inner = scene(position).replace(/^<svg /, '<svg x="40" y="84" width="1120" height="708" preserveAspectRatio="xMidYMid meet" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="860" viewBox="0 0 1200 860" role="img" aria-label="${escape(`${scenario.label}: ${scenario.detail}. Runtime similarity threshold 0.90.`)}"><rect width="1200" height="860" fill="#fbfbfa"/><rect x="12" y="12" width="1176" height="836" fill="none" stroke="#8a8a8f"/><text x="38" y="35" fill="#57575a" font-family="monospace" font-size="15" letter-spacing=".08em">SEMANTIC CACHE ROUTE</text><text x="1162" y="35" text-anchor="end" fill="#57575a" font-family="monospace" font-size="13">RUNTIME THRESHOLD 0.90</text>${chip(38, scenarios[0], scenario.key === "exact")}${chip(258, scenarios[1], scenario.key === "semantic")}${chip(478, scenarios[2], scenario.key === "miss")}${inner}<text x="38" y="823" fill="#26262a" font-family="monospace" font-size="16" letter-spacing=".02em">${scenario.label} · ${scenario.score} · ${escape(scenario.detail)}${done ? " · COMPLETE" : ""}</text><text x="1162" y="823" text-anchor="end" fill="#8a8a8f" font-family="monospace" font-size="12">384-DIMENSION SCAN · NAMESPACE + SUBJECT ISOLATED</text><text x="38" y="840" fill="#8a8a8f" font-family="monospace" font-size="10">STATIC FALLBACK: ROUTE OVERVIEW · BENCHMARK DEV RECOMMENDATION 0.81 NOT APPLIED</text></svg>`;
}

function staticSvg() {
  const scenario = scenarios[1];
  const inner = scene(scenario.waypoints.at(-1)).replace(/^<svg /, '<svg x="40" y="84" width="1120" height="708" preserveAspectRatio="xMidYMid meet" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="860" viewBox="0 0 1200 860" role="img" aria-label="Semantic cache route overview showing exact hit, semantic hit, and miss. Runtime threshold 0.90; development benchmark recommendation 0.81 was not applied."><rect width="1200" height="860" fill="#fbfbfa"/><rect x="12" y="12" width="1176" height="836" fill="none" stroke="#8a8a8f"/><text x="38" y="35" fill="#57575a" font-family="monospace" font-size="15" letter-spacing=".08em">SEMANTIC CACHE ROUTE</text><text x="1162" y="35" text-anchor="end" fill="#57575a" font-family="monospace" font-size="13">RUNTIME THRESHOLD 0.90</text>${chip(38, scenarios[0], false)}${chip(258, scenarios[1], true)}${chip(478, scenarios[2], false)}${inner}<text x="38" y="823" fill="#26262a" font-family="monospace" font-size="15">EXACT 1.00 → KV · SEMANTIC 0.94 → KV · MISS 0.72 → CHUTE</text><text x="1162" y="823" text-anchor="end" fill="#8a8a8f" font-family="monospace" font-size="12">384-DIMENSION SCAN · NAMESPACE + SUBJECT ISOLATED</text><text x="38" y="840" fill="#8a8a8f" font-family="monospace" font-size="10">0.81 IS A DEVELOPMENT BENCHMARK RECOMMENDATION ONLY · PRODUCTION FIGURE REMAINS 0.90</text></svg>`;
}

const temp = join(HERE, ".asset-frames");
mkdirSync(temp, { recursive: true });
const frames = [];
let frameNumber = 0;
for (const scenario of scenarios) {
  const points = scenario.waypoints;
  for (let segment = 0; segment < points.length - 1; segment++) {
    for (let step = 0; step < 5; step++) {
      const position = lerp(points[segment], points[segment + 1], step / 5);
      const path = join(temp, `frame-${String(frameNumber++).padStart(3, "0")}.png`);
      await sharp(Buffer.from(frameSvg(scenario, position))).png().toFile(path);
      frames.push(path);
    }
  }
  for (let hold = 0; hold < 5; hold++) {
    const path = join(temp, `frame-${String(frameNumber++).padStart(3, "0")}.png`);
    await sharp(Buffer.from(frameSvg(scenario, points.at(-1), true))).png().toFile(path);
    frames.push(path);
  }
}

const gif = join(HERE, "semantic-cache-route.gif");
const palette = join(temp, "palette.png");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "10", "-i", join(temp, "frame-%03d.png"), "-vf", "palettegen=stats_mode=diff", palette]);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "10", "-i", join(temp, "frame-%03d.png"), "-i", palette, "-lavfi", "paletteuse=dither=sierra2_4a", "-loop", "0", gif]);
await sharp(Buffer.from(staticSvg())).png().toFile(join(HERE, "semantic-cache-route.png"));
rmSync(temp, { recursive: true, force: true });
console.log(`Wrote ${gif} (${frames.length} frames) and semantic-cache-route.png`);
