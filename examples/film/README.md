# Film example — 50 scenes, 180 seconds

A complete 50-scene, 1080×1920, 30 fps film, authored as HTML + GSAP and rendered with
domgl. It is the stress test for the transpiler: every scene shape in the film (characters,
props, screens, doors, camera pushes, text) goes through the same bake → sample → replay
path, with no per-scene code.

| | |
|---|---|
| scenes | 50 × 3.6 s = 180.0 s |
| frame rate | 30 fps (5,400 frames) |
| resolution | 1080 × 1920 |
| render time | ~35 s (≈155 fps) on a 6-core laptop + RTX 3050 |
| output | `renders/film.mp4` (H.264 + AAC) |

## Reproduce

```bash
# the example ships the built compositions and the stage helper
domgl transpile examples/film s01 … s50 --slot 3.6 --stage scripts/stage.js
domgl lint examples/film --strict
domgl render examples/film s01 … s50 --out renders/film.mp4
```

`--slot 3.6` keeps every scene on the film grid even when a scene's timeline runs longer or
shorter than 3.6 s. `--stage scripts/stage.js` injects the small camera/floor helper the
scenes call; without it, scenes that use `Stage.snap()` fail to initialise.

Rendered film: see the `film-180s` asset on the repository releases page.

## What the transpiler supported

See [COVERAGE.md](COVERAGE.md) for the per-scene table (elements baked, frames, texture
size). In short:

- **Backgrounds**: one baked layer per scene, art intact.
- **Characters**: one texture each, per-frame transforms from GSAP.
- **CSS props** (phones, lifts, doors, tables, TVs, mirrors, badges): baked as their own
  layers, so they keep their real art and their animations.
- **Text** (Thai included): rasterised at 1.5–3× — no font embedding step.
- **Camera**: any scale/translate on a stage is sampled like everything else.

## What it does not cover

- **Per-element clipping**: `overflow:hidden` on a parent is baked into that parent's
  texture, so a child that slides outside it is not clipped at replay time. Scenes that rely
  on a mask to hide a prop mid-move will show the prop.
- **Expression swaps inside one SVG** (eyebrow/mouth groups toggled with opacity): those
  live inside a single baked character texture and are not re-baked per state, so the
  character keeps the expression it had at sample-time 0.
- **Blend modes / filters that change per frame**.
- **Video / canvas elements**.

These are the same limits listed in the root README; the film is the honest measure of how
far they go in practice.

## Scenes that come out static

`domgl lint` flags five scenes where nothing moves after transpiling: **s06, s28, s31, s36,
s39**. In those scenes the animation lives on elements that are either fully inside a single
baked texture (an SVG group toggled by opacity) or were dropped as blank, so no transform
track exists. They still render correctly as stills; they just lose the motion. Everything
else in the film animates.
