import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalizeWorkspacePath,
  acquireWorkspaceLaunchLock,
  createSessionId,
  findSessionByWorkspace,
  getSessionRegistryPath,
  pruneStaleSessions,
  readSessionRegistry,
  registerSession,
  unregisterSession,
  updateSession,
  type FlowmarkSession,
} from "../src/lib/session-registry.ts";

function session(id: string, workspacePath: string): FlowmarkSession {
  return {
    id,
    mode: "foreground",
    pid: 123,
    workspace_path: workspacePath,
    url: "http://127.0.0.1:8080/",
    started_at: "2026-07-28T10:00:00.000Z",
    ready_at: "2026-07-28T10:00:01.000Z",
    updated_at: "2026-07-28T10:00:01.000Z",
    control_url: "http://127.0.0.1:51234/",
    control_token: "secret",
  };
}

test("global registry path lives under the supplied home directory", () => {
  assert.equal(getSessionRegistryPath("/Users/tester"), "/Users/tester/.flowmark/sessions.json");
  assert.match(createSessionId(), /^session_[0-9a-z]+$/);
});

test("missing registry reads as an empty versioned registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-registry-"));
  try {
    const registry = await readSessionRegistry({ registryPath: join(root, "sessions.json") });
    assert.deepEqual(registry, { schema_version: 1, sessions: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sessions can be registered, updated, found by workspace, and removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-registry-"));
  const registryPath = join(root, ".flowmark", "sessions.json");
  try {
    await registerSession(session("session_one", "/workspace/one"), { registryPath });
    await updateSession(
      "session_one",
      { mode: "daemon", updated_at: "2026-07-28T10:02:00.000Z" },
      { registryPath },
    );

    const registry = await readSessionRegistry({ registryPath });
    assert.equal(registry.sessions.length, 1);
    assert.equal(registry.sessions[0]?.mode, "daemon");
    assert.equal(findSessionByWorkspace(registry.sessions, "/workspace/one")?.id, "session_one");

    assert.equal(await unregisterSession("session_one", { registryPath }), true);
    assert.deepEqual((await readSessionRegistry({ registryPath })).sessions, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent registry mutations preserve every session and valid JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-registry-"));
  const registryPath = join(root, ".flowmark", "sessions.json");
  try {
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        registerSession(session(`session_${index}`, `/workspace/${index}`), { registryPath }),
      ),
    );

    const source = await readFile(registryPath, "utf8");
    const parsed = JSON.parse(source) as { schema_version: number; sessions: unknown[] };
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.sessions.length, 12);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace paths are canonicalized before session matching", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-registry-"));
  try {
    const workspace = join(root, "workspace");
    const alias = join(root, "alias");
    await mkdir(workspace);
    await symlink(workspace, alias);

    assert.equal(await canonicalizeWorkspacePath(alias), workspace);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale sessions are pruned using the supplied local health probe", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-registry-"));
  const registryPath = join(root, "sessions.json");
  try {
    await registerSession(session("session_live", "/workspace/live"), { registryPath });
    await registerSession(session("session_stale", "/workspace/stale"), { registryPath });

    const result = await pruneStaleSessions({
      registryPath,
      probe: async (entry) => entry.id === "session_live",
    });

    assert.deepEqual(
      result.stale.map((entry) => entry.id),
      ["session_stale"],
    );
    assert.deepEqual(
      result.sessions.map((entry) => entry.id),
      ["session_live"],
    );
    assert.deepEqual(
      (await readSessionRegistry({ registryPath })).sessions.map((entry) => entry.id),
      ["session_live"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a transient health failure is retried before a live session is pruned", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-registry-"));
  const registryPath = join(root, "sessions.json");
  let probes = 0;
  try {
    await registerSession(session("session_sleepy", "/workspace/sleepy"), { registryPath });
    const result = await pruneStaleSessions({
      registryPath,
      probeRetryDelayMs: 1,
      probe: async () => ++probes > 1,
    });

    assert.equal(probes, 2);
    assert.deepEqual(
      result.sessions.map((entry) => entry.id),
      ["session_sleepy"],
    );
    assert.deepEqual(result.stale, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a malformed disposable registry is backed up and recovered as empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-registry-"));
  const registryPath = join(root, "sessions.json");
  try {
    await writeFile(registryPath, "{truncated", "utf8");
    assert.deepEqual(await readSessionRegistry({ registryPath }), {
      schema_version: 1,
      sessions: [],
    });
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith("sessions.json.corrupt-")),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace launch lock serializes duplicate startup checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-registry-"));
  const registryPath = join(root, "sessions.json");
  let secondAcquired = false;
  try {
    const releaseFirst = await acquireWorkspaceLaunchLock("/workspace/shared", { registryPath });
    const second = acquireWorkspaceLaunchLock("/workspace/shared", { registryPath }).then(
      (release) => {
        secondAcquired = true;
        return release;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(secondAcquired, false);
    await releaseFirst();
    const releaseSecond = await second;
    assert.equal(secondAcquired, true);
    await releaseSecond();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
