import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("stdio MCP integration", () => {
  it("connects, translates tools, relays images, and enforces one-shot policy", async () => {
    const policyDirectory = await mkdtemp(join(tmpdir(), "occu-mcp-integration-"));
    temporaryDirectories.push(policyDirectory);

    const fakeBackendPath = join(
      process.cwd(),
      "test",
      "fixtures",
      "fake-backend.mjs"
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), "dist", "src", "cli.js")],
      env: {
        ...process.env,
        OCCU_BACKEND_COMMAND: process.execPath,
        OCCU_BACKEND_ARGS: JSON.stringify([fakeBackendPath]),
        OCCU_POLICY_DIR: policyDirectory,
        OCCU_ALLOWED_APPS: "TextEdit"
      } as Record<string, string>,
      stderr: "pipe"
    });
    const client = new Client(
      { name: "occu-integration-test", version: "0.1.0" },
      { capabilities: {} }
    );
    clients.push(client);
    await client.connect(transport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain("get_app_state");
    expect(listed.tools.map((tool) => tool.name)).not.toContain("see");

    const apps = CallToolResultSchema.parse(
      await client.callTool({ name: "list_apps", arguments: {} })
    );
    expect(apps.structuredContent).toEqual({
      name: "app",
      arguments: { action: "list" }
    });

    const observation = CallToolResultSchema.parse(
      await client.callTool({
        name: "get_app_state",
        arguments: { app_target: "TextEdit" }
      })
    );
    expect(observation.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image", mimeType: "image/png" })
      ])
    );

    const click = CallToolResultSchema.parse(
      await client.callTool({
        name: "click",
        arguments: { on: "B1", snapshot: "fake-snapshot" }
      })
    );
    expect(click.isError).not.toBe(true);
    expect(click.structuredContent).toEqual({
      name: "click",
      arguments: { on: "B1", snapshot: "fake-snapshot" }
    });

    const replay = CallToolResultSchema.parse(
      await client.callTool({
        name: "click",
        arguments: { on: "B1", snapshot: "fake-snapshot" }
      })
    );
    expect(replay.isError).toBe(true);
    expect(replay.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Observe the target first")
    });
  });
});
