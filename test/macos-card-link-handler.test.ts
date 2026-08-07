import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCardLinkHandlerAppleScript,
  installMacosCardLinkHandler,
  openCardInSafari,
  SAFARI_CARD_OPEN_SCRIPT,
} from "../src/lib/macos-card-link-handler.ts";

test("handler AppleScript passes the custom URL to the exact installed executable", () => {
  const source = buildCardLinkHandlerAppleScript('/Applications/Flowmark "Local"/flowmark');
  assert.match(source, /on open location flowmarkURL/);
  assert.match(source, /__open-url/);
  assert.match(source, /quoted form of flowmarkURL/);
  assert.match(source, /Flowmark \\"Local\\"/);
});

test("Safari opening passes URLs as arguments and reuses a matching tab before falling back", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  await openCardInSafari("http://127.0.0.1:4789/", "card_review", {
    fileExists: async () => false,
    run: async (command, args) => {
      calls.push({ command, args });
    },
  });

  assert.deepEqual(calls, [
    {
      command: "osascript",
      args: [
        "-e",
        SAFARI_CARD_OPEN_SCRIPT,
        "--",
        "http://127.0.0.1:4789/",
        "http://127.0.0.1:4789/?card=card_review",
      ],
    },
  ]);
  assert.match(SAFARI_CARD_OPEN_SCRIPT, /starts with sessionURL/);
  assert.match(SAFARI_CARD_OPEN_SCRIPT, /set current tab of targetWindow to targetTab/);
  assert.match(SAFARI_CARD_OPEN_SCRIPT, /make new document/);
  assert.doesNotMatch(SAFARI_CARD_OPEN_SCRIPT, /card_review|4789/);
});

test("opening reuses the installed FlowMark Safari Web App when its origin matches", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  await openCardInSafari("http://127.0.0.1:4789/", "card_review", {
    homeDirectory: "/Users/example",
    fileExists: async (path) => path === "/Users/example/Applications/FlowMark.app",
    readWebAppStartUrl: async () => "http://127.0.0.1:4789/",
    run: async (command, args) => {
      calls.push({ command, args });
    },
  });

  assert.deepEqual(calls, [
    {
      command: "open",
      args: [
        "-a",
        "/Users/example/Applications/FlowMark.app",
        "http://127.0.0.1:4789/?card=card_review",
      ],
    },
  ]);
});

test("opening falls back to a matching Safari tab when the Web App has another origin", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  await openCardInSafari("http://127.0.0.1:4789/", "card_review", {
    homeDirectory: "/Users/example",
    fileExists: async (path) => path === "/Users/example/Applications/FlowMark.app",
    readWebAppStartUrl: async () => "http://127.0.0.1:3000/",
    run: async (command, args) => {
      calls.push({ command, args });
    },
  });

  assert.deepEqual(calls, [
    {
      command: "osascript",
      args: [
        "-e",
        SAFARI_CARD_OPEN_SCRIPT,
        "--",
        "http://127.0.0.1:4789/",
        "http://127.0.0.1:4789/?card=card_review",
      ],
    },
  ]);
});

test("installer compiles and registers a rebuildable user-local URL handler", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-handler-test-"));
  const calls: Array<{ command: string; args: string[] }> = [];
  let source = "";
  try {
    const result = await installMacosCardLinkHandler({
      executablePath: join(root, "bin", "flowmark"),
      homeDirectory: root,
      platform: "darwin",
      run: async (command, args) => {
        calls.push({ command, args });
        if (command === "osacompile") {
          source = await readFile(args.at(-1)!, "utf8");
          await mkdir(args[args.indexOf("-o") + 1]!, { recursive: true });
        }
      },
    });

    assert.equal(result.appPath, join(root, ".flowmark/apps/Flowmark Card Links.app"));
    assert.match(source, /__open-url/);
    assert.ok(calls.some(({ command }) => command === "osacompile"));
    assert.ok(calls.some(({ command }) => command === "plutil"));
    assert.ok(calls.some(({ command }) => command.endsWith("lsregister")));
    const automationDescription = calls.find(({ args }) =>
      args.includes("NSAppleEventsUsageDescription"),
    );
    assert.equal(automationDescription?.args[0], "-replace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installer rejects unsupported platforms without touching the filesystem", async () => {
  await assert.rejects(
    () =>
      installMacosCardLinkHandler({
        executablePath: "/tmp/flowmark",
        homeDirectory: "/tmp/home",
        platform: "linux",
        run: async () => {
          throw new Error("must not run");
        },
      }),
    /macOS only/,
  );
});
