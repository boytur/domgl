import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ElementSpec, Sample, ScenePackage, TranspileOptions } from "../types.js";
import { launchBrowser } from "../lib/browser.js";
import { serve } from "../lib/http.js";

interface RawElement {
  i: number;
  tag: string;
  cls: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

/**
 * Converts one or more HyperFrames scenes into textures + sampled transforms.
 *
 * The scene HTML stays the source of truth: we read the real DOM, bake each painted
 * element to a PNG, then seek the real GSAP timeline at `fps` and record transforms.
 */
export async function transpile(options: TranspileOptions): Promise<ScenePackage[]> {
  const projectDir = resolve(options.projectDir);
  const fps = options.fps ?? 30;
  const maxElements = options.maxElements ?? 40;
  const outRel = options.outDir ?? "webgl/auto";
  const outDir = join(projectDir, outRel);
  const tmpRel = "webgl/_tmp_transpile";
  const tmpDir = join(projectDir, tmpRel);

  mkdirSync(outDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  const stagePath = join(projectDir, options.stageFile ?? "scripts/stage.js");
  const stageJs = existsSync(stagePath) ? readFileSync(stagePath, "utf8") : "";

  const prepared: string[] = [];
  for (const id of options.ids) {
    const compPath = join(projectDir, options.compositionsDir ?? "compositions", `${id}.html`);
    if (!existsSync(compPath)) {
      console.warn(`transpile: missing composition for ${id}`);
      continue;
    }
    const raw = readFileSync(compPath, "utf8");
    const body = raw.replace(/^\s*<template>\s*/, "").replace(/\s*<\/template>\s*$/, "");
    const page = `<!doctype html><html><head><meta charset="utf-8"><base href="/">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<script>window.__timelines = {};</script>
<script>${stageJs}</script>
<style>html,body{margin:0;width:1080px;height:1920px;overflow:hidden}</style>
</head><body>${body}</body></html>`;
    writeFileSync(join(tmpDir, `${id}.html`), page, "utf8");
    prepared.push(id);
  }

  const server = await serve(projectDir);
  const browser = await launchBrowser({ gpu: false });
  const packages: ScenePackage[] = [];

  try {
    for (const id of prepared) {
      const dir = join(outDir, id);
      mkdirSync(dir, { recursive: true });

      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
      await page.goto(`${server.url}/${tmpRel}/${id}.html`, { waitUntil: "networkidle0", timeout: 90_000 });
      await page.evaluate(() => document.fonts?.ready);
      await new Promise((r) => setTimeout(r, 250));

      const duration = await page.evaluate((slotSec: number) => {
        const timelines = (window as unknown as { __timelines?: Record<string, { duration(): number }> })
          .__timelines;
        const key = timelines ? Object.keys(timelines)[0] : undefined;
        const tlDur = key && timelines ? timelines[key]!.duration() : 0;
        const rootEl = document.getElementById("root");
        const attr = Number.parseFloat(rootEl?.getAttribute("data-duration") ?? "0") || 0;
        const base = Math.max(tlDur, attr, slotSec || 0);
        return Math.min(120, base > 0 ? base : 3.6);
      }, options.slot ?? 0);

      const inventory = (await page.evaluate((cap: number) => {
        const rootEl = document.getElementById("root");
        if (!rootEl) return [] as RawElement[];
        const isPainted = (el: Element, cs: CSSStyleDeclaration): boolean => {
          if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)") return true;
          if (parseFloat(cs.borderTopWidth) > 0) return true;
          if (cs.boxShadow && cs.boxShadow !== "none") return true;
          if (el.tagName.toLowerCase() === "img" || el.tagName.toLowerCase() === "svg") return true;
          return Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim() !== "");
        };

        const out: RawElement[] = [];
        // Effective stacking value: an element can never paint above its own
        // ancestor's layer, and a descendant must paint above its parent's
        // background. Taking the max z-index of the ancestor chain and letting
        // DOM order break ties reproduces CSS painting order closely enough.
        const effectiveZ = (el: Element): number => {
          let z = 0;
          let p: Element | null = el;
          while (p && p !== rootEl.parentElement) {
            const v = Number.parseInt(getComputedStyle(p).zIndex, 10);
            if (!Number.isNaN(v) && v > z) z = v;
            p = p.parentElement;
          }
          return z;
        };
        for (const el of Array.from(rootEl.querySelectorAll("*"))) {
          if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 6 || r.height < 6) continue;
          if (!isPainted(el, cs)) continue;
          const i = out.length;
          if (i >= cap) break;
          el.setAttribute("data-tx", String(i));
          const cls =
            typeof (el as HTMLElement).className === "string"
              ? (el as HTMLElement).className
              : (el.getAttribute("class") ?? "");
          out.push({
            i,
            tag: el.tagName.toLowerCase(),
            cls,
            x: Math.round(r.left * 10) / 10,
            y: Math.round(r.top * 10) / 10,
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
            z: effectiveZ(el),
          });
        }
        return out;
      }, maxElements)) as RawElement[];

      // bake one transparent PNG per element
      const baked: ElementSpec[] = [];
      for (const raw of inventory) {
        await page.evaluate((i: number) => {
          const target = document.querySelector(`[data-tx="${i}"]`);
          if (!target) return;
          document.querySelectorAll("body *").forEach((el) => {
            (el as HTMLElement).style.visibility = "hidden";
          });
          (target as HTMLElement).style.visibility = "visible";
          target.querySelectorAll("*").forEach((el) => {
            (el as HTMLElement).style.visibility = "visible";
          });
        }, raw.i);

        const pad = 8;
        const x = Math.max(0, raw.x - pad);
        const y = Math.max(0, raw.y - pad);
        const width = Math.min(1080 - x, raw.w + pad * 2);
        const height = Math.min(1920 - y, raw.h + pad * 2);

        const texPath = join(dir, `e${raw.i}.png`);
        await page.screenshot({
          path: texPath,
          type: "png",
          omitBackground: true,
          clip: { x, y, width, height },
        });

        await page.evaluate(() => {
          document.querySelectorAll("body *").forEach((el) => {
            (el as HTMLElement).style.visibility = "";
          });
        });

        // a blank element (borderless wrapper, empty div) produces an almost empty
        // PNG; drop it instead of paying for a full-screen transparent plane
        const bytes = statSync(texPath).size;
        if (bytes < 300) {
          rmSync(texPath, { force: true });
          continue;
        }

        baked.push({ ...raw, tex: `${id}/e${raw.i}.png`, pad });
      }

      // re-index the kept elements so frames[frame][i] lines up with elements[i]
      for (let i = 0; i < baked.length; i++) {
        const spec = baked[i]!;
        await page.evaluate(
          (attr: number, next: number) => {
            const el = document.querySelector(`[data-tx="${attr}"]`);
            if (el) el.setAttribute("data-tx", String(next));
          },
          spec.i,
          i,
        );
      }

      const elements: ElementSpec[] = baked;

      // sample the real timeline
      const frameCount = Math.max(1, Math.round(duration * fps));
      const frames = (await page.evaluate(
        async (fpsArg: number, total: number, count: number) => {
          const timelines = (window as unknown as { __timelines?: Record<string, { time(t: number): void }> })
            .__timelines;
          const key = timelines ? Object.keys(timelines)[0] : undefined;
          const tl = key && timelines ? timelines[key] : undefined;
          if (!tl) return [] as (Sample | null)[][];

          const rows: (Sample | null)[][] = [];
          for (let f = 0; f < total; f++) {
            tl.time(f / fpsArg);
            await new Promise((r) => requestAnimationFrame(r));
            const row: (Sample | null)[] = [];
            for (let i = 0; i < count; i++) {
              const el = document.querySelector(`[data-tx="${i}"]`);
              if (!el) {
                row.push(null);
                continue;
              }
              const cs = getComputedStyle(el);
              const m = new DOMMatrixReadOnly(cs.transform === "none" ? "" : cs.transform);
              const r = el.getBoundingClientRect();
              row.push([
                Math.round(r.left * 10) / 10,
                Math.round(r.top * 10) / 10,
                Math.round(Math.atan2(m.b, m.a) * 1000) / 1000,
                Math.round(Math.hypot(m.a, m.b) * 1000) / 1000,
                Math.round(parseFloat(cs.opacity) * 100) / 100,
              ]);
            }
            rows.push(row);
          }
          return rows;
        },
        fps,
        frameCount,
        elements.length,
      )) as (Sample | null)[][];

      const pkg: ScenePackage = {
        id,
        fps,
        duration,
        width: 1080,
        height: 1920,
        elements,
        frames,
      };
      writeFileSync(join(outDir, `${id}.json`), JSON.stringify(pkg));
      packages.push(pkg);

      console.log(`${id}: ${elements.length} textures, ${frameCount} frames, ${duration.toFixed(2)}s`);
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return packages;
}
