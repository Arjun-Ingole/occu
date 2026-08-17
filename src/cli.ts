#!/usr/bin/env node

import { PeekabooBackend } from "./backend.js";
import { startOccuServer } from "./server.js";

async function main(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Occu only supports macOS");
  }

  const running = await startOccuServer(new PeekabooBackend());
  let closing = false;

  const close = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    await running.close();
    process.exitCode = 0;
  };

  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`occu-mcp: ${message}`);
  process.exitCode = 1;
});

