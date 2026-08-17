import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
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
  observationOnly: boolean;
  skipPermissions: boolean;
  skipOpenCodeCheck: boolean;
  skipVisualizer: boolean;
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
const COMPANION_VERSION = "4.2.0";
const COMPANION_BUNDLE_ID = "boo.peekaboo.mac";
const COMPANION_TEAM_ID = "FWJYW4S8P8";
const COMPANION_SHA256 =
  "e3d21ae9f8f146bc80051c97ac7197457bd7dabb2fef8ddafb0becdd7b2c9ce7";
const COMPANION_URL =
  `https://github.com/openclaw/Peekaboo/releases/download/v${COMPANION_VERSION}/` +
  `Peekaboo-${COMPANION_VERSION}.app.zip`;

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  await requireCommand("opencode");

  console.log("Building Occu...");
  await runChecked(process.execPath, ["run", "build"]);

  if (!options.skipVisualizer) {
    const companionPath = await ensureVisualizerCompanion();
    await enableVisualizer(companionPath);
    console.log(`Software cursor companion ready: ${companionPath}`);
  }

  const backupPath = await configureOpenCode(options.configPath);
  console.log(`Configured OpenCode: ${options.configPath}`);
  if (backupPath) {
    console.log(`Previous config backup: ${backupPath}`);
  }

  const policy = new PolicyStore();
  if (options.observationOnly) {
    await policy.clear();
  } else if (options.apps.length > 0) {
    await policy.clear();
    for (const app of options.apps) {
      await policy.allow(app);
    }
  } else {
    await policy.clear();
    await policy.allow("*");
  }
  const policyState = await policy.read();
  console.log(
    `Allowed mutation targets: ${policyState.allowedApps.join(", ") || "none (observation only)"}`
  );

  console.log("Verifying native backend contract...");
  await runChecked(process.execPath, ["scripts/backend-smoke.mjs"]);

  if (!options.skipPermissions) {
    await checkPermissions();
  }

  if (!options.skipOpenCodeCheck) {
    const result = await run("opencode", ["mcp", "list"]);
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
  if (options.observationOnly) {
    console.log("Mutations are disabled. Rerun ./setup.sh to allow every observed app.");
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
  const result = await run(peekaboo, ["permissions", "status", "--json"]);
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
    await runInherited(peekaboo, ["permissions", "request", kind]);
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
  let observationOnly = false;
  let skipPermissions = false;
  let skipOpenCodeCheck = false;
  let skipVisualizer = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--config") {
      const value = arguments_[index + 1];
      if (!value) {
        throw new Error("--config requires a path");
      }
      configPath = resolve(value);
      index += 1;
    } else if (argument === "--skip-permissions") {
      skipPermissions = true;
    } else if (argument === "--observation-only") {
      observationOnly = true;
    } else if (argument === "--skip-opencode-check") {
      skipOpenCodeCheck = true;
    } else if (argument === "--skip-visualizer") {
      skipVisualizer = true;
    } else if (argument?.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (argument) {
      apps.push(argument);
    }
  }

  if (observationOnly && apps.length > 0) {
    throw new Error("--observation-only cannot be combined with app names");
  }

  return {
    apps,
    configPath,
    observationOnly,
    skipPermissions,
    skipOpenCodeCheck,
    skipVisualizer
  };
}

function defaultOpenCodeConfigPath(): string {
  if (process.env.OPENCODE_CONFIG) {
    return resolve(process.env.OPENCODE_CONFIG);
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "opencode", "opencode.json");
}

async function ensureVisualizerCompanion(): Promise<string> {
  await requireMacOS15();
  const companionPath = process.env.OCCU_COMPANION_PATH
    ? resolve(process.env.OCCU_COMPANION_PATH)
    : join(homedir(), ".local", "share", "occu-companion", "Peekaboo.app");
  if (await isValidCompanion(companionPath)) {
    return companionPath;
  }

  console.log(`Downloading signed Peekaboo ${COMPANION_VERSION} visualizer...`);
  const parentDirectory = dirname(companionPath);
  await mkdir(parentDirectory, { recursive: true, mode: 0o700 });
  const temporaryDirectory = await mkdtemp(join(parentDirectory, ".install-"));
  const archivePath = join(temporaryDirectory, "Peekaboo.app.zip");
  const extractedPath = join(temporaryDirectory, "Peekaboo.app");
  const backupPath = `${companionPath}.previous-${process.pid}`;
  let hasBackup = false;

  try {
    await runChecked(
      "curl",
      ["-fsSL", "--retry", "3", COMPANION_URL, "-o", archivePath]
    );
    const digest = await sha256(archivePath);
    if (digest !== COMPANION_SHA256) {
      throw new Error(
        `Peekaboo archive checksum mismatch: expected ${COMPANION_SHA256}, received ${digest}`
      );
    }
    await runChecked("ditto", ["-x", "-k", archivePath, temporaryDirectory]);
    if (!(await isValidCompanion(extractedPath))) {
      throw new Error("Downloaded Peekaboo app failed signature or identity verification");
    }

    if (await pathExists(companionPath)) {
      await rename(companionPath, backupPath);
      hasBackup = true;
    }
    try {
      await rename(extractedPath, companionPath);
    } catch (error: unknown) {
      if (hasBackup) {
        await rename(backupPath, companionPath);
        hasBackup = false;
      }
      throw error;
    }
    if (hasBackup) {
      await rm(backupPath, { recursive: true, force: true });
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  return companionPath;
}

async function isValidCompanion(appPath: string): Promise<boolean> {
  if (!(await pathExists(join(appPath, "Contents", "MacOS", "Peekaboo")))) {
    return false;
  }
  const checks = await Promise.all([
    readPlistValue(appPath, "CFBundleIdentifier"),
    readPlistValue(appPath, "CFBundleShortVersionString"),
    run("codesign", ["--verify", "--deep", "--strict", appPath]),
    run("codesign", ["-dv", "--verbose=4", appPath]),
    run("spctl", ["--assess", "--type", "execute", appPath])
  ]);
  const [bundle, version, signature, details, gatekeeper] = checks;
  return (
    bundle?.exitCode === 0 &&
    bundle.stdout.trim() === COMPANION_BUNDLE_ID &&
    version?.exitCode === 0 &&
    version.stdout.trim() === COMPANION_VERSION &&
    signature?.exitCode === 0 &&
    gatekeeper?.exitCode === 0 &&
    details?.exitCode === 0 &&
    details.stderr.includes(`TeamIdentifier=${COMPANION_TEAM_ID}`)
  );
}

function readPlistValue(appPath: string, key: string): Promise<CommandResult> {
  return run("plutil", [
    "-extract",
    key,
    "raw",
    "-o",
    "-",
    join(appPath, "Contents", "Info.plist")
  ]);
}

async function enableVisualizer(companionPath: string): Promise<void> {
  await runChecked(
    "defaults",
    ["write", COMPANION_BUNDLE_ID, "peekaboo.visualizerEnabled", "-bool", "true"]
  );
  await runChecked(
    "defaults",
    ["write", COMPANION_BUNDLE_ID, "peekaboo.agentCursorEnabled", "-bool", "true"]
  );
  await runChecked(
    "defaults",
    ["write", COMPANION_BUNDLE_ID, "peekaboo.showInDock", "-bool", "false"]
  );
  const executable = join(companionPath, "Contents", "MacOS", "Peekaboo");
  if (!(await isProcessRunning(executable))) {
    const companion = spawn(executable, ["--background-bridge-host"], {
      detached: true,
      stdio: "ignore"
    });
    companion.unref();
  }
  await runChecked(process.execPath, ["scripts/visualizer-smoke.mjs"]);
}

async function isProcessRunning(executable: string): Promise<boolean> {
  const result = await run("ps", ["-axo", "command="]);
  if (result.exitCode !== 0) {
    return false;
  }
  return result.stdout.split("\n").some((command) =>
    command === executable || command.startsWith(`${executable} `)
  );
}

async function requireMacOS15(): Promise<void> {
  const result = await run("sw_vers", ["-productVersion"]);
  const major = Number.parseInt(result.stdout.split(".")[0] ?? "", 10);
  if (result.exitCode !== 0 || !Number.isFinite(major) || major < 15) {
    throw new Error("The software cursor companion requires macOS 15 or later");
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

async function requireCommand(command: string): Promise<void> {
  const result = await run(command, ["--version"]);
  if (result.exitCode !== 0) {
    throw new Error(`${command} is required but was not found in PATH`);
  }
}

async function runChecked(
  command: string,
  arguments_: string[]
): Promise<void> {
  const exitCode = await runInherited(command, arguments_);
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command} ${arguments_.join(" ")}`);
  }
}

async function runInherited(
  command: string,
  arguments_: string[]
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: projectDirectory,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise(code ?? 1));
  });
}

async function run(
  command: string,
  arguments_: string[]
): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, arguments_, {
      cwd: projectDirectory,
      stdio: ["ignore", "pipe", "pipe"]
    });
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
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Setup failed: ${message}`);
  process.exitCode = 1;
});
