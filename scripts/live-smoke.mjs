import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const execFileAsync = promisify(execFile);
const APP_NAME = "OccuFixtureApp";
const FIXTURE_SOURCE = join(process.cwd(), "test", "fixtures", "OccuFixtureApp.swift");

if (process.platform !== "darwin") {
  throw new Error("The live MCP smoke test only runs on macOS");
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "occu-live-smoke-"));
const fixturePath = join(temporaryDirectory, APP_NAME);
const policyDirectory = join(temporaryDirectory, "policy");
let fixture;
let client;

try {
  await execFileAsync("xcrun", [
    "swiftc",
    "-framework",
    "AppKit",
    FIXTURE_SOURCE,
    "-o",
    fixturePath
  ]);
  fixture = spawn(fixturePath, [], { stdio: "ignore" });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist", "src", "cli.js")],
    env: {
      ...process.env,
      OCCU_ALLOWED_APPS: "*",
      OCCU_POLICY_DIR: policyDirectory
    },
    stderr: "pipe"
  });
  transport.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  client = new Client(
    { name: "occu-live-smoke", version: "0.1.0" },
    { capabilities: {} }
  );
  await client.connect(transport);

  const listedTools = await client.listTools();
  const toolNames = listedTools.tools.map((tool) => tool.name).sort();
  assert(
    toolNames.join(",") === [
      "click",
      "drag",
      "get_app_state",
      "list_apps",
      "perform_action",
      "permission_status",
      "press_key",
      "scroll",
      "set_value",
      "type_text"
    ].sort().join(","),
    `Unexpected public tool list: ${toolNames.join(", ")}`
  );

  const apps = await waitForFixture();
  assert(textContent(apps).includes(APP_NAME), "Fixture app was not listed");
  console.log("[ok] list_apps");

  const permissions = await call("permission_status", {});
  assert(
    permissions._meta?.required_permissions_granted === true,
    "Required macOS permissions are not granted"
  );
  console.log("[ok] permission_status");

  const initial = await observe();
  assert(initial.result.content.some((item) => item.type === "image"), "Observation omitted image data");
  assert(initial.text.includes("Counter: 0"), "Fixture did not start in its expected state");
  console.log("[ok] get_app_state");

  await mutate("click", (state) => ({
    on: state.element("occu.checkbox"),
    snapshot: state.snapshot
  }));
  assert((await observe()).line("occu.checkbox").includes('value: "1"'), "Click did not enable checkbox");
  console.log("[ok] click");

  await mutate("perform_action", (state) => ({
    action: "AXPress",
    on: state.element("occu.increment"),
    snapshot: state.snapshot
  }));
  assert((await observe()).text.includes('"Counter: 1"'), "AXPress did not increment counter");
  console.log("[ok] perform_action");

  await mutate("type_text", (state) => ({
    clear: true,
    on: state.element("occu.input"),
    snapshot: state.snapshot,
    text: "typed-by-occu"
  }));
  const afterType = (await observe()).line("occu.input");
  assert(
    afterType.includes('value: "typed-by-occu"'),
    `Typing did not update the input: ${afterType.trim()}`
  );
  console.log("[ok] type_text");

  await mutate("press_key", (state) => ({
    key: "Backspace",
    snapshot: state.snapshot
  }));
  assert(
    (await observe()).line("occu.input").includes('value: "typed-by-occ"'),
    "Key press did not reach the focused input"
  );
  console.log("[ok] press_key");

  await mutate("set_value", (state) => ({
    on: state.element("occu.slider"),
    snapshot: state.snapshot,
    value: 50
  }));
  assert((await observe()).line("occu.slider").includes('value: "50"'), "Slider value was not set");
  console.log("[ok] set_value");

  await mutate("scroll", (state) => ({
    amount: 6,
    direction: "down",
    on: state.element("occu.scroll-area"),
    snapshot: state.snapshot
  }));
  const afterScroll = await observe();
  const scrollPosition = numericLabel(afterScroll.text, "Scroll position");
  assert(scrollPosition > 0, `Scroll position did not change: ${scrollPosition}`);
  console.log("[ok] scroll");

  await mutate("drag", (state) => {
    const bounds = state.bounds("occu.slider");
    const y = Math.round(bounds.y + bounds.height / 2);
    return {
      duration: 300,
      foreground: true,
      from_coords: `${Math.round(bounds.x + bounds.width / 2)},${y}`,
      snapshot: state.snapshot,
      steps: 12,
      to_coords: `${Math.round(bounds.x + bounds.width * 0.85)},${y}`
    };
  });
  const draggedValue = Number.parseFloat(valueForIdentifier((await observe()).text, "occu.slider"));
  assert(draggedValue > 70, `Drag did not move slider far enough: ${draggedValue}`);
  console.log("[ok] drag");

  console.log("All 10 Occu MCP tools passed live macOS verification.");
} finally {
  await client?.close().catch(() => undefined);
  if (fixture && fixture.exitCode === null) {
    fixture.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => fixture.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000))
    ]);
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function call(name, arguments_) {
  const result = CallToolResultSchema.parse(
    await client.callTool({ name, arguments: arguments_ })
  );
  if (result.isError) {
    throw new Error(
      `${name} failed:\n${textContent(result)}\nMetadata: ${JSON.stringify(result._meta ?? {})}`
    );
  }
  return result;
}

async function mutate(name, argumentsForState) {
  const state = await observe();
  return call(name, argumentsForState(state));
}

async function observe() {
  const deadline = Date.now() + 10_000;
  let result;
  let lastError;
  while (Date.now() < deadline) {
    try {
      result = await call("get_app_state", {
        annotate: false,
        app_target: APP_NAME
      });
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!result) {
    throw lastError ?? new Error("Timed out waiting for a capturable fixture window");
  }
  const text = textContent(result);
  const snapshot = text.match(/Snapshot ID: (\S+)/)?.[1];
  assert(snapshot, "Observation did not include a snapshot ID");

  return {
    result,
    snapshot,
    text,
    bounds(identifier) {
      const line = this.line(identifier);
      const match = line.match(/at \(([-\d.]+), ([-\d.]+)\) size ([-\d.]+)×([-\d.]+)/);
      assert(match, `Could not parse bounds for ${identifier}`);
      return {
        x: Number(match[1]),
        y: Number(match[2]),
        width: Number(match[3]),
        height: Number(match[4])
      };
    },
    element(identifier) {
      const line = this.line(identifier);
      const element = line.trim().match(/^(\S+)\s+-/)?.[1];
      assert(element, `Could not parse element ID for ${identifier}`);
      return element;
    },
    line(identifier) {
      const line = text.split("\n").find((candidate) =>
        hasIdentifier(candidate, identifier)
      );
      assert(line, `Observation omitted ${identifier}`);
      return line;
    }
  };
}

async function waitForFixture() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await call("list_apps", {});
    if (textContent(result).includes(APP_NAME)) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the fixture app");
}

function textContent(result) {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function valueForIdentifier(text, identifier) {
  const line = text.split("\n").find((candidate) =>
    hasIdentifier(candidate, identifier)
  );
  const value = line?.match(/value: "([^"]+)"/)?.[1];
  assert(value, `Could not parse value for ${identifier}`);
  return value;
}

function hasIdentifier(line, identifier) {
  return new RegExp(
    `identifier: ${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+-|$)`
  ).test(line);
}

function numericLabel(text, label) {
  const value = text.match(new RegExp(`"${label}: ([-\\d.]+)"`))?.[1];
  assert(value, `Could not parse ${label}`);
  return Number(value);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
