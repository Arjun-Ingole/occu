import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type ParseError
} from "jsonc-parser";

export interface OpenCodeInstall {
  bunPath: string;
  projectDirectory: string;
}

const FORMATTING = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n"
};

const OCCU_PERMISSION_NAMES = [
  "computer_use_*",
  "computer_use_list_apps",
  "computer_use_get_app_state",
  "computer_use_permission_status"
] as const;

export function mergeOpenCodeConfig(
  source: string,
  install: OpenCodeInstall
): string {
  let updated = source.trim() ? source : "{}\n";
  assertValidConfig(updated);

  const parsed = parse(updated) as Record<string, unknown>;
  if (!("$schema" in parsed)) {
    updated = setValue(updated, ["$schema"], "https://opencode.ai/config.json");
  }

  updated = setValue(updated, ["mcp", "computer_use"], {
    type: "local",
    command: [install.bunPath, `${install.projectDirectory}/dist/src/cli.js`],
    cwd: install.projectDirectory,
    enabled: true,
    timeout: 30000
  });

  for (const name of OCCU_PERMISSION_NAMES) {
    updated = removeValue(updated, ["permission", name]);
  }
  updated = setValue(updated, ["permission", "computer_use_*"], "allow");

  return `${updated.trimEnd()}\n`;
}

function setValue(source: string, path: (string | number)[], value: unknown): string {
  return applyEdits(
    source,
    modify(source, path, value, { formattingOptions: FORMATTING })
  );
}

function removeValue(source: string, path: (string | number)[]): string {
  if (!hasPath(source, path)) {
    return source;
  }
  return applyEdits(
    source,
    modify(source, path, undefined, { formattingOptions: FORMATTING })
  );
}

function hasPath(source: string, path: (string | number)[]): boolean {
  let current: unknown = parse(source);
  for (const segment of path) {
    if (
      typeof current !== "object" ||
      current === null ||
      !(segment in current)
    ) {
      return false;
    }
    current = (current as Record<string | number, unknown>)[segment];
  }
  return true;
}

function assertValidConfig(source: string): void {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false
  });
  if (errors.length > 0 || typeof value !== "object" || value === null || Array.isArray(value)) {
    const detail = errors[0]
      ? `${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`
      : "top-level value must be an object";
    throw new Error(`Cannot update invalid OpenCode config: ${detail}`);
  }
}
