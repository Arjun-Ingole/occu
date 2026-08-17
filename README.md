# Occu

Occu is a macOS-only computer-use MCP server for OpenCode. It exposes a compact,
Codex-style tool surface and delegates native screen capture and UI automation to
the signed Peekaboo 4.2.0 engine.

## Requirements

- macOS 14 or later
- Bun 1.3.14 or later
- OpenCode 1.17.18 or later

The bundled Peekaboo executable supports Apple Silicon and Intel Macs.

## Setup

Run the installer with the macOS applications OpenCode may control:

```bash
./setup.sh TextEdit "Google Chrome"
```

The script installs dependencies, builds Occu, safely merges the global OpenCode
configuration, creates a backup of an existing configuration, adds the named apps
to the mutation allowlist, checks the native backend, and requests missing macOS
permissions. Approve any request in System Settings, restart OpenCode, then run:

```bash
opencode mcp list
```

With no app arguments, setup installs an observation-only configuration:

```bash
./setup.sh
```

The installer is idempotent and configures Occu globally, so OpenCode can be
started from any project:

```bash
cd ~/projects/my-project
opencode .
```

Run `./setup.sh --help` for noninteractive permission and config-path options.
The checked-in `opencode.json` also supports project-local development. Observation
tools run without an OpenCode prompt. Mutations prompt for approval and must pass
Occu's local app policy.

## Safety controls

Stop mutations immediately, including from already-running OpenCode sessions:

```bash
bun run policy -- stop
```

Observation remains available while stopped. Resume and manage the allowlist
with:

```bash
bun run policy -- resume
bun run policy -- deny TextEdit
bun run policy -- list
```

Policy is stored in `~/.config/occu/policy.json`. Set `OCCU_POLICY_DIR` to use a
different directory, or `OCCU_ALLOWED_APPS` to add a comma-separated ephemeral
allowlist. `OCCU_ALLOWED_APPS=*` allows every explicitly observed app and should
only be used in controlled test environments.

## Tools

| OpenCode tool | Purpose | OpenCode default |
| --- | --- | --- |
| `computer_use_list_apps` | List running apps | allow |
| `computer_use_get_app_state` | Screenshot and accessibility snapshot | allow |
| `computer_use_permission_status` | Check macOS permissions | allow |
| `computer_use_click` | Click an element or grounded coordinate | ask |
| `computer_use_drag` | Drag between grounded targets | ask |
| `computer_use_perform_action` | Run an accessibility action | ask |
| `computer_use_press_key` | Press a key or shortcut | ask |
| `computer_use_scroll` | Scroll a target | ask |
| `computer_use_set_value` | Set a control's value | ask |
| `computer_use_type_text` | Type text into a control | ask |

Every mutation requires a successful, named `get_app_state` observation just
before it. The observation is invalidated after one mutation attempt.

## Development

```bash
bun run check
bun audit
```

`OCCU_BACKEND_COMMAND` and JSON-array `OCCU_BACKEND_ARGS` can point the facade at
another stdio MCP backend for integration tests. The replacement must provide
the pinned Peekaboo tool contract.

The researched design and security boundaries are documented in
[`docs/architecture.md`](docs/architecture.md).
