# Occu

Occu is a macOS-only computer-use MCP server for OpenCode. It exposes a compact,
Codex-style tool surface and delegates native screen capture and UI automation to
the signed Peekaboo 4.2.0 engine.

## Requirements

- macOS 15 or later
- Bun 1.3.14 or later
- OpenCode 1.17.18 or later

The bundled Peekaboo executable supports Apple Silicon and Intel Macs.

## Setup

Install Occu globally for OpenCode with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/Arjun-Ingole/occu/main/install.sh | sh
```

The bootstrap downloads Occu to `~/.local/share/occu` and then installs
dependencies, builds the server, installs and verifies the signed software-cursor
companion, safely merges the global OpenCode configuration,
creates a backup of an existing configuration, allows mutations in every explicitly
observed app, checks the native backend, and requests missing macOS permissions.
Approve any request in System Settings, restart OpenCode, then run:

```bash
opencode mcp list
```

To restrict mutations to specific apps, pass their names:

```bash
curl -fsSL https://raw.githubusercontent.com/Arjun-Ingole/occu/main/install.sh \
  | sh -s -- TextEdit "Google Chrome"
```

To disable all mutations and retain observation tools only:

```bash
curl -fsSL https://raw.githubusercontent.com/Arjun-Ingole/occu/main/install.sh \
  | sh -s -- --observation-only
```

Rerun the same command to update an existing installation. Set
`OCCU_INSTALL_DIR` or `OCCU_REF` before the command to override the install
directory or pin a branch, tag, or commit. For a local source checkout, run
`./setup.sh` directly.

The installer is idempotent and configures Occu globally, so OpenCode can be
started from any project:

```bash
cd ~/projects/my-project
opencode .
```

Run `./setup.sh --help` for noninteractive permission and config-path options.
The checked-in `opencode.json` also supports project-local development. All Occu
tools run without an OpenCode prompt by default, while mutations must still pass
Occu's local observation and app policy.

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
be treated like the installer's default wildcard mode. Use named app arguments or
`--observation-only` when a narrower policy is required.

Peekaboo is bundled inside Occu and does not need to be installed in `PATH`.
Occu uses its own daemon socket under the policy directory so other Peekaboo
installations and older Bridge processes cannot interfere with screen capture.

Targeted background mutations also produce a separate software cursor without
moving the hardware pointer. Setup installs the pinned, notarized Peekaboo menu-bar
companion under `~/.local/share/occu-companion`, enables its visualizer and agent
cursor, launches it in unattended background-host mode, and verifies event delivery.
It is not copied to `/Applications` and has no Dock presence or normal app windows.
Pass `--skip-visualizer` only where that feedback is intentionally not wanted.

## Tools

| OpenCode tool | Purpose | OpenCode default |
| --- | --- | --- |
| `computer_use_list_apps` | List running apps | allow |
| `computer_use_get_app_state` | Screenshot and accessibility snapshot | allow |
| `computer_use_permission_status` | Check macOS permissions | allow |
| `computer_use_click` | Click an element or grounded coordinate | allow |
| `computer_use_drag` | Drag between grounded targets | allow |
| `computer_use_perform_action` | Run an accessibility action | allow |
| `computer_use_press_key` | Press a key or shortcut | allow |
| `computer_use_scroll` | Scroll a target | allow |
| `computer_use_set_value` | Set a control's value | allow |
| `computer_use_type_text` | Type text into a control | allow |

Every mutation requires a successful, named `get_app_state` observation just
before it. The observation is invalidated after a dispatched or indeterminate
mutation. A backend refusal explicitly marked safe to retry retains it, so callers
can correct invalid arguments without another capture. Snapshot-bound typing also
accepts redundant app or window context; Occu uses that context for policy checks
and sends the backend only its canonical snapshot target.

## Development

```bash
bun run check
bun run test:backend
bun run test:visualizer
bun audit
```

On a Mac with Screen Recording and Accessibility granted, run the complete live
tool matrix with:

```bash
bun run test:live
```

This compiles a temporary AppKit fixture, calls all ten public tools through the
stdio MCP boundary, verifies every mutation through a fresh observation, and
removes the fixture afterward. It does not interact with personal app data.

`OCCU_BACKEND_COMMAND` and JSON-array `OCCU_BACKEND_ARGS` can point the facade at
another stdio MCP backend for integration tests. The replacement must provide
the pinned Peekaboo tool contract.

The researched design and security boundaries are documented in
[`docs/architecture.md`](docs/architecture.md).
