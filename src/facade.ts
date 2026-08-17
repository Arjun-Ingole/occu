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
import { LocalMutationPolicy, type MutationPolicy } from "./policy.js";

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
  constructor(
    private readonly backend: ComputerUseBackend,
    private readonly policy: MutationPolicy = new LocalMutationPolicy()
  ) {}

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
    if (route.mutates) {
      const explicitApp = typeof arguments_.app === "string" ? arguments_.app : undefined;
      try {
        await this.policy.authorizeMutation(explicitApp);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(message);
      }
    }

    const backendArguments =
      name === "list_apps" ? { action: "list" } : arguments_;
    if (name === "get_app_state") {
      this.policy.recordObservation(undefined);
    }

    let result: CallToolResult;
    try {
      result = await this.backend.callTool(route.backend, backendArguments);
    } finally {
      if (route.mutates) {
        this.policy.invalidateObservation();
      }
    }

    if (name === "get_app_state") {
      const app = typeof arguments_.app_target === "string"
        ? arguments_.app_target
        : undefined;
      this.policy.recordObservation(result.isError ? undefined : app);
    }

    return route.mutates ? normalizeDispatchedMutation(result) : result;
  }
}

export function normalizeDispatchedMutation(result: CallToolResult): CallToolResult {
  if (!result.isError || result._meta?.mutation_dispatched !== true) {
    return result;
  }

  return {
    ...result,
    isError: false,
    content: [
      {
        type: "text",
        text:
          "Mutation dispatched, but its effect was not independently verified. " +
          "Observe the target before continuing; do not retry from this result alone."
      },
      ...result.content
    ]
  };
}

export function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }]
  };
}
