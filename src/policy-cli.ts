#!/usr/bin/env node

import { PolicyStore, type PolicyState } from "./policy.js";

async function main(arguments_: string[] = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = arguments_;
  const store = new PolicyStore();

  switch (command) {
    case "allow":
      printState(await store.allow(rest.join(" ")));
      break;
    case "deny":
      printState(await store.deny(rest.join(" ")));
      break;
    case "stop":
      printState(await store.stop());
      break;
    case "resume":
      printState(await store.resume());
      break;
    case "list":
    case "status":
      printState(await store.read());
      break;
    default:
      throw new Error(
        "Usage: occu <allow APP | deny APP | list | status | stop | resume>"
      );
  }
}

function printState(state: PolicyState): void {
  console.log(`Mutations: ${state.stopped ? "stopped" : "enabled"}`);
  console.log(
    `Allowed apps: ${state.allowedApps.length > 0 ? state.allowedApps.join(", ") : "none"}`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`occu: ${message}`);
  process.exitCode = 1;
});

