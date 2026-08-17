# Occu

Occu is a macOS computer-use MCP server for OpenCode. It provides screenshots,
accessibility snapshots, grounded UI actions, and a software cursor through the
signed Peekaboo 4.2.0 engine.

## Requirements

- macOS 15 or later
- Bun 1.3.14 or later
- OpenCode 1.17.18 or later

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Arjun-Ingole/occu/main/install.sh | sh
```

The installer places Occu at `~/.local/share/occu`, installs the verified cursor
companion at `~/.local/share/occu-companion`, builds the server, updates the global
OpenCode configuration, checks the native backend, and requests missing macOS
permissions. Restart OpenCode after installation, then verify the connection:

```bash
opencode mcp list
```

The installer is idempotent. Run the same command to update Occu.

All `computer_use_*` tools are allowed in OpenCode by default. Occu still requires
a current observation and checks its local mutation policy before every action.

## Install Options

Restrict mutations to named applications:

```bash
curl -fsSL https://raw.githubusercontent.com/Arjun-Ingole/occu/main/install.sh \
  | sh -s -- TextEdit "Google Chrome"
```

Disable mutations:

```bash
curl -fsSL https://raw.githubusercontent.com/Arjun-Ingole/occu/main/install.sh \
  | sh -s -- --observation-only
```

Set `OCCU_REF` to install a branch, tag, or commit. Set `OCCU_INSTALL_DIR` to use a
different installation directory. Run `./setup.sh --help` for local setup options.

## Policy

The default policy allows mutations in any app that was explicitly observed. Stop
or resume mutations from the default installation with:

```bash
bun ~/.local/share/occu/dist/src/policy-cli.js stop
bun ~/.local/share/occu/dist/src/policy-cli.js resume
```

Replace wildcard access with a named allowlist:

```bash
bun ~/.local/share/occu/dist/src/policy-cli.js deny "*"
bun ~/.local/share/occu/dist/src/policy-cli.js allow TextEdit
bun ~/.local/share/occu/dist/src/policy-cli.js list
```

Policy state is stored in `~/.config/occu`. `OCCU_POLICY_DIR` changes that location.
`OCCU_ALLOWED_APPS` adds a comma-separated allowlist for the current server process.

## Software Cursor

Grounded actions display a separate software cursor without moving the hardware
pointer. The companion runs in background-host mode with no Dock icon or normal app
windows. Use `--skip-visualizer` during setup to disable this feature.

## Tools

| Tool | Purpose |
| --- | --- |
| `computer_use_list_apps` | List running applications |
| `computer_use_open_app` | Launch or activate an application |
| `computer_use_get_app_state` | Capture a screenshot and accessibility snapshot |
| `computer_use_permission_status` | Check required macOS permissions |
| `computer_use_click` | Click an observed element or coordinate |
| `computer_use_drag` | Drag between grounded targets |
| `computer_use_perform_action` | Run an accessibility action |
| `computer_use_press_key` | Press a key or shortcut |
| `computer_use_scroll` | Scroll an observed element |
| `computer_use_set_value` | Set an accessibility value |
| `computer_use_type_text` | Type into an observed control |

Use `computer_use_open_app` instead of shell or AppleScript to launch an application.
Call `computer_use_get_app_state` with an explicit app before each action and pass
its snapshot ID. Use actionable element IDs when available. For editors without a
text element, call `computer_use_type_text` without `on` and without clicking first.
Observe again after every action.

## Development

```bash
bun install --frozen-lockfile
bun run check
bun run test:backend
bun run test:visualizer
bun run test:live
bun audit
```

`bun run check` typechecks the source, scripts, and tests, builds the production
server, and runs the automated test suite. `test:live` compiles a temporary AppKit
fixture and verifies all eleven MCP tools without using personal app data.

`OCCU_BACKEND_COMMAND` and `OCCU_BACKEND_ARGS` are available for integration tests.
