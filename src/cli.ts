#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { transpile } from "./commands/transpile.js";
import { render } from "./commands/render.js";
import { lint } from "./commands/lint.js";

const USAGE = `domgl — DOM + GSAP to WebGL renderer

  domgl transpile <projectDir> <sceneId...> [options]
  domgl lint      <projectDir> [sceneId...] [options]
  domgl render    <projectDir> <sceneId...> --out <file> [options]

Options
  --fps <n>             sampling / encode rate (default 30)
  --max <n>             max baked elements per scene (default 40)
  --out <file>          output mp4 (render) 
  --seconds <n>         render only the first n seconds
  --bitrate <n>         video bitrate, default 9000000
  --compositions <dir>  where scene HTML lives (default compositions)
  --outdir <dir>        where packages live (default webgl/auto)
  --stage <file>        optional helper script injected before the scene
  --strict              lint: treat warnings as errors
  --json                lint: machine readable output

Examples
  domgl transpile . s14 s04
  domgl lint . --strict
  domgl render . s04 s14 --out renders/out.mp4
`;

function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags: out };
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }

  if (command === "lint") {
    const projectDir = resolve(positional[0] ?? ".");
    const ids = positional.slice(1);
    const result = lint({
      projectDir,
      ids: ids.length ? ids : undefined,
      outDir: flags.outdir,
      strict: flags.strict === "true",
    });

    if (flags.json === "true") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const issue of result.issues) {
        const mark = issue.severity === "error" ? "error" : "warn ";
        console.log(`${mark} ${issue.id}  [${issue.code}] ${issue.message}`);
      }
      console.log(
        `\n${result.files} packages · ${result.errors} errors · ${result.warnings} warnings`,
      );
    }
    if (result.errors > 0) process.exit(1);
    return;
  }

  const projectDir = resolve(positional[0] ?? ".");
  const ids = positional.slice(1);
  if (!existsSync(projectDir)) {
    console.error(`project not found: ${projectDir}`);
    process.exit(1);
  }
  if (!ids.length) {
    console.error("need at least one scene id");
    process.exit(1);
  }

  if (command === "transpile") {
    const packages = await transpile({
      projectDir,
      ids,
      fps: flags.fps ? Number(flags.fps) : undefined,
      maxElements: flags.max ? Number(flags.max) : undefined,
      compositionsDir: flags.compositions,
      stageFile: flags.stage,
      outDir: flags.outdir,
      slot: flags.slot ? Number(flags.slot) : undefined,
    });
    const total = packages.reduce((a, p) => a + p.duration, 0);
    console.log(`transpiled ${packages.length} scenes · ${total.toFixed(2)}s`);
    return;
  }

  if (command === "render") {
    const out = flags.out;
    if (!out) {
      console.error("--out is required");
      process.exit(1);
    }
    const stats = await render({
      projectDir,
      ids,
      fps: flags.fps ? Number(flags.fps) : undefined,
      seconds: flags.seconds ? Number(flags.seconds) : undefined,
      outFile: out,
      bitrate: flags.bitrate ? Number(flags.bitrate) : undefined,
      outDir: flags.outdir,
    });
    console.log(
      `rendered ${stats.frames} frames in ${stats.ms} ms ` +
        `(${((stats.frames / stats.ms) * 1000).toFixed(0)} fps) · ${(stats.bytes / 1e6).toFixed(1)} MB`,
    );
    return;
  }

  console.error(`unknown command: ${command}`);
  console.log(USAGE);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
