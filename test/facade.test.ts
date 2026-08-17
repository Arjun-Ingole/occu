import type {
  CallToolResult,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import type { ComputerUseBackend } from "../src/backend.js";
import { ComputerUseFacade } from "../src/facade.js";

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
    const facade = new ComputerUseFacade(backend);

    const result = await facade.callTool("get_app_state", { app: "TextEdit" });

    expect(backend.calls).toEqual([
      { name: "see", arguments_: { app: "TextEdit" } }
    ]);
    expect(result.content[1]).toMatchObject({
      type: "image",
      mimeType: "image/png"
    });
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
