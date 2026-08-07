import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli, type DaemonLaunchOptions } from "../src/cli.ts";
import {
  canonicalizeWorkspacePath,
  readSessionRegistry,
  registerSession,
  unregisterSession,
  type FlowmarkSession,
} from "../src/lib/session-registry.ts";

function session(
  id: string,
  workspacePath: string,
  mode: FlowmarkSession["mode"] = "daemon",
): FlowmarkSession {
  return {
    id,
    mode,
    pid: 987,
    workspace_path: workspacePath,
    url: "http://127.0.0.1:4789/",
    started_at: "2026-07-28T10:00:00.000Z",
    ready_at: "2026-07-28T10:00:01.000Z",
    updated_at: "2026-07-28T10:00:01.000Z",
    control_url: "http://127.0.0.1:50000",
    control_token: "test-token",
  };
}

async function initializeWorkspaceWithCard(root: string) {
  assert.equal((await runCli(["init"], { cwd: root, write: () => {} })).exitCode, 0);
  await writeFile(
    join(root, "cards/card_review.md"),
    `---
schema_version: 1
id: card_review
title: Review document
column_id: column_inbox
position: 1024
completed: false
completed_at: null
due_at: null
tag_ids: []
checklist_ids: []
comment_ids: []
created_at: 2026-08-07T10:00:00Z
updated_at: 2026-08-07T10:00:00Z
archived_at: null
---

Review this card.
`,
    "utf8",
  );
}

test("help documents daemon, list, and exact session stop commands", async () => {
  const output: string[] = [];
  assert.equal((await runCli(["--help"], { write: (line) => output.push(line) })).exitCode, 0);

  const help = output.join("\n");
  assert.match(help, /flowmark \[serve\] --daemon/);
  assert.match(help, /flowmark list/);
  assert.match(help, /flowmark stop <id>/);
  assert.match(help, /flowmark link <card-id>/);
  assert.match(help, /flowmark links install/);
  assert.match(help, /--format terminal\|raw\|markdown.*default: terminal/);
});

test("links install delegates explicit machine setup to the standalone adapter", async () => {
  const output: string[] = [];
  let installed = 0;
  const result = await runCli(["links", "install"], {
    installCardLinkHandler: async () => {
      installed++;
      return { appPath: "/Users/test/.flowmark/apps/Flowmark Card Links.app" };
    },
    write: (line) => output.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(installed, 1);
  assert.match(output.join("\n"), /Installed Flowmark card link handler/);
  assert.match(output.join("\n"), /Flowmark Card Links\.app/);
});

test("source mode refuses machine-level link handler installation", async () => {
  const output: string[] = [];
  const result = await runCli(["links", "install"], { write: (line) => output.push(line) });
  assert.equal(result.exitCode, 1);
  assert.match(output.join("\n"), /standalone binary/);
});

test("custom URL handling resolves the exact live session and asks Safari to reuse it", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-cli-open-link-"));
  const registryPath = join(root, "global", "sessions.json");
  const opened: Array<{ sessionUrl: string; cardId: string }> = [];
  try {
    await initializeWorkspaceWithCard(root);
    const canonicalRoot = await canonicalizeWorkspacePath(root);
    await registerSession(session("session_live", canonicalRoot), { registryPath });
    const url = `flowmark://open?workspace=${encodeURIComponent(canonicalRoot)}&card=card_review`;

    const result = await runCli(["__open-url", url], {
      cwd: "/outside/workspace",
      registryPath,
      probeSession: async () => true,
      openCardInSafari: async (sessionUrl, cardId) => {
        opened.push({ sessionUrl, cardId });
      },
      write: () => {},
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(opened, [{ sessionUrl: "http://127.0.0.1:4789/", cardId: "card_review" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("custom URL handling rejects malformed links before opening Safari", async () => {
  const opened: string[] = [];
  const output: string[] = [];
  const result = await runCli(["__open-url", "flowmark://wrong"], {
    openCardInSafari: async () => {
      opened.push("opened");
    },
    write: (line) => output.push(line),
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(opened, []);
  assert.match(output.join("\n"), /Invalid Flowmark card link/);
});

test("link prints terminal, raw, or Markdown custom URLs for an active card in a live workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-cli-link-"));
  const registryPath = join(root, "global", "sessions.json");
  try {
    await initializeWorkspaceWithCard(root);
    const canonicalRoot = await canonicalizeWorkspacePath(root);
    await registerSession(session("session_live", canonicalRoot), { registryPath });

    const url = `flowmark://open?workspace=${encodeURIComponent(canonicalRoot)}&card=card_review`;
    const terminalLink = `\u001b]8;;${url}\u001b\\Open in Flowmark\u001b]8;;\u001b\\`;

    const defaultOutput: string[] = [];
    assert.equal(
      (
        await runCli(["link", "card_review"], {
          cwd: root,
          registryPath,
          probeSession: async () => true,
          write: (line) => defaultOutput.push(line),
        })
      ).exitCode,
      0,
    );
    assert.equal(defaultOutput[0], terminalLink);

    const terminal: string[] = [];
    assert.equal(
      (
        await runCli(["link", "card_review", "--format", "terminal"], {
          cwd: root,
          registryPath,
          probeSession: async () => true,
          write: (line) => terminal.push(line),
        })
      ).exitCode,
      0,
    );
    assert.equal(terminal[0], terminalLink);

    const raw: string[] = [];
    assert.equal(
      (
        await runCli(["link", "card_review", "--format", "raw"], {
          cwd: root,
          registryPath,
          probeSession: async () => true,
          write: (line) => raw.push(line),
        })
      ).exitCode,
      0,
    );
    assert.equal(raw[0], url);

    const markdown: string[] = [];
    assert.equal(
      (
        await runCli(["link", "card_review", "--format", "markdown"], {
          cwd: root,
          registryPath,
          probeSession: async () => true,
          write: (line) => markdown.push(line),
        })
      ).exitCode,
      0,
    );
    assert.equal(markdown[0], `[Open in Flowmark](${url})`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("link rejects missing cards, invalid formats, and workspaces without a live session", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-cli-link-"));
  const registryPath = join(root, "global", "sessions.json");
  try {
    await initializeWorkspaceWithCard(root);
    const canonicalRoot = await canonicalizeWorkspacePath(root);
    await registerSession(session("session_stale", canonicalRoot), { registryPath });

    for (const [args, probe, expected] of [
      [["link", "card_missing"], async () => true, /No active Flowmark card/],
      [["link", "card_review", "--format", "html"], async () => true, /terminal, raw, or markdown/],
      [["link", "card_review"], async () => false, /No running Flowmark session/],
    ] as const) {
      const output: string[] = [];
      const result = await runCli([...args], {
        cwd: root,
        registryPath,
        probeSession: probe,
        write: (line) => output.push(line),
      });
      assert.notEqual(result.exitCode, 0);
      assert.match(output.join("\n"), expected);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("list works outside a workspace, prunes stale entries, and prints live session details", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-cli-sessions-"));
  const registryPath = join(root, "sessions.json");
  const output: string[] = [];
  try {
    await registerSession(session("session_live", "/workspace/live"), { registryPath });
    await registerSession(session("session_stale", "/workspace/stale"), { registryPath });

    const result = await runCli(["list"], {
      cwd: "/does/not/need/a/workspace",
      registryPath,
      probeSession: async (entry) => entry.id === "session_live",
      write: (line) => output.push(line),
    });

    assert.equal(result.exitCode, 0);
    assert.match(output.join("\n"), /session_live/);
    assert.match(output.join("\n"), /daemon/);
    assert.match(output.join("\n"), /http:\/\/127\.0\.0\.1:4789\//);
    assert.match(output.join("\n"), /\/workspace\/live/);
    assert.match(output.join("\n"), /PID 987/);
    assert.match(output.join("\n"), /2026-07-28T10:00:00.000Z/);
    assert.doesNotMatch(output.join("\n"), /session_stale/);
    assert.deepEqual(
      (await readSessionRegistry({ registryPath })).sessions.map((entry) => entry.id),
      ["session_live"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stop works outside a workspace and removes the exact requested session", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-cli-sessions-"));
  const registryPath = join(root, "sessions.json");
  const output: string[] = [];
  const stopped: string[] = [];
  try {
    await registerSession(session("session_one", "/workspace/one"), { registryPath });
    await registerSession(session("session_two", "/workspace/two"), { registryPath });

    const result = await runCli(["stop", "session_two"], {
      cwd: "/does/not/need/a/workspace",
      registryPath,
      probeSession: async () => true,
      requestSessionStop: async (entry) => {
        stopped.push(entry.id);
        await unregisterSession(entry.id, { registryPath });
      },
      write: (line) => output.push(line),
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(stopped, ["session_two"]);
    assert.match(output.join("\n"), /Stopped Flowmark session session_two/);
    assert.deepEqual(
      (await readSessionRegistry({ registryPath })).sessions.map((entry) => entry.id),
      ["session_one"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stop reports missing IDs without validating the current directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-cli-sessions-"));
  const output: string[] = [];
  try {
    const result = await runCli(["stop", "session_missing"], {
      cwd: "/not/a/workspace",
      registryPath: join(root, "sessions.json"),
      write: (line) => output.push(line),
    });

    assert.equal(result.exitCode, 1);
    assert.match(output.join("\n"), /No running Flowmark session with ID "session_missing"/);
    assert.doesNotMatch(output.join("\n"), /flowmark init/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("--daemon validates, launches one canonical workspace session, and prints URL first", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-cli-daemon-"));
  const registryPath = join(root, "global", "sessions.json");
  const output: string[] = [];
  try {
    assert.equal((await runCli(["init"], { cwd: root, write: () => {} })).exitCode, 0);
    const canonicalRoot = await canonicalizeWorkspacePath(root);

    const result = await runCli(["--daemon"], {
      cwd: root,
      registryPath,
      probeSession: async () => true,
      launchDaemon: async ({ id, workspaceRoot, logPath }) => {
        await registerSession(
          {
            ...session(id, workspaceRoot),
            log_path: logPath,
          },
          { registryPath },
        );
      },
      write: (line) => output.push(line),
      sessionPollIntervalMs: 1,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(output[0], "http://127.0.0.1:4789/");
    assert.match(output[1] ?? "", /^Session: session_/);
    const registered = (await readSessionRegistry({ registryPath })).sessions[0];
    assert.equal(registered?.workspace_path, canonicalRoot);
    assert.equal(registered?.mode, "daemon");

    const reused: string[] = [];
    assert.equal(
      (
        await runCli(["serve", "--daemon"], {
          cwd: root,
          registryPath,
          probeSession: async () => true,
          launchDaemon: async () => {
            throw new Error("must not launch a duplicate");
          },
          write: (line) => reused.push(line),
        })
      ).exitCode,
      0,
    );
    assert.equal(reused[0], registered?.url);
    assert.match(reused[1] ?? "", /already running/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("daemon readiness timeout stops the owned child and reports its log", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-cli-daemon-"));
  let stopped = false;
  const output: string[] = [];
  try {
    assert.equal((await runCli(["init"], { cwd: root, write: () => {} })).exitCode, 0);
    const result = await runCli(["--daemon"], {
      cwd: root,
      registryPath: join(root, "global", "sessions.json"),
      launchDaemon: async () => ({
        pid: 42,
        stop: () => {
          stopped = true;
        },
      }),
      sessionPollIntervalMs: 1,
      sessionReadyTimeoutMs: 5,
      write: (line) => output.push(line),
    });

    assert.equal(result.exitCode, 1);
    assert.equal(stopped, true);
    assert.match(output.join("\n"), /did not become ready/);
    assert.match(output.join("\n"), /\.log/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stop finds its ID after leading flags", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-cli-sessions-"));
  const registryPath = join(root, "sessions.json");
  try {
    await registerSession(session("session_flagged", "/workspace/flagged"), { registryPath });
    const result = await runCli(["--strict", "stop", "session_flagged"], {
      registryPath,
      probeSession: async () => true,
      requestSessionStop: async (entry) =>
        unregisterSession(entry.id, { registryPath }).then(() => {}),
      sessionPollIntervalMs: 1,
      write: () => {},
    });
    assert.equal(result.exitCode, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent daemon starts serialize and create only one workspace session", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-cli-daemon-"));
  const registryPath = join(root, "global", "sessions.json");
  let launches = 0;
  try {
    assert.equal((await runCli(["init"], { cwd: root, write: () => {} })).exitCode, 0);
    const options = {
      cwd: root,
      registryPath,
      probeSession: async () => true,
      launchDaemon: async ({ id, workspaceRoot, logPath }: DaemonLaunchOptions) => {
        launches++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        await registerSession(
          { ...session(id, workspaceRoot), log_path: logPath },
          { registryPath },
        );
      },
      sessionPollIntervalMs: 1,
      write: () => {},
    };

    const [first, second] = await Promise.all([
      runCli(["--daemon"], options),
      runCli(["--daemon"], options),
    ]);

    assert.equal(first.exitCode, 0);
    assert.equal(second.exitCode, 0);
    assert.equal(launches, 1);
    assert.equal((await readSessionRegistry({ registryPath })).sessions.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
