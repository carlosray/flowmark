import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { readSessionRegistry, type FlowmarkSession } from "../src/lib/session-registry.ts";
import {
  parseViteLoopbackUrl,
  MANAGED_SESSION_SIGNALS,
  probeSession,
  requestSessionStop,
  runManagedSession,
  startSessionControlServer,
  type ManagedServerProcess,
} from "../src/lib/session-supervisor.ts";

class FakeServerProcess extends EventEmitter implements ManagedServerProcess {
  pid = 456;
  stdout = new PassThrough();
  stderr = new PassThrough();
  killedWith: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.killedWith.push(signal);
    queueMicrotask(() => this.emit("exit", 0, signal));
    return true;
  }
}

test("Vite readiness accepts a loopback address and normalizes localhost", () => {
  assert.equal(
    parseViteLoopbackUrl("  ➜  Local:   http://localhost:8081/"),
    "http://127.0.0.1:8081/",
  );
  assert.equal(
    parseViteLoopbackUrl("\u001b[32mLocal: http://127.0.0.1:4173/\u001b[0m"),
    "http://127.0.0.1:4173/",
  );
  assert.equal(
    parseViteLoopbackUrl("Local: http://localhost:\u001b[1m5173\u001b[22m/"),
    "http://127.0.0.1:5173/",
  );
  assert.equal(parseViteLoopbackUrl("Network: http://192.168.1.3:8080/"), null);
});

test("managed sessions clean up on terminal-close and quit signals", () => {
  assert.deepEqual(MANAGED_SESSION_SIGNALS, ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]);
});

test("session control is loopback-only, authenticated, and requests one stop", async () => {
  let stops = 0;
  const control = await startSessionControlServer({
    token: "correct-token",
    onStop: () => {
      stops++;
    },
  });
  const base: FlowmarkSession = {
    id: "session_control",
    mode: "foreground",
    pid: process.pid,
    workspace_path: "/workspace",
    url: "http://127.0.0.1:8080/",
    started_at: "2026-07-28T10:00:00.000Z",
    ready_at: "2026-07-28T10:00:01.000Z",
    updated_at: "2026-07-28T10:00:01.000Z",
    control_url: control.url,
    control_token: "correct-token",
  };

  try {
    assert.equal(await probeSession(base), true);
    assert.equal(await probeSession({ ...base, control_token: "wrong" }), false);
    await assert.rejects(
      () => requestSessionStop({ ...base, control_token: "wrong" }),
      /refused the stop request/i,
    );
    await requestSessionStop(base);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stops, 1);
  } finally {
    await control.close();
  }
});

test("managed sessions register after readiness and clean up jobs and registry on stop", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-supervisor-"));
  const registryPath = join(root, "sessions.json");
  const child = new FakeServerProcess();
  const lifecycle: string[] = [];
  let readySession: FlowmarkSession | undefined;

  try {
    const running = runManagedSession({
      id: "session_managed",
      mode: "foreground",
      workspaceRoot: root,
      registryPath,
      installSignalHandlers: false,
      readyTimeoutMs: 1_000,
      startJobs: async () => {
        lifecycle.push("jobs-started");
        return () => lifecycle.push("jobs-stopped");
      },
      spawnServer: () => {
        lifecycle.push("server-started");
        queueMicrotask(() => child.stdout.write("Local: http://127.0.0.1:4567/\n"));
        return child;
      },
      terminateServer: (server, force) => server.kill(force ? "SIGKILL" : "SIGTERM"),
      onReady: (session) => {
        readySession = session;
        lifecycle.push("ready");
        queueMicrotask(() => void requestSessionStop(session));
      },
    });

    await running;

    assert.equal(readySession?.url, "http://127.0.0.1:4567/");
    assert.deepEqual(lifecycle, ["jobs-started", "server-started", "ready", "jobs-stopped"]);
    assert.deepEqual(child.killedWith, ["SIGTERM"]);
    assert.deepEqual((await readSessionRegistry({ registryPath })).sessions, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("managed sessions can use an in-process production web server", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-supervisor-"));
  const registryPath = join(root, "sessions.json");
  const lifecycle: string[] = [];

  try {
    await runManagedSession({
      id: "session_embedded",
      mode: "daemon",
      workspaceRoot: root,
      registryPath,
      installSignalHandlers: false,
      startJobs: async () => {
        lifecycle.push("jobs-started");
        return () => lifecycle.push("jobs-stopped");
      },
      startWebServer: async (workspaceRoot) => {
        assert.equal(workspaceRoot, root);
        lifecycle.push("server-started");
        return {
          url: "http://127.0.0.1:4321/",
          close: async () => {
            lifecycle.push("server-stopped");
          },
        };
      },
      spawnServer: () => {
        throw new Error("production sessions must not spawn Vite");
      },
      onReady: (session) => {
        assert.equal(session.url, "http://127.0.0.1:4321/");
        lifecycle.push("ready");
        queueMicrotask(() => void requestSessionStop(session));
      },
    });

    assert.deepEqual(lifecycle, [
      "jobs-started",
      "server-started",
      "ready",
      "server-stopped",
      "jobs-stopped",
    ]);
    assert.deepEqual((await readSessionRegistry({ registryPath })).sessions, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup failure never leaves a registered session and still stops jobs", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-supervisor-"));
  const registryPath = join(root, "sessions.json");
  const child = new FakeServerProcess();
  let jobsStopped = false;

  try {
    await assert.rejects(
      () =>
        runManagedSession({
          id: "session_failed",
          mode: "daemon",
          workspaceRoot: root,
          registryPath,
          installSignalHandlers: false,
          readyTimeoutMs: 1_000,
          startJobs: async () => () => {
            jobsStopped = true;
          },
          spawnServer: () => {
            queueMicrotask(() => child.emit("exit", 1, null));
            return child;
          },
          terminateServer: (server, force) => server.kill(force ? "SIGKILL" : "SIGTERM"),
        }),
      /before becoming ready/i,
    );

    assert.equal(jobsStopped, true);
    assert.deepEqual((await readSessionRegistry({ registryPath })).sessions, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readiness timeout terminates the server instead of leaving an orphan process", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-supervisor-"));
  const registryPath = join(root, "sessions.json");
  const child = new FakeServerProcess();

  try {
    await assert.rejects(
      () =>
        runManagedSession({
          id: "session_timeout",
          mode: "daemon",
          workspaceRoot: root,
          registryPath,
          installSignalHandlers: false,
          readyTimeoutMs: 5,
          startJobs: async () => () => {},
          spawnServer: () => child,
          terminateServer: (server, force) => server.kill(force ? "SIGKILL" : "SIGTERM"),
        }),
      /did not become ready/i,
    );

    assert.deepEqual(child.killedWith, ["SIGTERM"]);
    assert.deepEqual((await readSessionRegistry({ registryPath })).sessions, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
