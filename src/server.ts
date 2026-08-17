import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import type { ComputerUseBackend } from "./backend.js";
import { ComputerUseFacade } from "./facade.js";

export interface RunningOccuServer {
  close(): Promise<void>;
}

export async function startOccuServer(
  backend: ComputerUseBackend,
  transport = new StdioServerTransport()
): Promise<RunningOccuServer> {
  await backend.connect();
  const facade = new ComputerUseFacade(backend);
  const server = new Server(
    { name: "occu", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Use open_app to launch or activate apps. Observe before each action and pass its snapshot ID. For editors without a text element, call type_text without on and without clicking first."
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await facade.listTools()
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    facade.callTool(request.params.name, request.params.arguments ?? {})
  );

  await server.connect(transport);

  return {
    async close(): Promise<void> {
      await Promise.allSettled([server.close(), backend.close()]);
    }
  };
}
