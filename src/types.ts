/** Shared types for the bake → transpile → render pipeline. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One painted element discovered in a scene's DOM. */
export interface ElementSpec extends Rect {
  /** stable index inside the scene, also the texture filename */
  i: number;
  tag: string;
  cls: string;
  z: number;
  /** relative path to the baked PNG, e.g. "s14/e3.png" */
  tex: string;
  /** padding used when the texture was clipped, in scene px */
  pad: number;
}

/** Per frame, per element: [x, y, rotationRad, scale, opacity] */
export type Sample = [number, number, number, number, number];

export interface ScenePackage {
  id: string;
  fps: number;
  duration: number;
  width: number;
  height: number;
  elements: ElementSpec[];
  /** frames[frameIndex][elementIndex] */
  frames: (Sample | null)[][];
}

export interface TranspileOptions {
  /** project root that contains the compositions */
  projectDir: string;
  /** scene ids, e.g. ["s14"] */
  ids: string[];
  /** where the composition HTML lives, relative to projectDir (default "compositions") */
  compositionsDir?: string;
  /** optional helper injected before the scene (e.g. a stage/camera helper) */
  stageFile?: string;
  /** frames per second used when sampling the timeline */
  fps?: number;
  /** hard cap on baked elements per scene */
  maxElements?: number;
  /** output dir, relative to projectDir */
  outDir?: string;
}

export interface LintOptions {
  projectDir: string;
  /** where the transpiled packages live (default "webgl/auto") */
  outDir?: string;
  /** only lint these ids; default = every *.json in outDir */
  ids?: string[];
  /** treat warnings as errors */
  strict?: boolean;
}

export type Severity = "error" | "warning";

export interface LintIssue {
  id: string;
  severity: Severity;
  code: string;
  message: string;
}

export interface LintResult {
  files: number;
  errors: number;
  warnings: number;
  issues: LintIssue[];
}

export interface RenderOptions {
  projectDir: string;
  /** scene packages to play, in order */
  ids: string[];
  fps?: number;
  /** seconds to render; defaults to the total of the scene durations */
  seconds?: number;
  outFile: string;
  bitrate?: number;
  /** where the transpiled packages live (default "webgl/auto") */
  outDir?: string;
}

export interface ChromeLocation {
  executablePath: string;
}
