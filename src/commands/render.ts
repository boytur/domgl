import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderOptions } from "../types.js";
import { launchBrowser } from "../lib/browser.js";
import { serve } from "../lib/http.js";

/** Renders transpiled scene packages to MP4 with hardware H.264 (WebCodecs). */
export async function render(options: RenderOptions): Promise<{ bytes: number; frames: number; ms: number }> {
  const projectDir = resolve(options.projectDir);
  const fps = options.fps ?? 30;
  const server = await serve(projectDir);
  const browser = await launchBrowser({ gpu: true });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

    const parts: Buffer[] = [];
    await page.exposeFunction("__sink", (index: number, b64: string) => {
      parts[index] = Buffer.from(b64, "base64");
    });

    // dist/web/player.html sits next to the compiled command, but is served from the
    // project root so it can read webgl/auto/*.
    const playerPath = fileURLToPath(new URL("../web/player.html", import.meta.url));
    const { copyFileSync, mkdirSync } = await import("node:fs");
    const servedDir = resolve(projectDir, ".domgl");
    mkdirSync(servedDir, { recursive: true });
    copyFileSync(playerPath, resolve(servedDir, "player.html"));

    await page.goto(
      `${server.url}/.domgl/player.html?base=${encodeURIComponent(options.outDir ?? "webgl/auto")}`,
      { waitUntil: "load", timeout: 60_000 },
    );
    const total = await page.evaluate((ids: string[]) => {
      const w = window as unknown as { __load(ids: string[]): Promise<number> };
      return w.__load(ids);
    }, options.ids);

    const seconds = options.seconds ?? total;
    const stats = (await page.evaluate(
      (fpsArg: number, secs: number, bitrate: number) => {
        const w = window as unknown as {
          __renderMp4(fps: number, seconds: number, bitrate: number): Promise<{
            frames: number;
            ms: number;
            bytes: number;
            encoded: number;
            streamed?: boolean;
          }>;
        };
        return w.__renderMp4(fpsArg, secs, bitrate);
      },
      fps,
      seconds,
      options.bitrate ?? 9_000_000,
    )) as { frames: number; ms: number; bytes: number; encoded: number; streamed?: boolean };

    if (stats.streamed) {
      writeFileSync(resolve(options.outFile), Buffer.concat(parts));
    }

    await page.close();
    return { bytes: stats.bytes, frames: stats.frames, ms: stats.ms };
  } finally {
    await browser.close();
    await server.close();
  }
}
