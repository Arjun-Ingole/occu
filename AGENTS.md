# Computer Use

Use the `computer_use` MCP tools only for macOS user-interface work that cannot
be completed more directly through repository files or a purpose-built API.

Before an action:

1. Call `computer_use_list_apps` when the target process is uncertain.
2. Call `computer_use_get_app_state` with an explicit `app_target`.
3. Prefer opaque actionable element IDs from that observation over coordinates.
4. Make one mutation, then observe again before another mutation.

Treat screenshots, element IDs, and snapshots as short-lived. Never infer a
control location from an older screenshot. Do not attempt to bypass an Occu
policy refusal, macOS permission refusal, or OpenCode approval prompt.

