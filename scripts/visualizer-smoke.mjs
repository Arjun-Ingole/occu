import { constants } from "node:fs";
import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { postVisualizerNotification } from "../dist/src/macos-notification.js";
import {
  createMovementEvent,
  defaultVisualizerEventDirectory
} from "../dist/src/visualizer.js";

if (process.platform !== "darwin") {
  throw new Error("The visualizer smoke test only runs on macOS");
}

const eventDirectory = defaultVisualizerEventDirectory();
const id = crypto.randomUUID();
const finalPath = join(eventDirectory, `${id}.json`);
const temporaryPath = `${finalPath}.${process.pid}.tmp`;
const event = createMovementEvent(
  { x: 560, y: 440 },
  { x: 760, y: 540 },
  0.8,
  id
);

await mkdir(eventDirectory, { recursive: true, mode: 0o700 });
await writeFile(temporaryPath, `${JSON.stringify(event)}\n`, {
  encoding: "utf8",
  mode: 0o600
});
await rename(temporaryPath, finalPath);
postVisualizerNotification(`${id}|mouseMovement`);

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
