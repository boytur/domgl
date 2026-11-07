import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "../commands/lint.js";

function fixture(pkg: unknown, textures: Record<string, Buffer> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "domgl-"));
  const out = join(dir, "webgl", "auto");
  mkdirSync(join(out, "s01"), { recursive: true });
  writeFileSync(join(out, "s01.json"), JSON.stringify(pkg));
  for (const [name, buf] of Object.entries(textures)) {
    writeFileSync(join(out, name), buf);
  }
  return dir;
}

const validPkg = {
  id: "s01",
  fps: 30,
  duration: 0.2,
  width: 1080,
  height: 1920,
  elements: [{ i: 0, tag: "div", cls: "char", x: 100, y: 100, w: 300, h: 420, z: 1, tex: "s01/e0.png", pad: 8 }],
  frames: Array.from({ length: 6 }, (_, f) => [[100 + f, 100, 0, 1, 1]]),
};

test("accepts a clean package", () => {
  const dir = fixture(validPkg, { "s01/e0.png": Buffer.alloc(2048) });
  const result = lint({ projectDir: dir });
  assert.equal(result.errors, 0);
  assert.equal(result.files, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("flags a missing texture", () => {
  const dir = fixture(validPkg);
  const result = lint({ projectDir: dir });
  assert.ok(result.issues.some((i) => i.code === "texture-missing"));
  rmSync(dir, { recursive: true, force: true });
});

test("flags a frame count mismatch", () => {
  const broken = { ...validPkg, frames: validPkg.frames.slice(0, 3) };
  const dir = fixture(broken, { "s01/e0.png": Buffer.alloc(2048) });
  const result = lint({ projectDir: dir });
  assert.ok(result.issues.some((i) => i.code === "frame-count"));
  rmSync(dir, { recursive: true, force: true });
});

test("flags non-finite samples", () => {
  const broken = { ...validPkg, frames: Array.from({ length: 6 }, () => [[NaN, 100, 0, 1, 1]]) };
  const dir = fixture(broken, { "s01/e0.png": Buffer.alloc(2048) });
  const result = lint({ projectDir: dir });
  assert.ok(result.issues.some((i) => i.code === "nan-sample"));
  rmSync(dir, { recursive: true, force: true });
});

test("strict mode promotes warnings", () => {
  const staticPkg = { ...validPkg, frames: Array.from({ length: 6 }, () => [[100, 100, 0, 1, 1]]) };
  const dir = fixture(staticPkg, { "s01/e0.png": Buffer.alloc(2048) });
  const relaxed = lint({ projectDir: dir });
  assert.equal(relaxed.errors, 0);
  const strict = lint({ projectDir: dir, strict: true });
  assert.ok(strict.errors >= 1);
  rmSync(dir, { recursive: true, force: true });
});

test("reports a missing package", () => {
  const dir = mkdtempSync(join(tmpdir(), "domgl-"));
  mkdirSync(join(dir, "webgl", "auto"), { recursive: true });
  const result = lint({ projectDir: dir, ids: ["s99"] });
  assert.ok(result.issues.some((i) => i.code === "missing-package"));
  rmSync(dir, { recursive: true, force: true });
});
