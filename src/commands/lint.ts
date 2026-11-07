import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LintIssue, LintOptions, LintResult, Sample, ScenePackage } from "../types.js";

const MAX_ELEMENTS = 200;
const MAX_TEXTURE_BYTES = 6 * 1024 * 1024;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * Validates transpiled scene packages before a render.
 *
 * This is the guard rail for machine-written scenes: if a generator emits a weird
 * number, a missing texture or a frame-count mismatch, `domgl lint` says so instead
 * of producing a broken video 40 seconds later.
 */
export function lint(options: LintOptions): LintResult {
  const projectDir = resolve(options.projectDir);
  const outDir = resolve(projectDir, options.outDir ?? "webgl/auto");
  const strict = options.strict ?? false;

  const issues: LintIssue[] = [];
  const add = (id: string, severity: "error" | "warning", code: string, message: string) =>
    issues.push({ id, severity, code, message });

  if (!existsSync(outDir)) {
    return {
      files: 0,
      errors: 1,
      warnings: 0,
      issues: [
        {
          id: "-",
          severity: "error",
          code: "out-dir-missing",
          message: `no transpiled packages at ${outDir}`,
        },
      ],
    };
  }

  const wanted = options.ids?.length
    ? options.ids
    : readdirSync(outDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .sort();

  for (const id of wanted) {
    const file = join(outDir, `${id}.json`);
    if (!existsSync(file)) {
      add(id, "error", "missing-package", `${file} does not exist`);
      continue;
    }

    let pkg: ScenePackage;
    try {
      pkg = JSON.parse(readFileSync(file, "utf8")) as ScenePackage;
    } catch (err) {
      add(id, "error", "invalid-json", String((err as Error).message).slice(0, 160));
      continue;
    }

    if (pkg.id !== id) add(id, "error", "id-mismatch", `package id is "${pkg.id}"`);
    if (!finite(pkg.duration) || pkg.duration <= 0 || pkg.duration > 60) {
      add(id, "error", "bad-duration", `duration ${pkg.duration}`);
    }
    if (!finite(pkg.fps) || pkg.fps < 1 || pkg.fps > 120) {
      add(id, "error", "bad-fps", `fps ${pkg.fps}`);
    }
    if (pkg.width !== 1080 || pkg.height !== 1920) {
      add(id, "warning", "unexpected-size", `${pkg.width}x${pkg.height} (expected 1080x1920)`);
    }

    const elements = Array.isArray(pkg.elements) ? pkg.elements : [];
    if (!elements.length) add(id, "error", "no-elements", "scene has no baked elements");
    if (elements.length > MAX_ELEMENTS) {
      add(id, "error", "too-many-elements", `${elements.length} > ${MAX_ELEMENTS}`);
    }

    elements.forEach((e, i) => {
      if (!e.tex) {
        add(id, "error", "element-no-texture", `element ${i} has no tex`);
        return;
      }
      const texPath = join(outDir, e.tex);
      if (!existsSync(texPath)) {
        add(id, "error", "texture-missing", `element ${i}: ${e.tex} not found`);
      } else {
        const size = statSync(texPath).size;
        if (size > MAX_TEXTURE_BYTES) {
          add(id, "warning", "texture-huge", `element ${i}: ${e.tex} is ${(size / 1e6).toFixed(1)} MB`);
        }
        if (size < 200) {
          add(id, "warning", "texture-tiny", `element ${i}: ${e.tex} is ${size} bytes (blank?)`);
        }
      }
      for (const key of ["x", "y", "w", "h"] as const) {
        if (!finite(e[key])) add(id, "error", "element-bad-rect", `element ${i}: ${key} is not a number`);
      }
      if (finite(e.w) && e.w <= 0) add(id, "error", "element-zero-size", `element ${i}: w=${e.w}`);
      if (finite(e.h) && e.h <= 0) add(id, "error", "element-zero-size", `element ${i}: h=${e.h}`);
      if (finite(e.x) && (e.x < -400 || e.x > 1480)) {
        add(id, "warning", "element-offscreen", `element ${i}: x=${e.x}`);
      }
      if (finite(e.y) && (e.y < -400 || e.y > 2320)) {
        add(id, "warning", "element-offscreen", `element ${i}: y=${e.y}`);
      }
    });

    const frames = Array.isArray(pkg.frames) ? pkg.frames : [];
    const expected = Math.round(pkg.duration * pkg.fps);
    if (frames.length !== expected) {
      add(id, "error", "frame-count", `${frames.length} frames, expected ${expected}`);
    }

    let movingSamples = 0;
    const first: (Sample | null)[] = frames[0] ?? [];
    frames.forEach((row, f) => {
      if (!Array.isArray(row)) {
        add(id, "error", "bad-frame", `frame ${f} is not an array`);
        return;
      }
      if (row.length !== elements.length) {
        add(id, "error", "frame-width", `frame ${f} has ${row.length} samples, expected ${elements.length}`);
        return;
      }
      row.forEach((s, i) => {
        if (s === null) return;
        if (!Array.isArray(s) || s.length !== 5) {
          add(id, "error", "bad-sample", `frame ${f} element ${i}: expected 5 numbers`);
          return;
        }
        const [x, y, rot, scale, opacity] = s as Sample;
        if (![x, y, rot, scale, opacity].every(finite)) {
          add(id, "error", "nan-sample", `frame ${f} element ${i}: non-finite value`);
          return;
        }
        if (opacity < 0 || opacity > 1) add(id, "error", "bad-opacity", `frame ${f} element ${i}: ${opacity}`);
        if (scale <= 0 || scale > 12) add(id, "error", "bad-scale", `frame ${f} element ${i}: ${scale}`);
        if (Math.abs(rot) > Math.PI * 2.5) add(id, "warning", "bad-rotation", `frame ${f} element ${i}: ${rot}`);
        if (x < -4000 || x > 5000 || y < -4000 || y > 5000) {
          add(id, "error", "sample-out-of-range", `frame ${f} element ${i}: ${x},${y}`);
        }
        const base = first[i];
        if (!base || base[0] !== x || base[1] !== y || base[2] !== rot || base[3] !== scale || base[4] !== opacity) {
          movingSamples++;
        }
      });
    });

    if (frames.length > 1 && movingSamples === 0) {
      add(id, "warning", "static-scene", "every sample is identity — nothing moves");
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  if (strict && warnings > 0) {
    for (const issue of issues) {
      if (issue.severity === "warning") issue.severity = "error";
    }
    return { files: wanted.length, errors: errors + warnings, warnings: 0, issues };
  }

  return { files: wanted.length, errors, warnings, issues };
}
