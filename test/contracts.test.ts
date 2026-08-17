import { describe, expect, it } from "vitest";

import {
  PUBLIC_TOOL_NAMES,
  TOOL_ROUTES,
  isPublicToolName
} from "../src/contracts.js";

describe("public tool contract", () => {
  it("exposes a compact Codex-style surface", () => {
    expect(PUBLIC_TOOL_NAMES).toEqual([
      "list_apps",
      "get_app_state",
      "permission_status",
      "click",
      "drag",
      "perform_action",
      "press_key",
      "scroll",
      "set_value",
      "type_text"
    ]);
  });

  it("marks observation tools as read-only", () => {
    expect(TOOL_ROUTES.list_apps.mutates).toBe(false);
    expect(TOOL_ROUTES.get_app_state.mutates).toBe(false);
    expect(TOOL_ROUTES.permission_status.mutates).toBe(false);
  });

  it("rejects unknown tool names", () => {
    expect(isPublicToolName("click")).toBe(true);
    expect(isPublicToolName("shell")).toBe(false);
  });
});

