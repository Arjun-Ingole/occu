#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

const names = [
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

const tools = names.map((name) => ({
  name,
  description: `Fake ${name} tool`,
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: true
  }
}));

const server = new Server(
  { name: "occu-fake-backend", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "see") {
    return {
      content: [
        { type: "text", text: "Snapshot ID: fake-snapshot\nApplication: TextEdit" },
        { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }
      ],
      structuredContent: { snapshot: "fake-snapshot" }
    };
  }

  const response = {
    name: request.params.name,
    arguments: request.params.arguments ?? {}
  };
  return {
    content: [{ type: "text", text: JSON.stringify(response) }],
    structuredContent: response
  };
});

await server.connect(new StdioServerTransport());
