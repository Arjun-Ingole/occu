import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface PolicyDocument {
  version: 1;
  allowedApps: string[];
}

export interface PolicyState {
  allowedApps: string[];
  stopped: boolean;
}

export interface MutationPolicy {
  recordObservation(app: string | undefined): void;
  authorizeMutation(explicitApp?: string): Promise<void>;
  invalidateObservation(): void;
}

export function defaultPolicyDirectory(
  environment: NodeJS.ProcessEnv = process.env
): string {
  if (environment.OCCU_POLICY_DIR) {
    return environment.OCCU_POLICY_DIR;
  }
  if (environment.XDG_CONFIG_HOME) {
    return join(environment.XDG_CONFIG_HOME, "occu");
  }
  return join(homedir(), ".config", "occu");
}

export class PolicyStore {
  readonly #directory: string;
  readonly #policyPath: string;
  readonly #stopPath: string;
  readonly #environment: NodeJS.ProcessEnv;

  constructor(
    directory = defaultPolicyDirectory(),
    environment: NodeJS.ProcessEnv = process.env
  ) {
    this.#directory = directory;
    this.#policyPath = join(directory, "policy.json");
    this.#stopPath = join(directory, "STOPPED");
    this.#environment = environment;
  }

  async read(): Promise<PolicyState> {
    const document = await this.#readDocument();
    const environmentApps = parseAllowedApps(this.#environment.OCCU_ALLOWED_APPS);
    const allowedApps = uniqueApps([...document.allowedApps, ...environmentApps]);
    const stopped = await fileExists(this.#stopPath);
    return { allowedApps, stopped };
  }

  async allow(app: string): Promise<PolicyState> {
    const normalized = requireApp(app);
    const document = await this.#readDocument();
    document.allowedApps = uniqueApps([...document.allowedApps, normalized]);
    await this.#writeDocument(document);
    return this.read();
  }

  async deny(app: string): Promise<PolicyState> {
    const normalized = requireApp(app);
    const document = await this.#readDocument();
    document.allowedApps = document.allowedApps.filter(
      (candidate) => candidate.toLocaleLowerCase() !== normalized.toLocaleLowerCase()
    );
    await this.#writeDocument(document);
    return this.read();
  }

  async stop(): Promise<PolicyState> {
    await this.#ensureDirectory();
    await writeFile(this.#stopPath, "Computer-use mutations are stopped.\n", {
      encoding: "utf8",
      mode: 0o600
    });
    await chmod(this.#stopPath, 0o600);
    return this.read();
  }

  async resume(): Promise<PolicyState> {
    await rm(this.#stopPath, { force: true });
    return this.read();
  }

  async #readDocument(): Promise<PolicyDocument> {
    try {
      const raw = await readFile(this.#policyPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isPolicyDocument(parsed)) {
        throw new Error(`Invalid Occu policy file: ${this.#policyPath}`);
      }
      return { version: 1, allowedApps: uniqueApps(parsed.allowedApps) };
    } catch (error: unknown) {
      if (isMissingFile(error)) {
        return { version: 1, allowedApps: [] };
      }
      throw error;
    }
  }

  async #writeDocument(document: PolicyDocument): Promise<void> {
    await this.#ensureDirectory();
    const temporaryPath = join(
      dirname(this.#policyPath),
      `.policy-${process.pid}-${Date.now()}.json`
    );
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.#policyPath);
    await chmod(this.#policyPath, 0o600);
  }

  async #ensureDirectory(): Promise<void> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await chmod(this.#directory, 0o700);
  }
}

export class LocalMutationPolicy implements MutationPolicy {
  #observedApp: string | undefined;

  constructor(private readonly store = new PolicyStore()) {}

  recordObservation(app: string | undefined): void {
    this.#observedApp = normalizeOptionalApp(app);
  }

  async authorizeMutation(explicitApp?: string): Promise<void> {
    const state = await this.store.read();
    if (state.stopped) {
      throw new Error("Computer-use mutations are stopped. Run `occu resume` to re-enable them.");
    }

    const target = normalizeOptionalApp(explicitApp) ?? this.#observedApp;
    if (!target || !this.#observedApp) {
      throw new Error(
        "Observe the target first with get_app_state and an explicit app_target."
      );
    }
    if (target.toLocaleLowerCase() !== this.#observedApp.toLocaleLowerCase()) {
      throw new Error(
        `Mutation target ${target} does not match the last observed app ${this.#observedApp}.`
      );
    }
    if (!isAllowed(target, state.allowedApps)) {
      throw new Error(
        `Mutations for ${target} are not allowed. Run \`occu allow ${quoteArgument(target)}\` first.`
      );
    }
  }

  invalidateObservation(): void {
    this.#observedApp = undefined;
  }
}

function isPolicyDocument(value: unknown): value is PolicyDocument {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.allowedApps) &&
    candidate.allowedApps.every((app) => typeof app === "string")
  );
}

function isAllowed(app: string, allowedApps: string[]): boolean {
  const normalized = app.toLocaleLowerCase();
  return allowedApps.some(
    (allowed) => allowed === "*" || allowed.toLocaleLowerCase() === normalized
  );
}

function parseAllowedApps(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value.split(",").map((app) => app.trim()).filter(Boolean);
}

function uniqueApps(apps: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const app of apps.map((candidate) => candidate.trim()).filter(Boolean)) {
    const key = app.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(app);
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function normalizeOptionalApp(app: string | undefined): string | undefined {
  const normalized = app?.trim();
  return normalized ? normalized : undefined;
}

function requireApp(app: string): string {
  const normalized = normalizeOptionalApp(app);
  if (!normalized) {
    throw new Error("Application name cannot be empty");
  }
  return normalized;
}

function quoteArgument(value: string): string {
  return JSON.stringify(value);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

