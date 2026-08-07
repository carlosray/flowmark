#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

interface CommandResult {
  stdout: string;
  stderr: string;
}

export function extractDaemonDetails(output: string) {
  const url = output.match(/https?:\/\/[^\s]+/)?.[0];
  const id = output.match(/Session:\s+([A-Za-z0-9_-]+)/)?.[1];
  if (!url || !id) {
    throw new Error(`Daemon output did not contain a URL and session ID:\n${output}`);
  }
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`Daemon did not bind to a loopback address: ${url}`);
  }
  return { id, url };
}

export function extractAssetPath(html: string) {
  const matches = html.matchAll(/(?:href|src)=["']([^"']+\.(?:css|js)(?:\?[^"']*)?)["']/gi);
  for (const match of matches) {
    const path = match[1];
    if (path?.startsWith("/")) return path;
  }
  throw new Error("Rendered Flowmark page did not reference a built CSS or JavaScript asset.");
}

async function run(
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<CommandResult> {
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const timeout = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 45_000);
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  }).finally(() => clearTimeout(timeout));
  if (exitCode !== 0) {
    throw new Error(
      `${basename(executable)} ${args.join(" ")} exited with ${exitCode}.\n${stdout}${stderr}`,
    );
  }
  return { stdout, stderr };
}

async function fetchReady(url: string, attempts = 30) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError instanceof Error ? lastError : new Error(`Could not fetch ${url}`);
}

function flagValue(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function smokeBinary(args = process.argv.slice(2)) {
  const sourceBinary = resolve(flagValue(args, "--binary") ?? "dist/flowmark");
  await access(sourceBinary);

  const root = await mkdtemp(join(tmpdir(), "flowmark-binary-smoke-"));
  const workspace = join(root, "workspace");
  const fakeHome = join(root, "home");
  const standaloneBinary = join(root, "flowmark");
  let sessionId: string | undefined;
  const env = {
    ...process.env,
    HOME: fakeHome,
    USERPROFILE: fakeHome,
  };

  try {
    await mkdir(workspace);
    await mkdir(fakeHome);
    await cp(sourceBinary, standaloneBinary);
    await chmod(standaloneBinary, 0o755);

    const help = await run(standaloneBinary, ["--help"], {
      cwd: root,
      env,
    });
    if (!help.stdout.includes("flowmark update")) {
      throw new Error(`Standalone help does not expose the update command:\n${help.stdout}`);
    }

    const initialized = await run(standaloneBinary, ["init"], {
      cwd: workspace,
      env,
    });
    if (!initialized.stdout.includes("Initialized Flowmark workspace.")) {
      throw new Error(`Unexpected init output:\n${initialized.stdout}`);
    }

    const requiredPaths = [
      "flowmark.yaml",
      "AGENTS.md",
      "cards",
      "columns",
      "tags",
      "rules",
      "comments",
      "checklists",
      "templates",
      "archive/cards",
    ];
    await Promise.all(requiredPaths.map((path) => access(join(workspace, path))));

    const validation = await run(standaloneBinary, ["validate", "--strict"], {
      cwd: workspace,
      env,
    });
    if (!validation.stdout.includes("Workspace validation succeeded with 0 warning(s).")) {
      throw new Error(`Unexpected validation output:\n${validation.stdout}`);
    }

    const daemon = await run(standaloneBinary, ["--daemon"], {
      cwd: workspace,
      env,
      timeoutMs: 60_000,
    });
    const details = extractDaemonDetails(`${daemon.stdout}\n${daemon.stderr}`);
    sessionId = details.id;

    const page = await fetchReady(details.url);
    const html = await page.text();
    if (!html.toLowerCase().includes("flowmark")) {
      throw new Error("Standalone server response did not contain the Flowmark application.");
    }
    const assetUrl = new URL(extractAssetPath(html), details.url);
    const asset = await fetchReady(assetUrl.toString());
    if (!(asset.headers.get("content-type") ?? "").match(/text\/(css|javascript)/)) {
      throw new Error(`Unexpected asset content type: ${asset.headers.get("content-type")}`);
    }

    const listed = await run(standaloneBinary, ["list"], {
      cwd: root,
      env,
    });
    if (
      !listed.stdout.includes(details.id) ||
      !listed.stdout.includes(workspace) ||
      !listed.stdout.includes(details.url)
    ) {
      throw new Error(`Session was not globally discoverable:\n${listed.stdout}`);
    }

    const stopped = await run(standaloneBinary, ["stop", details.id], {
      cwd: root,
      env,
    });
    sessionId = undefined;
    if (!stopped.stdout.includes(`Stopped Flowmark session ${details.id}.`)) {
      throw new Error(`Unexpected stop output:\n${stopped.stdout}`);
    }

    const emptyList = await run(standaloneBinary, ["list"], {
      cwd: root,
      env,
    });
    if (!emptyList.stdout.includes("No running Flowmark sessions.")) {
      throw new Error(`Stopped session remained registered:\n${emptyList.stdout}`);
    }

    const agents = await readFile(join(workspace, "AGENTS.md"), "utf8");
    if (!agents.includes("flowmark validate --strict")) {
      throw new Error("Initialized AGENTS.md does not explain strict validation.");
    }
    if (!agents.includes("flowmark-card-links: ask") || !/`flowmark link <card_id>`/.test(agents)) {
      throw new Error("Initialized AGENTS.md does not explain opt-in live card links.");
    }
    if (/flowmark link <card_id>\s+--format\b/.test(agents)) {
      throw new Error("Initialized AGENTS.md pins an explicit card-link format.");
    }
    console.log(`Standalone binary smoke test passed: ${details.url}`);
  } finally {
    if (sessionId) {
      await run(standaloneBinary, ["stop", sessionId], {
        cwd: root,
        env,
        timeoutMs: 10_000,
      }).catch(() => {});
    }
    await rm(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await smokeBinary().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
