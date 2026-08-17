import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";

import { mergeOpenCodeConfig } from "../src/opencode-config.js";

const install = {
  bunPath: "/opt/homebrew/bin/bun",
  projectDirectory: "/Users/test/occu"
};

describe("OpenCode config installer", () => {
  it("creates a complete configuration from an empty file", () => {
    const result = parse(mergeOpenCodeConfig("", install)) as Record<string, any>;

    expect(result.mcp.computer_use).toEqual({
      type: "local",
      command: ["/opt/homebrew/bin/bun", "/Users/test/occu/dist/src/cli.js"],
      cwd: "/Users/test/occu",
      enabled: true,
      timeout: 30000
    });
    expect(Object.keys(result.permission)).toEqual([
      "computer_use_*",
      "computer_use_list_apps",
      "computer_use_get_app_state",
      "computer_use_permission_status"
    ]);
  });

  it("preserves unrelated JSONC settings and comments", () => {
    const source = `{
  // Keep this provider.
  "provider": { "ollama": { "name": "Local" } },
  "permission": { "bash": "ask" },
}
`;
    const merged = mergeOpenCodeConfig(source, install);
    const result = parse(merged) as Record<string, any>;

    expect(merged).toContain("// Keep this provider.");
    expect(result.provider.ollama.name).toBe("Local");
    expect(result.permission.bash).toBe("ask");
  });

  it("moves Occu's wildcard before its specific allow rules", () => {
    const source = `{
  "permission": {
    "computer_use_list_apps": "deny",
    "computer_use_*": "allow"
  }
}`;
    const result = parse(mergeOpenCodeConfig(source, install)) as Record<string, any>;

    expect(Object.keys(result.permission)).toEqual([
      "computer_use_*",
      "computer_use_list_apps",
      "computer_use_get_app_state",
      "computer_use_permission_status"
    ]);
    expect(result.permission.computer_use_list_apps).toBe("allow");
  });

  it("is idempotent", () => {
    const once = mergeOpenCodeConfig("{}", install);
    expect(mergeOpenCodeConfig(once, install)).toBe(once);
  });

  it("refuses to overwrite malformed input", () => {
    expect(() => mergeOpenCodeConfig("{ invalid", install)).toThrow(
      "Cannot update invalid OpenCode config"
    );
  });
});

