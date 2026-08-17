import { execFile } from "node:child_process";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { resolvePeekabooCommand } from "./backend.js";
import type { PublicToolName } from "./contracts.js";

const execFileAsync = promisify(execFile);
interface Point {
  x: number;
  y: number;
}

interface ObservationState {
  elements: Map<string, Point>;
}

interface VisualizerEvent {
  id: string;
  createdAt: string;
  payload: {
    clickFeedback: {
      type: "single" | "double" | "right";
      point: [number, number];
    };
  };
}

export interface MutationVisualizer {
  recordObservation(result: CallToolResult | undefined): void;
  previewMutation(
    name: PublicToolName,
    arguments_: Record<string, unknown>
  ): Promise<void>;
}

export interface OccuVisualizerOptions {
  eventDirectory?: string;
  displayHeight?: () => Promise<number>;
  notify?: (descriptor: string) => Promise<void> | void;
}

export class OccuVisualizer implements MutationVisualizer {
  readonly #eventDirectory: string;
  readonly #displayHeight: () => Promise<number>;
  readonly #notify: (descriptor: string) => Promise<void> | void;
  #observation: ObservationState | undefined;

  constructor(options: OccuVisualizerOptions = {}) {
    this.#eventDirectory = options.eventDirectory ?? defaultEventDirectory();
    this.#displayHeight = options.displayHeight ?? primaryDisplayHeight;
    this.#notify = options.notify ?? notifyVisualizer;
  }

  recordObservation(result: CallToolResult | undefined): void {
    this.#observation = result ? parseObservation(result) : undefined;
  }

  async previewMutation(
    name: PublicToolName,
    arguments_: Record<string, unknown>
  ): Promise<void> {
    try {
      const point = mutationPoint(name, arguments_, this.#observation);
      if (!point) {
        return;
      }

      const displayHeight = await this.#displayHeight();
      const event = createClickEvent(point, displayHeight, arguments_);
      await this.#dispatch(event);
    } catch (error: unknown) {
      if (process.env.OCCU_VISUALIZER_DEBUG === "1") {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Occu visualizer skipped: ${message}`);
      }
    }
  }

  async #dispatch(event: VisualizerEvent): Promise<void> {
    await mkdir(this.#eventDirectory, { recursive: true, mode: 0o700 });
    const finalPath = join(this.#eventDirectory, `${event.id}.json`);
    const temporaryPath = `${finalPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(event)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, finalPath);
    await this.#notify(`${event.id}|clickFeedback`);

    const cleanup = setTimeout(() => {
      void unlink(finalPath).catch(() => undefined);
    }, 10_000);
    cleanup.unref();
  }
}

export function parseObservation(result: CallToolResult): ObservationState {
  const elements = new Map<string, Point>();
  for (const item of result.content) {
    if (item.type !== "text") {
      continue;
    }
    for (const line of item.text.split("\n")) {
      const match = line.match(
        /^\s*(\S+)\s+-.*?\bat \(([-\d.]+),\s*([-\d.]+)\) size ([-\d.]+)[×x]([-\d.]+)/
      );
      if (!match) {
        continue;
      }
      const [, id, x, y, width, height] = match;
      if (!id || !x || !y || !width || !height) {
        continue;
      }
      elements.set(id, {
        x: Number(x) + Number(width) / 2,
        y: Number(y) + Number(height) / 2
      });
    }
  }
  return { elements };
}

export function createClickEvent(
  point: Point,
  displayHeight: number,
  arguments_: Record<string, unknown>,
  id: string = crypto.randomUUID(),
  createdAt = new Date().toISOString()
): VisualizerEvent {
  return {
    id,
    createdAt,
    payload: {
      clickFeedback: {
        type: clickType(arguments_),
        point: [Math.round(point.x), Math.round(displayHeight - point.y)]
      }
    }
  };
}

function mutationPoint(
  name: PublicToolName,
  arguments_: Record<string, unknown>,
  observation: ObservationState | undefined
): Point | undefined {
  if (name === "drag" || name === "press_key") {
    return undefined;
  }

  const on = typeof arguments_.on === "string" ? arguments_.on.trim() : "";
  if (on) {
    const element = observation?.elements.get(on);
    if (element) {
      return element;
    }
    const coordinate = parseCoordinate(on);
    if (coordinate) {
      return coordinate;
    }
  }

  for (const key of ["coords", "at", "position"]) {
    const value = arguments_[key];
    if (typeof value === "string") {
      const coordinate = parseCoordinate(value);
      if (coordinate) {
        return coordinate;
      }
    }
  }
  return undefined;
}

function parseCoordinate(value: string): Point | undefined {
  const match = value.match(/^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

function clickType(
  arguments_: Record<string, unknown>
): "single" | "double" | "right" {
  if (arguments_.button === "right") {
    return "right";
  }
  if (arguments_.double === true || arguments_.clicks === 2 || arguments_.count === 2) {
    return "double";
  }
  return "single";
}

async function primaryDisplayHeight(): Promise<number> {
  const { stdout } = await execFileAsync(
    resolvePeekabooCommand(),
    ["screen", "list", "--json"],
    { encoding: "utf8", maxBuffer: 1024 * 1024 }
  );
  const envelope = JSON.parse(stdout) as {
    data?: {
      primaryIndex?: number;
      screens?: Array<{ bounds?: { height?: number }; index?: number; isPrimary?: boolean }>;
    };
  };
  const screens = envelope.data?.screens ?? [];
  const primary = screens.find((screen) => screen.isPrimary) ??
    screens.find((screen) => screen.index === envelope.data?.primaryIndex) ??
    screens[0];
  const height = primary?.bounds?.height;
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) {
    throw new Error("Peekaboo did not report the primary display height");
  }
  return height;
}

function defaultEventDirectory(): string {
  return join(
    homedir(),
    "Library",
    "Application Support",
    "PeekabooShared",
    "VisualizerEvents"
  );
}

async function notifyVisualizer(descriptor: string): Promise<void> {
  const { postVisualizerNotification } = await import("./macos-notification.js");
  postVisualizerNotification(descriptor);
}
