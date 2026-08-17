import type {
  CallToolResult,
  Tool
} from "@modelcontextprotocol/sdk/types.js";

import type { ComputerUseBackend } from "./backend.js";
import {
  PUBLIC_TOOL_NAMES,
  TOOL_ROUTES,
  isPublicToolName,
  type PublicToolName
} from "./contracts.js";

const EMPTY_OBJECT_SCHEMA: Tool["inputSchema"] = {
  type: "object",
  properties: {},
  additionalProperties: false
};

const TOOL_DESCRIPTIONS: Partial<Record<PublicToolName, string>> = {
  list_apps: "List running macOS applications and their process identifiers.",
  get_app_state:
    "Observe a macOS application. Returns its screenshot, accessibility tree, and a snapshot ID for grounded actions.",
  permission_status:
    "Report Screen Recording, Accessibility, and event-synthesis permissions.",
  type_text: "Type text into the selected macOS control.",
  press_key: "Press a key or keyboard shortcut in a macOS application.",
  perform_action:
    "Perform an accessibility action such as press, increment, decrement, or confirm."
};

export class ComputerUseFacade {
  constructor(private readonly backend: ComputerUseBackend) {}

  async listTools(): Promise<Tool[]> {
    const backendTools = await this.backend.listTools();
    const byName = new Map(backendTools.map((tool) => [tool.name, tool]));

    return PUBLIC_TOOL_NAMES.map((publicName) => {
      const route = TOOL_ROUTES[publicName];
      const backendTool = byName.get(route.backend);
      if (!backendTool) {
        throw new Error(`Peekaboo backend does not expose required tool: ${route.backend}`);
      }

      return {
        ...backendTool,
        name: publicName,
        description: TOOL_DESCRIPTIONS[publicName] ?? backendTool.description,
        inputSchema:
          publicName === "list_apps" ? EMPTY_OBJECT_SCHEMA : backendTool.inputSchema,
        annotations: {
          ...backendTool.annotations,
          readOnlyHint: !route.mutates
        }
      };
    });
  }

  async callTool(
    name: string,
    arguments_: Record<string, unknown> = {}
  ): Promise<CallToolResult> {
    if (!isPublicToolName(name)) {
      return errorResult(`Unknown Occu tool: ${name}`);
    }

    const route = TOOL_ROUTES[name];
    const backendArguments =
      name === "list_apps" ? { action: "list" } : arguments_;

    return this.backend.callTool(route.backend, backendArguments);
  }
}

export function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }]
  };
}

