import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

export interface LaunchOptions {
  headless?: boolean;
  gpu?: boolean;
  width?: number;
  height?: number;
}

const require = createRequire(import.meta.url);

/** Finds a Chrome/Chromium binary without hard-coding one machine's path. */
export function findChrome(): string {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const candidates: string[] = [];
  const local = process.env.LOCALAPPDATA;
  const home = homedir();

  if (local) {
    const pw = join(local, "ms-playwright");
    if (existsSync(pw)) {
      for (const dir of readdirSync(pw).sort().reverse()) {
        candidates.push(join(pw, dir, "chrome-win64", "chrome.exe"));
        candidates.push(join(pw, dir, "chrome-win", "chrome.exe"));
        candidates.push(join(pw, dir, "chrome-linux", "chrome"));
      }
    }
  }

  const hf = join(home, ".cache", "hyperframes", "chrome");
  if (existsSync(hf)) {
    walk(hf, candidates, 4);
  }

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      "No Chrome found. Set CHROME_PATH to a chrome.exe / chrome-headless-shell binary.",
    );
  }
  return found;
}

function walk(dir: string, out: string[], depth: number): void {
  if (depth <= 0) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (name === "chrome.exe" || name === "chrome-headless-shell.exe" || name === "chrome") {
      out.push(p);
      continue;
    }
    walk(p, out, depth - 1);
  }
}

export function loadPuppeteer(): typeof import("puppeteer-core") {
  try {
    return require("puppeteer-core");
  } catch {
    throw new Error("puppeteer-core is not installed. Run `npm install` in packages/renderer.");
  }
}

export async function launchBrowser(options: LaunchOptions = {}) {
  const puppeteer = loadPuppeteer();
  const args = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--window-size=${options.width ?? 1080},${options.height ?? 1920}`,
  ];

  if (options.gpu) {
    args.push("--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist");
  } else {
    args.push("--disable-gpu");
  }

  return puppeteer.launch({
    executablePath: findChrome(),
    headless: options.headless === false ? false : true,
    args,
  });
}
