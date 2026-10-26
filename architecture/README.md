# Semantic cache architecture figure

This is a framework-free Anatomy figure for the local semantic edge cache. Build both interactive themes with:

```sh
node build.mjs
node build.mjs --light
```

Open `semantic-cache.html` or `semantic-cache-light.html` in a browser. Use the scenario buttons, click **Run route**, or focus the figure and use Left/Right, Space/Enter, Home, and End. The idle tour pauses after interaction and honors `prefers-reduced-motion`.

The machine is a postal sorting instrument: a request cartridge is normalized, tested by an exact-key lock, narrowed through subject drawers, compared across a 384-dimension bed, and released by the 0.90 gate into the KV response vault or sent to the miss chute.

The values and stages mirror `src/index.ts`, `src/subjects.ts`, and `wrangler.jsonc`: five support subjects, 384 embedding dimensions, `SIMILARITY_THRESHOLD=0.90`, and `DEFAULT_TTL_SECONDS=86400`.

## Article assets

Create the Substack-friendly visual pair with:

```sh
npm run assets:build
```

`export-assets.mjs` reads the existing light-theme HTML, extracts its SVG and route waypoints, resolves the theme colors for deterministic raster output, and uses the installed `sharp` package plus system `ffmpeg`. It writes a 1200×860 looping GIF with 90 route frames and a matching 1200×860 PNG fallback:

- [`semantic-cache-route.gif`](semantic-cache-route.gif)
- [`semantic-cache-route.png`](semantic-cache-route.png)

The labels make the three outcomes explicit: exact hit, semantic hit, and miss. Use the PNG with descriptive alt text when a mail client does not animate images. The figure keeps the configured runtime threshold at `0.90`. The benchmark selected `0.81` as a development recommendation on its small local fixture, but that value was not applied to the runtime or the figure.
