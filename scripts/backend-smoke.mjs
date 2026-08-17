import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PUBLIC_TOOL_NAMES, TOOL_ROUTES } from "../dist/src/contracts.js";
import { PeekabooBackend } from "../dist/src/backend.js";

if (process.platform !== "darwin") {
  throw new Error("The Peekaboo smoke test only runs on macOS");
}

const backend = new PeekabooBackend();
const capturePath = join(tmpdir(), `occu-backend-smoke-${process.pid}.png`);

try {
  await backend.connect();
  const tools = await backend.listTools();
  const names = new Set(tools.map((tool) => tool.name));
  const missing = PUBLIC_TOOL_NAMES
    .map((name) => TOOL_ROUTES[name].backend)
    .filter((name) => !names.has(name));

  if (missing.length > 0) {
    throw new Error(`Peekaboo is missing required tools: ${missing.join(", ")}`);
  }

  console.log(
    `Peekaboo contract OK: ${tools.length} backend tools, ${PUBLIC_TOOL_NAMES.length} exposed by Occu.`
  );

  const permissions = await backend.callTool("permissions", {});
  if (permissions.isError) {
    console.log("Capture smoke skipped until required macOS permissions are granted.");
  } else {
    const observation = await backend.callTool("see", {
      app_target: "screen:0",
      path: capturePath
    });
    if (observation.isError) {
      const detail = observation.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      throw new Error(`Peekaboo capture smoke failed: ${detail}`);
    }
    if (!observation.content.some((item) => item.type === "image")) {
      throw new Error("Peekaboo capture smoke did not return an MCP image block");
    }
    console.log("Peekaboo capture OK: screenshot and accessibility snapshot returned.");
  }
} finally {
  await backend.close();
  await rm(capturePath, { force: true });
}
