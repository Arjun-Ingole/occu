import { describe, expect, it } from "vitest";

import {
  resolveBackendCommand,
  resolveBackendEnvironment
} from "../src/backend.js";

describe("Peekaboo backend configuration", () => {
  it("uses an Occu-owned daemon socket instead of an ambient Peekaboo socket", () => {
    const environment = resolveBackendEnvironment({
      OCCU_POLICY_DIR: "/tmp/occu-test-policy",
      PEEKABOO_DAEMON_SOCKET: "/tmp/ambient-peekaboo.sock"
    });

    expect(environment.PEEKABOO_DAEMON_SOCKET).toBe(
      "/tmp/occu-test-policy/peekaboo-daemon.sock"
    );
  });

  it("supports an explicit Occu socket override", () => {
    const environment = resolveBackendEnvironment({
      OCCU_PEEKABOO_DAEMON_SOCKET: "/tmp/custom-occu.sock"
    });

    expect(environment.PEEKABOO_DAEMON_SOCKET).toBe("/tmp/custom-occu.sock");
  });

  it("validates custom backend argument arrays", () => {
    expect(() =>
      resolveBackendCommand({
        OCCU_BACKEND_COMMAND: "/usr/bin/false",
        OCCU_BACKEND_ARGS: "not-json"
      })
    ).toThrow();
  });
});

