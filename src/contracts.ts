export const TOOL_ROUTES = {
  list_apps: { backend: "app", mutates: false },
  get_app_state: { backend: "see", mutates: false },
  permission_status: { backend: "permissions", mutates: false },
  click: { backend: "click", mutates: true },
  drag: { backend: "drag", mutates: true },
  perform_action: { backend: "action", mutates: true },
  press_key: { backend: "press", mutates: true },
  scroll: { backend: "scroll", mutates: true },
  set_value: { backend: "set_value", mutates: true },
  type_text: { backend: "type", mutates: true }
} as const;

export type PublicToolName = keyof typeof TOOL_ROUTES;

export const PUBLIC_TOOL_NAMES = Object.freeze(
  Object.keys(TOOL_ROUTES) as PublicToolName[]
);

export function isPublicToolName(value: string): value is PublicToolName {
  return value in TOOL_ROUTES;
}

