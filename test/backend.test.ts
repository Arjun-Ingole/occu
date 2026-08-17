import { describe, expect, it } from "vitest";

import {
  buildActionCliArguments,
  buildDragCliArguments,
  cliEnvelopeToToolResult,
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

  it("builds a foreground-only local drag command", () => {
    expect(buildDragCliArguments({
      foreground: true,
      from_coords: "100,200",
      to_coords: "300,400",
      snapshot: "fresh-snapshot",
      duration: 300,
      steps: 12
    })).toEqual([
      "drag",
      "--from",
      "100,200",
      "--to",
      "300,400",
      "--snapshot",
      "fresh-snapshot",
      "--duration",
      "300",
      "--steps",
      "12",
      "--foreground",
      "--no-remote",
      "--json"
    ]);
  });

  it("builds a local accessibility action command", () => {
    expect(buildActionCliArguments({
      action: "AXPress",
      on: "elem_4",
      snapshot: "fresh-snapshot"
    })).toEqual([
      "action",
      "--action",
      "AXPress",
      "--on",
      "elem_4",
      "--snapshot",
      "fresh-snapshot",
      "--foreground",
      "--no-remote",
      "--json"
    ]);
  });

  it("rejects drag without explicit foreground consent", () => {
    expect(() => buildDragCliArguments({
      from_coords: "100,200",
      to_coords: "300,400"
    })).toThrow("foreground=true");
  });

  it("translates Peekaboo CLI envelopes into MCP results", () => {
    const result = cliEnvelopeToToolResult({
      success: true,
      data: { from: { x: 100, y: 200 } },
      outcome: { mutation_dispatched: true, retry_safe: false }
    }, "drag");

    expect(result.isError).toBe(false);
    expect(result._meta?.mutation_dispatched).toBe(true);
    expect(result.structuredContent).toEqual({ from: { x: 100, y: 200 } });
  });
});
