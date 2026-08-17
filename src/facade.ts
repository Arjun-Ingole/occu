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
import { OccuVisualizer, type MutationVisualizer } from "./visualizer.js";

const EMPTY_OBJECT_SCHEMA: Tool["inputSchema"] = {
  type: "object",
  properties: {},
  additionalProperties: false
};

const SNAPSHOT_PROPERTY = {
  type: "string",
  minLength: 1,
  description: "Snapshot ID from the latest get_app_state result."
} as const;

const ELEMENT_PROPERTY = {
  type: "string",
  minLength: 1,
  description: "Actionable element ID from the latest get_app_state result."
} as const;

const PUBLIC_INPUT_SCHEMAS: Record<PublicToolName, Tool["inputSchema"]> = {
  list_apps: EMPTY_OBJECT_SCHEMA,
  open_app: {
    type: "object",
    properties: {
      app: {
        type: "string",
        minLength: 1,
        description: "Application name or bundle ID."
      }
    },
    required: ["app"],
    additionalProperties: false
  },
  get_app_state: {
    type: "object",
    properties: {
      app_target: {
        type: "string",
        minLength: 1,
        description: "Exact application name, bundle ID, or PID:<number>."
      },
      annotate: {
        type: "boolean",
        default: false,
        description: "Add element markers to the screenshot."
      },
      ocr: {
        type: "boolean",
        default: false,
        description: "Recognize visible text that is absent from accessibility data."
      }
    },
    required: ["app_target"],
    additionalProperties: false
  },
  permission_status: EMPTY_OBJECT_SCHEMA,
  click: {
    type: "object",
    properties: {
      snapshot: SNAPSHOT_PROPERTY,
      on: ELEMENT_PROPERTY,
      coords: {
        type: "string",
        minLength: 3,
        pattern: "^-?[0-9]+(?:\\.[0-9]+)?,-?[0-9]+(?:\\.[0-9]+)?$",
        description: "Screenshot coordinate like 450,300. Do not include brackets."
      },
      double: { type: "boolean", default: false },
      right: { type: "boolean", default: false }
    },
    required: ["snapshot"],
    additionalProperties: false,
    oneOf: [
      { required: ["on"], not: { required: ["coords"] } },
      { required: ["coords"], not: { required: ["on"] } }
    ]
  },
  drag: {
    type: "object",
    properties: {
      snapshot: SNAPSHOT_PROPERTY,
      from: { ...ELEMENT_PROPERTY, description: "Starting actionable element ID." },
      from_coords: {
        type: "string",
        minLength: 3,
        pattern: "^-?[0-9]+(?:\\.[0-9]+)?,-?[0-9]+(?:\\.[0-9]+)?$",
        description: "Starting coordinate like 100,200."
      },
      to: { ...ELEMENT_PROPERTY, description: "Destination actionable element ID." },
      to_coords: {
        type: "string",
        minLength: 3,
        pattern: "^-?[0-9]+(?:\\.[0-9]+)?,-?[0-9]+(?:\\.[0-9]+)?$",
        description: "Destination coordinate like 300,400."
      },
      duration: { type: "integer", minimum: 100, default: 500 },
      steps: { type: "integer", minimum: 2, default: 10 },
      button: { type: "string", enum: ["left", "right"], default: "left" }
    },
    required: ["snapshot"],
    additionalProperties: false,
    allOf: [
      { oneOf: [{ required: ["from"] }, { required: ["from_coords"] }] },
      { oneOf: [{ required: ["to"] }, { required: ["to_coords"] }] }
    ]
  },
  perform_action: {
    type: "object",
    properties: {
      snapshot: SNAPSHOT_PROPERTY,
      on: ELEMENT_PROPERTY,
      action: {
        type: "string",
        minLength: 1,
        description: "Supported accessibility action listed for the element."
      }
    },
    required: ["snapshot", "on", "action"],
    additionalProperties: false
  },
  press_key: {
    type: "object",
    properties: {
      snapshot: SNAPSHOT_PROPERTY,
      key: {
        type: "string",
        minLength: 1,
        description: "Single key such as Return, Escape, or Backspace."
      },
      keys: {
        type: "array",
        minItems: 1,
        items: { type: "string", minLength: 1 },
        description: "Shortcut or key sequence, such as [\"cmd+a\"]."
      },
      modifiers: {
        type: "array",
        items: {
          type: "string",
          enum: ["cmd", "shift", "option", "ctrl", "fn"]
        }
      },
      count: { type: "integer", minimum: 1, maximum: 100, default: 1 }
    },
    required: ["snapshot"],
    additionalProperties: false,
    oneOf: [
      { required: ["key"], not: { required: ["keys"] } },
      { required: ["keys"], not: { required: ["key"] } }
    ]
  },
  scroll: {
    type: "object",
    properties: {
      snapshot: SNAPSHOT_PROPERTY,
      on: ELEMENT_PROPERTY,
      direction: {
        type: "string",
        enum: ["up", "down", "left", "right"]
      },
      amount: { type: "integer", minimum: 1, default: 3 }
    },
    required: ["snapshot", "on", "direction"],
    additionalProperties: false
  },
  set_value: {
    type: "object",
    properties: {
      snapshot: SNAPSHOT_PROPERTY,
      on: ELEMENT_PROPERTY,
      value: {
        description: "New accessibility value.",
        anyOf: [
          { type: "string" },
          { type: "boolean" },
          { type: "number" }
        ]
      }
    },
    required: ["snapshot", "on", "value"],
    additionalProperties: false
  },
  type_text: {
    type: "object",
    properties: {
      snapshot: SNAPSHOT_PROPERTY,
      text: { type: "string", description: "Text to type." },
      on: {
        ...ELEMENT_PROPERTY,
        description: "Optional text element ID. Omit it to type into the active control."
      },
      clear: {
        type: "boolean",
        default: false,
        description: "Select and remove existing text before typing."
      }
    },
    required: ["snapshot", "text"],
    additionalProperties: false
  }
};

const TOOL_DESCRIPTIONS: Record<PublicToolName, string> = {
  list_apps: "List running macOS applications and their process identifiers.",
  open_app: "Launch or activate a macOS application.",
  get_app_state:
    "Observe one macOS application. Returns a screenshot, accessibility data, and the snapshot ID required by actions.",
  permission_status:
    "Report Screen Recording, Accessibility, and event-synthesis permissions.",
  click: "Click an actionable element or screenshot coordinate from the latest observation.",
  drag: "Drag between grounded elements or coordinates.",
  perform_action: "Run an accessibility action on an observed element.",
  press_key: "Press a key or shortcut in the window from the latest observation.",
  scroll: "Scroll an observed element in the requested direction.",
  set_value: "Set the value of an observed accessibility element.",
  type_text:
    "Type directly into the observed window. Use on for a text element; otherwise omit on. Do not click first."
};

export class ComputerUseFacade {
  constructor(
    private readonly backend: ComputerUseBackend,
    private readonly policy: MutationPolicy = new LocalMutationPolicy(),
    private readonly visualizer: MutationVisualizer = new OccuVisualizer()
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
        description: TOOL_DESCRIPTIONS[publicName],
        inputSchema: PUBLIC_INPUT_SCHEMAS[publicName],
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
        if (name === "open_app") {
          await this.policy.authorizeApp(explicitApp);
        } else {
          await this.policy.authorizeMutation(explicitApp);
        }
        await this.visualizer.previewMutation(name, arguments_);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(message);
      }
    }

    const backendArguments = canonicalizeBackendArguments(name, arguments_);
    if (name === "get_app_state") {
      this.policy.recordObservation(undefined);
      this.visualizer.recordObservation(undefined);
    }

    let result: CallToolResult;
    try {
      result = await this.backend.callTool(route.backend, backendArguments);
    } catch (error: unknown) {
      if (route.mutates) {
        this.policy.invalidateObservation();
      }
      throw error;
    }
    if (route.mutates && shouldInvalidateObservation(result)) {
      this.policy.invalidateObservation();
    }

    if (name === "get_app_state") {
      result = addTypingGuidance(result);
      const app = typeof arguments_.app_target === "string"
        ? arguments_.app_target
        : undefined;
      this.policy.recordObservation(result.isError ? undefined : app);
      this.visualizer.recordObservation(result.isError ? undefined : result);
    }

    return route.mutates ? normalizeDispatchedMutation(result) : result;
  }
}

export function canonicalizeBackendArguments(
  name: PublicToolName,
  arguments_: Record<string, unknown>
): Record<string, unknown> {
  if (name === "list_apps") {
    return { action: "list" };
  }
  if (name === "open_app") {
    return {
      action: "launch",
      name: arguments_.app
    };
  }
  if (name === "drag") {
    return { ...arguments_, foreground: true };
  }
  return arguments_;
}

export function addTypingGuidance(result: CallToolResult): CallToolResult {
  if (result.isError || result.content.some((item) =>
    item.type === "text" && /AX(?:TextArea|TextField|SearchField)/.test(item.text)
  )) {
    return result;
  }

  return {
    ...result,
    content: [
      ...result.content,
      {
        type: "text",
        text:
          "No text element is exposed. To type into the active editor, call " +
          "type_text with this snapshot and omit on. Do not click first."
      }
    ]
  };
}

function shouldInvalidateObservation(result: CallToolResult): boolean {
  return !(
    result.isError === true &&
    result._meta?.mutation_dispatched === false &&
    result._meta?.retry_safe === true
  );
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
        text: "Action sent. Observe the app before the next action."
      }
    ]
  };
}

export function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }]
  };
}
