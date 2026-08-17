# Architecture

## Goal

Occu recreates the useful boundary of Codex computer use for OpenCode on macOS:
an agent sees a compact MCP tool set, while a native process owns screen capture,
Accessibility access, and input delivery.

It does not copy or redistribute Codex components.

## What the Codex setup does

Inspection of the locally installed Codex computer-use plugin found this shape:

1. The plugin manifest launches `SkyComputerUseClient mcp` over stdio MCP.
2. The client communicates over XPC with a signed `Codex Computer Use.app`.
3. The app is the stable macOS TCC identity for Screen Recording and Accessibility.
4. Native code uses ScreenCaptureKit, `AXUIElement`, and Core Graphics events.
5. The MCP surface is intentionally small: observe applications, click, drag,
   scroll, type, press keys, set values, and perform accessibility actions.
6. Mutating work is separately guarded by app approval and host permissions.

That design separates the untrusted model-facing protocol from privileged native
automation. The signed service also avoids moving the TCC identity between agent
runs.

## Why OpenCode needs an adapter

OpenCode 1.17.18 can launch local MCP servers and can consume MCP image content.
It does not directly implement the screenshot/action loop of the hosted OpenAI
computer-use tool, and it does not advertise MCP elicitation in this version.
Relying on server-driven approval prompts would therefore be brittle.

Occu uses two controls that OpenCode can enforce today:

- OpenCode asks before every mutating `computer_use_*` tool.
- Occu independently denies mutations unless the observed app is locally
  allowlisted and the emergency stop is clear.

## Runtime

```text
OpenCode
  | stdio MCP: computer_use_*
  v
Occu (Bun facade)
  | policy.json + STOPPED
  | stdio MCP: native Peekaboo tools
  v
Peekaboo 4.2.0 (signed universal macOS executable)
  | ScreenCaptureKit + Accessibility + native input
  v
Target macOS application
```

The facade fetches Peekaboo's tool schemas at runtime, verifies every required
backend tool exists, renames only the supported subset, and passes MCP text,
image, metadata, and structured content through without conversion. The pinned
backend provides snapshot receipts, freshness checks, and background-first input
delivery. Occu assigns the backend a private daemon socket under its policy
directory rather than sharing Peekaboo's ambient Bridge socket.

## Safety model

- **Default deny:** an empty allowlist permits observation but no mutation.
- **Named observation:** mutations require a successful `get_app_state` call with
  `app_target` immediately beforehand.
- **App binding:** an explicit action target must match the observed app.
- **Single use:** every mutation attempt invalidates the observation, including an
  indeterminate transport failure.
- **Emergency stop:** `occu stop` persists a stop file checked on every mutation.
- **Local state:** policy files use mode `0600`; their directory uses `0700`.
- **Two approval layers:** OpenCode prompts for mutation and Occu checks policy.
- **No screenshot archive:** Occu relays image blocks in memory. Peekaboo may use
  short-lived capture files as part of its native observation implementation.

macOS TCC remains the final authority. Occu cannot grant or bypass Screen
Recording, Accessibility, or event-synthesis permissions.

## Tradeoffs

Using Peekaboo avoids reimplementing UI traversal, multi-display coordinates,
window targeting, Retina scaling, snapshot invalidation, and native event
delivery. It also means Occu inherits a pinned third-party native dependency and
its signing identity rather than shipping a first-party companion app. A future
distribution can replace `PeekabooBackend` with an Occu-signed XPC service
without changing OpenCode's MCP contract.

## Sources

- [OpenCode local MCP configuration](https://opencode.ai/docs/mcp-servers/)
- [OpenCode permission rules](https://opencode.ai/docs/permissions/)
- [Model Context Protocol specification](https://modelcontextprotocol.io/specification/)
- [Peekaboo repository](https://github.com/openclaw/Peekaboo)
- [OpenAI computer-use guide](https://platform.openai.com/docs/guides/tools-computer-use)
