import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { chmod, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

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

import { defaultPolicyDirectory } from "./policy.js";

const execFileAsync = promisify(execFile);
const MAX_BACKEND_BUFFER = 50 * 1024 * 1024;

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
  readonly #daemonDirectory: string;
  readonly #backendEnvironment: Record<string, string>;
  readonly #peekabooCommand: string;

  constructor(
    command: BackendCommand = resolveBackendCommand(),
    environment: NodeJS.ProcessEnv = process.env
  ) {
    const backendEnvironment = resolveBackendEnvironment(environment);
    this.#backendEnvironment = backendEnvironment;
    this.#peekabooCommand = resolvePeekabooCommand();
    this.#daemonDirectory = dirname(backendEnvironment.PEEKABOO_DAEMON_SOCKET);
    const parameters: StdioServerParameters = {
      command: command.command,
      args: command.args,
      env: backendEnvironment,
      stderr: "inherit",
      maxBufferSize: MAX_BACKEND_BUFFER
    };
    this.#transport = new StdioClientTransport(parameters);
  }

  async connect(): Promise<void> {
    await mkdir(this.#daemonDirectory, { recursive: true, mode: 0o700 });
    const directory = await stat(this.#daemonDirectory);
    if (!directory.isDirectory()) {
      throw new Error(`Peekaboo daemon parent is not a directory: ${this.#daemonDirectory}`);
    }
    const userId = process.getuid?.();
    if (userId !== undefined && directory.uid === userId) {
      await chmod(this.#daemonDirectory, 0o700);
    }
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
    if (name === "drag") {
      return this.#callCliTool(name, buildDragCliArguments(arguments_));
    }
    if (name === "action") {
      return this.#callCliTool(name, buildActionCliArguments(arguments_));
    }

    const result = await this.#client.callTool(
      { name, arguments: arguments_ },
      CallToolResultSchema
    );
    return CallToolResultSchema.parse(result);
  }

  async close(): Promise<void> {
    await this.#client.close();
  }

  async #callCliTool(
    operation: string,
    cliArguments: string[]
  ): Promise<CallToolResult> {
    let stdout: string;
    try {
      const result = await execFileAsync(this.#peekabooCommand, cliArguments, {
        env: this.#backendEnvironment,
        maxBuffer: MAX_BACKEND_BUFFER,
        encoding: "utf8"
      });
      stdout = result.stdout;
    } catch (error: unknown) {
      const output = outputFromExecError(error);
      if (!output) {
        throw error;
      }
      stdout = output;
    }
    return cliEnvelopeToToolResult(JSON.parse(stdout) as unknown, operation);
  }
}

export function resolvePeekabooCommand(): string {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("@steipete/peekaboo/package.json");
  return join(dirname(packagePath), "peekaboo");
}

export function buildDragCliArguments(
  arguments_: Record<string, unknown>
): string[] {
  if (arguments_.foreground !== true) {
    throw new Error("Drag requires foreground=true");
  }

  const from = oneStringArgument(arguments_, "from", "from_coords");
  const to = oneStringArgument(arguments_, "to", "to_coords", true);
  const toApp = optionalString(arguments_.to_app);
  if (!to && !toApp) {
    throw new Error("Drag requires to, to_coords, or to_app");
  }

  const result = ["drag", "--from", from];
  if (to) {
    result.push("--to", to);
  }
  if (toApp) {
    result.push("--to-app", toApp);
  }
  appendOption(result, "--snapshot", arguments_.snapshot);
  appendOption(result, "--duration", arguments_.duration);
  appendOption(result, "--steps", arguments_.steps);
  appendOption(result, "--modifiers", arguments_.modifiers);
  appendOption(result, "--button", arguments_.button);
  appendOption(result, "--profile", arguments_.profile);
  result.push("--foreground", "--no-remote", "--json");
  return result;
}

export function buildActionCliArguments(
  arguments_: Record<string, unknown>
): string[] {
  const action = optionalString(arguments_.action);
  const on = optionalString(arguments_.on);
  if (!action || !on) {
    throw new Error("Action requires nonempty action and on arguments");
  }
  const result = ["action", "--action", action, "--on", on];
  appendOption(result, "--snapshot", arguments_.snapshot);
  result.push("--foreground", "--no-remote", "--json");
  return result;
}

export function cliEnvelopeToToolResult(
  value: unknown,
  operation: string
): CallToolResult {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new Error(`Peekaboo ${operation} returned an invalid JSON envelope`);
  }

  const outcome = isRecord(value.outcome) ? value.outcome : undefined;
  if (value.success) {
    return {
      isError: false,
      _meta: outcome,
      content: [
        {
          type: "text",
          text:
            `Peekaboo ${operation} dispatched successfully. ` +
            "Observe the target before continuing."
        }
      ],
      ...(isRecord(value.data) ? { structuredContent: value.data } : {})
    };
  }

  const error = isRecord(value.error) ? value.error : {};
  const message = typeof error.message === "string"
    ? error.message
    : `Peekaboo ${operation} failed`;
  const hint = typeof error.hint === "string" ? ` ${error.hint}` : "";
  return {
    isError: true,
    _meta: outcome,
    content: [{ type: "text", text: `${message}${hint}` }]
  };
}

function oneStringArgument(
  arguments_: Record<string, unknown>,
  first: string,
  second: string,
  optional = false
): string {
  const firstValue = optionalString(arguments_[first]);
  const secondValue = optionalString(arguments_[second]);
  if (firstValue && secondValue) {
    throw new Error(`Drag accepts only one of ${first} or ${second}`);
  }
  if (!firstValue && !secondValue && !optional) {
    throw new Error(`Drag requires ${first} or ${second}`);
  }
  return firstValue ?? secondValue ?? "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function appendOption(arguments_: string[], flag: string, value: unknown): void {
  if (typeof value === "string" || typeof value === "number") {
    arguments_.push(flag, String(value));
  }
}

function outputFromExecError(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  return typeof error.stdout === "string" && error.stdout.trim()
    ? error.stdout
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveBackendEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): Record<string, string> & { PEEKABOO_DAEMON_SOCKET: string } {
  const inherited = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
  const socketPath = environment.OCCU_PEEKABOO_DAEMON_SOCKET
    ?? join(defaultPolicyDirectory(environment), "peekaboo-daemon.sock");
  return {
    ...inherited,
    PEEKABOO_DAEMON_SOCKET: socketPath
  };
}
