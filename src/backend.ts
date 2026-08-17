import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  CallToolResult,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

export interface ComputerUseBackend {
  connect(): Promise<void>;
  listTools(): Promise<Tool[]>;
  callTool(name: string, arguments_: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

export interface BackendCommand {
  command: string;
  args: string[];
}

export function resolveBackendCommand(
  environment: NodeJS.ProcessEnv = process.env
): BackendCommand {
  if (environment.OCCU_BACKEND_COMMAND) {
    return {
      command: environment.OCCU_BACKEND_COMMAND,
      args: parseBackendArguments(environment.OCCU_BACKEND_ARGS)
    };
  }

  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("@steipete/peekaboo/package.json");
  return {
    command: join(dirname(packagePath), "peekaboo"),
    args: ["mcp", "serve"]
  };
}

function parseBackendArguments(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("OCCU_BACKEND_ARGS must be a JSON array of strings");
  }
  return parsed;
}

export class PeekabooBackend implements ComputerUseBackend {
  readonly #client = new Client(
    { name: "occu-backend-client", version: "0.1.0" },
    { capabilities: {} }
  );
  readonly #transport: StdioClientTransport;

  constructor(command: BackendCommand = resolveBackendCommand()) {
    const parameters: StdioServerParameters = {
      command: command.command,
      args: command.args,
      env: process.env as Record<string, string>,
      stderr: "inherit",
      maxBufferSize: 50 * 1024 * 1024
    };
    this.#transport = new StdioClientTransport(parameters);
  }

  async connect(): Promise<void> {
    await this.#client.connect(this.#transport);
  }

  async listTools(): Promise<Tool[]> {
    const response = await this.#client.listTools();
    return response.tools;
  }

  async callTool(
    name: string,
    arguments_: Record<string, unknown>
  ): Promise<CallToolResult> {
    const result = await this.#client.callTool(
      { name, arguments: arguments_ },
      CallToolResultSchema
    );
    return CallToolResultSchema.parse(result);
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}
