import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { postVisualizerNotification } from "../dist/src/macos-notification.js";

const execFileAsync = promisify(execFile);

if (process.platform !== "darwin") {
  throw new Error("The visualizer smoke test only runs on macOS");
}

const eventDirectory = process.env.OCCU_VISUALIZER_EVENT_DIR ?? join(
  homedir(),
  "Library",
  "Application Support",
  "PeekabooShared",
  "VisualizerEvents"
);
const id = crypto.randomUUID();
const finalPath = join(eventDirectory, `${id}.json`);
const temporaryPath = `${finalPath}.${process.pid}.tmp`;
const event = {
  id,
  createdAt: new Date().toISOString(),
  payload: {
    mouseMovement: {
      duration: 0.8,
      from: [560, 440],
      to: [760, 540]
    }
  }
};

await mkdir(eventDirectory, { recursive: true, mode: 0o700 });
await writeFile(temporaryPath, `${JSON.stringify(event)}\n`, {
  encoding: "utf8",
  mode: 0o600
});
await rename(temporaryPath, finalPath);
postVisualizerNotification(`${id}|mouseMovement`);

if (process.env.OCCU_VISUALIZER_SCREENSHOT) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  await execFileAsync("screencapture", ["-x", process.env.OCCU_VISUALIZER_SCREENSHOT]);
}

const deadline = Date.now() + 5_000;
while (Date.now() < deadline && await pathExists(finalPath)) {
  postVisualizerNotification(`${id}|mouseMovement`);
  await new Promise((resolve) => setTimeout(resolve, 50));
}

if (await pathExists(finalPath)) {
  await unlink(finalPath).catch(() => undefined);
  throw new Error(
    "Peekaboo did not consume the software cursor event. Quit Peekaboo and rerun setup."
  );
}

console.log("Software cursor event reached the Peekaboo renderer.");

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
