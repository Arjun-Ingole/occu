import { PUBLIC_TOOL_NAMES, TOOL_ROUTES } from "../dist/src/contracts.js";
import { PeekabooBackend } from "../dist/src/backend.js";

if (process.platform !== "darwin") {
  throw new Error("The Peekaboo smoke test only runs on macOS");
}

const backend = new PeekabooBackend();

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
} finally {
  await backend.close();
}

