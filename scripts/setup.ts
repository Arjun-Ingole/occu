import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { mergeOpenCodeConfig } from "../src/opencode-config.js";
import { PolicyStore } from "../src/policy.js";

interface SetupOptions {
  apps: string[];
  configPath: string;
  skipPermissions: boolean;
  skipOpenCodeCheck: boolean;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface PermissionStatus {
  data?: {
    permissions?: Array<{
      isGranted?: boolean;
      isRequired?: boolean;
      name?: string;
    }>;
  };
}

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  await requireCommand("opencode");

  console.log("Building Occu...");
  await runChecked(process.execPath, ["run", "build"], projectDirectory);

  const backupPath = await configureOpenCode(options.configPath);
  console.log(`Configured OpenCode: ${options.configPath}`);
  if (backupPath) {
    console.log(`Previous config backup: ${backupPath}`);
  }

  const policy = new PolicyStore();
  for (const app of options.apps) {
    await policy.allow(app);
  }
  const policyState = await policy.read();
  console.log(
    `Allowed mutation targets: ${policyState.allowedApps.join(", ") || "none (observation only)"}`
  );

  console.log("Verifying native backend contract...");
  await runChecked(process.execPath, ["scripts/backend-smoke.mjs"], projectDirectory);

  if (!options.skipPermissions) {
    await checkPermissions();
  }

  if (!options.skipOpenCodeCheck) {
    const result = await run("opencode", ["mcp", "list"], projectDirectory);
    if (result.exitCode === 0) {
      process.stdout.write(result.stdout);
    } else {
      console.warn(
        "OpenCode MCP verification could not run. The configuration was installed successfully."
      );
      if (result.stderr.trim()) {
        console.warn(result.stderr.trim());
      }
    }
  }

  console.log("\nOccu setup complete. Restart OpenCode, then run `opencode mcp list`.");
  if (options.apps.length === 0) {
    console.log("Rerun with app names to allow mutations, for example: ./setup.sh TextEdit");
  }
}

async function configureOpenCode(configPath: string): Promise<string | undefined> {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  const existing = await readOptionalFile(configPath);
  const merged = mergeOpenCodeConfig(existing ?? "{}\n", {
    bunPath: process.execPath,
    projectDirectory
  });
  if (existing === merged) {
    return undefined;
  }

  let backupPath: string | undefined;
  let fileMode = 0o600;
  if (existing !== undefined) {
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    backupPath = `${configPath}.occu-backup-${timestamp}`;
    await copyFile(configPath, backupPath);
    fileMode = (await stat(configPath)).mode & 0o777;
  }

  const temporaryPath = `${configPath}.occu-${process.pid}.tmp`;
  await writeFile(temporaryPath, merged, { encoding: "utf8", mode: fileMode });
  await rename(temporaryPath, configPath);
  await chmod(configPath, fileMode);
  return backupPath;
}

async function checkPermissions(): Promise<void> {
  const peekaboo = join(
    projectDirectory,
    "node_modules",
    "@steipete",
    "peekaboo",
    "peekaboo"
  );
  const result = await run(peekaboo, ["permissions", "status", "--json"], projectDirectory);
  if (result.exitCode !== 0) {
    console.warn("Could not inspect macOS permissions. Run `bun run permissions` manually.");
    return;
  }

  const status = JSON.parse(result.stdout) as PermissionStatus;
  const missing = (status.data?.permissions ?? []).filter(
    (permission) => permission.isRequired && !permission.isGranted
  );
  if (missing.length === 0) {
    console.log("Required macOS permissions are granted.");
    return;
  }

  for (const permission of missing) {
    const kind = permissionKind(permission.name);
    if (!kind) {
      continue;
    }
    console.log(`Requesting ${permission.name} permission...`);
    await runInherited(peekaboo, ["permissions", "request", kind], projectDirectory);
  }
  console.log(
    "Approve requested permissions in System Settings > Privacy & Security, then restart OpenCode."
  );
}

function permissionKind(name: string | undefined): string | undefined {
  switch (name) {
    case "Screen Recording":
      return "screen-recording";
    case "Accessibility":
      return "accessibility";
    default:
      return undefined;
  }
}

function parseArguments(arguments_: string[]): SetupOptions {
  const apps: string[] = [];
  let configPath = defaultOpenCodeConfigPath();
  let skipPermissions = false;
  let skipOpenCodeCheck = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help" || argument === "-h") {
      printUsage();
      process.exit(0);
    } else if (argument === "--config") {
      const value = arguments_[index + 1];
      if (!value) {
        throw new Error("--config requires a path");
      }
      configPath = resolve(value);
      index += 1;
    } else if (argument === "--skip-permissions") {
      skipPermissions = true;
    } else if (argument === "--skip-opencode-check") {
      skipOpenCodeCheck = true;
    } else if (argument?.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (argument) {
      apps.push(argument);
    }
  }

  return { apps, configPath, skipPermissions, skipOpenCodeCheck };
}

function defaultOpenCodeConfigPath(): string {
  if (process.env.OPENCODE_CONFIG) {
    return resolve(process.env.OPENCODE_CONFIG);
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "opencode", "opencode.json");
}

function printUsage(): void {
  console.log(`Usage: ./setup.sh [options] [APP ...]

Installs Occu globally as an OpenCode MCP server. Named apps are added to the
local mutation allowlist. With no apps, Occu remains observation-only.

Options:
  --config PATH             Override the OpenCode config path
  --skip-permissions        Do not inspect or request macOS permissions
  --skip-opencode-check     Do not run opencode mcp list
  -h, --help                Show this help`);
}

async function requireCommand(command: string): Promise<void> {
  const result = await run(command, ["--version"], projectDirectory);
  if (result.exitCode !== 0) {
    throw new Error(`${command} is required but was not found in PATH`);
  }
}

async function runChecked(
  command: string,
  arguments_: string[],
  cwd: string
): Promise<void> {
  const exitCode = await runInherited(command, arguments_, cwd);
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command} ${arguments_.join(" ")}`);
  }
}

async function runInherited(
  command: string,
  arguments_: string[],
  cwd: string
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise(code ?? 1));
  });
}

async function run(
  command: string,
  arguments_: string[],
  cwd: string
): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, arguments_, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      resolvePromise({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.once("exit", (code) => {
      resolvePromise({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    await access(path, constants.F_OK);
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Setup failed: ${message}`);
  process.exitCode = 1;
});

