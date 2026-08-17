import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalMutationPolicy, PolicyStore } from "../src/policy.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function makeStore(environment: NodeJS.ProcessEnv = {}): Promise<{
  directory: string;
  store: PolicyStore;
}> {
  const directory = await mkdtemp(join(tmpdir(), "occu-policy-"));
  temporaryDirectories.push(directory);
  return { directory, store: new PolicyStore(directory, environment) };
}

describe("policy store", () => {
  it("denies all applications by default", async () => {
    const { store } = await makeStore();
    await expect(store.read()).resolves.toEqual({
      allowedApps: [],
      stopped: false
    });
  });

  it("persists a deduplicated allowlist with private permissions", async () => {
    const { directory, store } = await makeStore();
    await store.allow("TextEdit");
    await store.allow("textedit");
    await store.allow("Calculator");

    const state = await store.read();
    const policyFile = join(directory, "policy.json");
    const fileMode = (await stat(policyFile)).mode & 0o777;

    expect(state.allowedApps).toEqual(["Calculator", "TextEdit"]);
    expect(fileMode).toBe(0o600);
    expect(JSON.parse(await readFile(policyFile, "utf8"))).toEqual({
      version: 1,
      allowedApps: ["Calculator", "TextEdit"]
    });
  });

  it("applies stop and resume immediately", async () => {
    const { store } = await makeStore();
    await expect(store.stop()).resolves.toMatchObject({ stopped: true });
    await expect(store.resume()).resolves.toMatchObject({ stopped: false });
  });

  it("clears all persisted application entries", async () => {
    const { store } = await makeStore();
    await store.allow("TextEdit");
    await store.allow("Calculator");

    await expect(store.clear()).resolves.toMatchObject({ allowedApps: [] });
  });

  it("merges environment allowlist entries without persisting them", async () => {
    const { store } = await makeStore({ OCCU_ALLOWED_APPS: "Safari, TextEdit" });
    await expect(store.read()).resolves.toMatchObject({
      allowedApps: ["Safari", "TextEdit"]
    });
  });
});

describe("local mutation policy", () => {
  it("requires an explicit observation and allowlisted app", async () => {
    const { store } = await makeStore();
    const policy = new LocalMutationPolicy(store);

    await expect(policy.authorizeMutation()).rejects.toThrow("Observe the target");
    policy.recordObservation("TextEdit");
    await expect(policy.authorizeMutation()).rejects.toThrow("not allowed");
    await store.allow("TextEdit");
    await expect(policy.authorizeMutation()).resolves.toBeUndefined();
  });

  it("rejects explicit targets that differ from the observation", async () => {
    const { store } = await makeStore({ OCCU_ALLOWED_APPS: "*" });
    const policy = new LocalMutationPolicy(store);
    policy.recordObservation("TextEdit");

    await expect(policy.authorizeMutation("Safari")).rejects.toThrow(
      "does not match the last observed app"
    );
  });

  it("blocks every mutation while stopped", async () => {
    const { store } = await makeStore({ OCCU_ALLOWED_APPS: "*" });
    const policy = new LocalMutationPolicy(store);
    policy.recordObservation("TextEdit");
    await store.stop();

    await expect(policy.authorizeMutation()).rejects.toThrow("mutations are stopped");
  });
});
