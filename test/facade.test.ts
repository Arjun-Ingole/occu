import type {
  CallToolResult,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import type { ComputerUseBackend } from "../src/backend.js";
import {
  ComputerUseFacade,
  normalizeDispatchedMutation
} from "../src/facade.js";
import type { MutationPolicy } from "../src/policy.js";

const BACKEND_TOOL_NAMES = [
  "app",
  "see",
  "permissions",
  "click",
  "drag",
  "action",
  "press",
  "scroll",
  "set_value",
  "type"
];

class RecordingBackend implements ComputerUseBackend {
  calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];

  async connect(): Promise<void> {}

  async listTools(): Promise<Tool[]> {
    return BACKEND_TOOL_NAMES.map((name) => ({
      name,
      description: `${name} description`,
      inputSchema: {
        type: "object",
        properties: { app: { type: "string" } }
      }
    }));
  }

  async callTool(
    name: string,
    arguments_: Record<string, unknown>
  ): Promise<CallToolResult> {
    this.calls.push({ name, arguments_ });
    return {
      content: [
        { type: "text", text: "ok" },
        { type: "image", data: "aW1hZ2U=", mimeType: "image/png" }
      ]
    };
  }

  async close(): Promise<void> {}
}

class RecordingPolicy implements MutationPolicy {
  observations: Array<string | undefined> = [];
  authorizations: Array<string | undefined> = [];
  invalidations = 0;

  recordObservation(app: string | undefined): void {
    this.observations.push(app);
  }

  async authorizeMutation(explicitApp?: string): Promise<void> {
    this.authorizations.push(explicitApp);
  }

  invalidateObservation(): void {
    this.invalidations += 1;
  }
}

describe("computer-use facade", () => {
  it("renames and narrows the backend tool list", async () => {
    const facade = new ComputerUseFacade(new RecordingBackend());
    const tools = await facade.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "list_apps",
      "get_app_state",
      "permission_status",
      "click",
      "drag",
      "perform_action",
      "press_key",
      "scroll",
      "set_value",
      "type_text"
    ]);
    expect(tools[0]?.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false
    });
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[3]?.annotations?.readOnlyHint).toBe(false);
  });

  it("translates list_apps into the backend list action", async () => {
    const backend = new RecordingBackend();
    const facade = new ComputerUseFacade(backend);

    await facade.callTool("list_apps");

    expect(backend.calls).toEqual([
      { name: "app", arguments_: { action: "list" } }
    ]);
  });

  it("passes arguments and multimodal results through unchanged", async () => {
    const backend = new RecordingBackend();
    const policy = new RecordingPolicy();
    const facade = new ComputerUseFacade(backend, policy);

    const result = await facade.callTool("get_app_state", {
      app_target: "TextEdit"
    });

    expect(backend.calls).toEqual([
      { name: "see", arguments_: { app_target: "TextEdit" } }
    ]);
    expect(policy.observations).toEqual([undefined, "TextEdit"]);
    expect(result.content[1]).toMatchObject({
      type: "image",
      mimeType: "image/png"
    });
  });

  it("checks and invalidates policy context around mutations", async () => {
    const backend = new RecordingBackend();
    const policy = new RecordingPolicy();
    const facade = new ComputerUseFacade(backend, policy);

    await facade.callTool("press_key", { app: "TextEdit", keys: ["RETURN"] });

    expect(policy.authorizations).toEqual(["TextEdit"]);
    expect(policy.invalidations).toBe(1);
    expect(backend.calls[0]?.name).toBe("press");
  });

  it("invalidates policy context when mutation delivery is indeterminate", async () => {
    const backend = new RecordingBackend();
    backend.callTool = async () => {
      throw new Error("connection lost");
    };
    const policy = new RecordingPolicy();
    const facade = new ComputerUseFacade(backend, policy);

    await expect(facade.callTool("click", { on: "B1" })).rejects.toThrow(
      "connection lost"
    );
    expect(policy.invalidations).toBe(1);
  });

  it("treats a dispatched mutation as non-retryable success", () => {
    const result = normalizeDispatchedMutation({
      isError: true,
      _meta: {
        mutation_dispatched: true,
        retry_safe: false,
        state: "dispatched_unverified"
      },
      content: [{ type: "text", text: "Outcome could not be verified" }]
    });

    expect(result.isError).toBe(false);
    expect(result._meta?.state).toBe("dispatched_unverified");
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("do not retry")
    });
  });

  it("preserves refusals as errors", () => {
    const result = normalizeDispatchedMutation({
      isError: true,
      _meta: { mutation_dispatched: false, retry_safe: true },
      content: [{ type: "text", text: "Request refused" }]
    });

    expect(result.isError).toBe(true);
  });

  it("rejects tools outside the public surface", async () => {
    const facade = new ComputerUseFacade(new RecordingBackend());
    const result = await facade.callTool("shell", { command: "whoami" });

    expect(result.isError).toBe(true);
  });

  it("fails startup if the pinned backend contract changes", async () => {
    const backend = new RecordingBackend();
    backend.listTools = async () => [];
    const facade = new ComputerUseFacade(backend);

    await expect(facade.listTools()).rejects.toThrow(
      "Peekaboo backend does not expose required tool: app"
    );
  });
});
