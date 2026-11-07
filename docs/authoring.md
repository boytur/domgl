# Authoring a scene

domgl does **not** require any particular framework. A scene is just an HTML file that

1. renders at a fixed size (default `1080×1920`),
2. contains a paused **GSAP timeline**, and
3. registers that timeline on `window.__timelines`.

If you already author with HyperFrames, the file in `compositions/<id>.html` is exactly
this shape — point domgl at the same folder and nothing has to be rewritten.

## Minimal scene

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
  html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; }
  #root { position: absolute; inset: 0; background: #1b1a17; }
  .card { position: absolute; left: 240px; top: 760px; width: 600px; height: 400px;
          background: #f2b233; border-radius: 28px; }
</style>
</head>
<body>
  <div id="root" data-duration="3.000">
    <div class="card"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo(".card", { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5 });
    window.__timelines["hello"] = tl;
  </script>
</body>
</html>
```

Save it as `compositions/hello.html`, then:

```bash
domgl transpile . hello
domgl lint . hello --strict
domgl render . hello --out renders/hello.mp4
```

## The contract

| rule | why |
|---|---|
| Scene file name = scene id (`hello.html` → `hello`) | packages are written as `<id>.json` |
| Timeline is **paused** and registered on `window.__timelines["<id>"]` | domgl seeks it; nothing may run on rAF |
| Every animated element is **painted** (background, border, text, or SVG) | only painted nodes become textures |
| `data-duration` on `#root`, in seconds | a timeline often ends before its slot; the film holds the last frame |
| Fixed pixel layout, no responsive units | samples are recorded in scene pixels |
| No `setInterval`, no `Math.random()`, no `requestAnimationFrame` | the frame must be a pure function of `timeline.time()` |

## What gets baked

For every painted element, domgl saves a transparent PNG of that element alone, plus a
per-frame transform track. So:

- **Text** is rasterised — it will look exactly like the browser drew it (Thai shaping included).
- **SVG** is rasterised at 1–3× — sharp enough for 1080p.
- **CSS props** (borders, radii, shadows, gradients) survive unchanged.

## What to avoid

- **Clip-path / masks that change per frame** — they are baked at sample time. Merge them into
  one group instead.
- **Rotating a non-square element more than ~45°** — the transform is reconstructed from the
  bounding box, so large rotations drift.
- **Hundreds of elements** — one texture each. Cap with `--max`, or group static art into a
  single wrapper.
- **Video / canvas elements** — not sampled; export frames and use an image layer.

## HyperFrames

domgl reads the compositions folder, not the HyperFrames runtime. A scene authored for
HyperFrames already satisfies the contract, so the same file works in both:

```bash
# preview / edit
npx hyperframes snapshot --at 1.5

# fast final render
domgl transpile . s01 s02 s03
domgl lint . --strict
domgl render . s01 s02 s03 --out renders/out.mp4
```

If your scene relies on a helper script (camera, floor snapping), pass it explicitly:
`domgl transpile . s01 --stage scripts/stage.js`.
