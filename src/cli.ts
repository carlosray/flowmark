#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { ensureRuntimeDirectories, initializeWorkspace } from "./lib/workspace/initializer.ts";
import { startWorkspaceJobs } from "./lib/workspace/rule-runner.ts";
import {
  COMPONENT_NAMES,
  formatComponentSchemas,
  isComponentName,
  type SchemaFormat,
} from "./lib/workspace/schema-catalog.ts";
import { type Diagnostic, validateWorkspace } from "./lib/workspace/validator.ts";
import {
  acquireWorkspaceLaunchLock,
  canonicalizeWorkspacePath,
  createSessionId,
  findSessionByWorkspace,
  getSessionRegistryPath,
  pruneStaleSessions,
  readSessionRegistry,
  unregisterSession,
  type FlowmarkSession,
} from "./lib/session-registry.ts";
import {
  probeSession as probeManagedSession,
  requestSessionStop as requestManagedSessionStop,
  runManagedSession,
} from "./lib/session-supervisor.ts";
import type { StartLocalWebServer } from "./lib/local-web-server.ts";
import {
  buildFlowmarkCardUrl,
  CARD_LINK_FORMATS,
  type CardLinkFormat,
  formatFlowmarkCardLink,
  parseFlowmarkCardUrl,
} from "./lib/card-links.ts";
import { openCardInSafari as openCardInSafariDefault } from "./lib/macos-card-link-handler.ts";

export { LOCAL_DEV_SERVER_ARGS } from "./lib/session-supervisor.ts";

export interface DaemonLaunchOptions {
  id: string;
  workspaceRoot: string;
  registryPath?: string;
  logPath: string;
}

export interface DaemonLaunchResult {
  pid?: number;
  stop?: () => void | Promise<void>;
}

export interface CliOptions {
  cwd?: string;
  startJobs?: (workspaceRoot: string) => Promise<() => void>;
  startServer?: () => Promise<void>;
  startWebServer?: StartLocalWebServer;
  registryPath?: string;
  probeSession?: (session: FlowmarkSession) => Promise<boolean>;
  requestSessionStop?: (session: FlowmarkSession) => Promise<void>;
  launchDaemon?: (options: DaemonLaunchOptions) => Promise<DaemonLaunchResult | void>;
  runUpdate?: () => Promise<{ asset: string; executablePath: string; warning?: string }>;
  installCardLinkHandler?: () => Promise<{ appPath: string }>;
  openCardInSafari?: (sessionUrl: string, cardId: string) => Promise<void>;
  sessionPollIntervalMs?: number;
  sessionReadyTimeoutMs?: number;
  write?: (message: string) => void;
}

export interface CliResult {
  exitCode: number;
}

export const HELP_TEXT = `Usage: flowmark [command] [options]

Commands:
  flowmark              Validate and start the local UI
  flowmark serve        Validate and start the local UI
  flowmark list         List running Flowmark UI sessions
  flowmark stop <id>    Stop one running Flowmark UI session
  flowmark link <card-id>
                        Print a live card link for this workspace
  flowmark links install
                        Install the macOS flowmark:// URL handler
  flowmark init         Create or verify a Flowmark workspace
  flowmark update       Install the latest release over this executable
  flowmark validate     Validate source files without changing them
  flowmark repair       Rebuild disposable .flowmark runtime directories
  flowmark schema       List component schemas
  flowmark schema NAME  Print one component schema

Options:
  flowmark [serve] --daemon
                        Start the local UI in the background
  --strict              Treat unknown fields as validation errors
  --all                 Print every component schema
  --format yaml|json    Select schema output format (default: yaml)
  --format terminal|raw|markdown Select card link output format (default: terminal)
  -h, --help            Show this help`;

const SCHEMA_HELP = `Available component schemas: ${COMPONENT_NAMES.join(", ")}

Usage:
  flowmark schema
  flowmark schema rule
  flowmark schema card --format json
  flowmark schema --all --format yaml`;

function formatDiagnostic(diagnostic: Diagnostic) {
  return [
    diagnostic.code,
    "",
    `File: ${diagnostic.filePath}`,
    `Field: ${diagnostic.fieldPath || "(file)"}`,
    ...(diagnostic.value === undefined ? [] : [`Value: ${diagnostic.value}`]),
    "",
    diagnostic.message,
    "",
    "Suggested fix:",
    `- ${diagnostic.suggestion}`,
  ].join("\n");
}

function reportDiagnostics(diagnostics: Diagnostic[], write: (message: string) => void) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  if (errors.length === 0) {
    write(`Workspace validation succeeded with ${warnings.length} warning(s).`);
  } else {
    write(
      `Workspace validation failed with ${errors.length} error(s) and ${warnings.length} warning(s).`,
    );
  }
  for (const diagnostic of diagnostics) write(`\n${formatDiagnostic(diagnostic)}`);
}

function flagValue(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function serveWarnings(diagnostics: Diagnostic[], write: (message: string) => void) {
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  if (warnings.length === 0) return;
  write(`Workspace validation succeeded with ${warnings.length} warning(s).`);
  for (const diagnostic of warnings) write(`\n${formatDiagnostic(diagnostic)}`);
}

function sessionLogPath(id: string, registryPath?: string) {
  const resolvedRegistryPath = registryPath ?? getSessionRegistryPath();
  return join(dirname(resolvedRegistryPath), "logs", `${id}.log`);
}

async function defaultLaunchDaemon(options: DaemonLaunchOptions) {
  await mkdir(dirname(options.logPath), { recursive: true });
  const log = await open(options.logPath, "a", 0o600);
  const cliPath = process.argv[1] ?? fileURLToPath(import.meta.url);
  const args = [
    cliPath,
    "__session",
    "--workspace",
    options.workspaceRoot,
    "--session-id",
    options.id,
    "--mode",
    "daemon",
    "--ready-timeout-ms",
    "30000",
    "--log-path",
    options.logPath,
    ...(options.registryPath ? ["--registry-path", options.registryPath] : []),
  ];

  try {
    const child = spawn(process.execPath, args, {
      cwd: options.workspaceRoot,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: { ...process.env },
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return {
      pid: child.pid,
      stop: () => {
        if (child.pid) process.kill(child.pid, "SIGTERM");
      },
    };
  } finally {
    await log.close();
  }
}

async function waitForSession(
  id: string,
  options: Pick<CliOptions, "registryPath" | "sessionPollIntervalMs" | "sessionReadyTimeoutMs">,
) {
  const deadline = Date.now() + (options.sessionReadyTimeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    const session = (
      await readSessionRegistry({ registryPath: options.registryPath })
    ).sessions.find((entry) => entry.id === id);
    if (session) return session;
    await delay(options.sessionPollIntervalMs ?? 50);
  }
  return undefined;
}

async function waitForSessionRemoval(id: string, options: CliOptions) {
  const deadline = Date.now() + (options.sessionReadyTimeoutMs ?? 10_000);
  while (Date.now() < deadline) {
    const exists = (
      await readSessionRegistry({ registryPath: options.registryPath })
    ).sessions.some((entry) => entry.id === id);
    if (!exists) return true;
    await delay(options.sessionPollIntervalMs ?? 50);
  }
  return false;
}

async function listSessions(options: CliOptions, write: (message: string) => void) {
  const result = await pruneStaleSessions({
    registryPath: options.registryPath,
    probe: options.probeSession ?? probeManagedSession,
  });
  if (result.sessions.length === 0) {
    write("No running Flowmark sessions.");
    return { exitCode: 0 };
  }

  for (const session of result.sessions) {
    write(
      [
        `${session.id}  ${session.mode}  ${session.url}`,
        `  Workspace: ${session.workspace_path}`,
        `  PID ${session.pid} · Started ${session.started_at}`,
      ].join("\n"),
    );
  }
  return { exitCode: 0 };
}

async function stopSession(
  id: string | undefined,
  options: CliOptions,
  write: (message: string) => void,
) {
  if (!id) {
    write("Usage: flowmark stop <id>");
    return { exitCode: 2 };
  }
  const session = (await readSessionRegistry({ registryPath: options.registryPath })).sessions.find(
    (entry) => entry.id === id,
  );
  if (!session) {
    write(`No running Flowmark session with ID "${id}".`);
    return { exitCode: 1 };
  }
  if (!(await (options.probeSession ?? probeManagedSession)(session))) {
    await unregisterSession(id, { registryPath: options.registryPath });
    write(`Flowmark session ${id} is no longer running; removed its stale registry entry.`);
    return { exitCode: 1 };
  }

  await (options.requestSessionStop ?? requestManagedSessionStop)(session);
  if (!(await waitForSessionRemoval(id, options))) {
    write(`Timed out waiting for Flowmark session ${id} to stop.`);
    return { exitCode: 1 };
  }
  write(`Stopped Flowmark session ${id}.`);
  return { exitCode: 0 };
}

async function linkCard(
  cardId: string | undefined,
  args: string[],
  options: CliOptions,
  write: (message: string) => void,
) {
  if (!cardId) {
    write("Usage: flowmark link <card-id> [--format terminal|raw|markdown]");
    return { exitCode: 2 };
  }
  const format = flagValue(args, "--format") ?? "terminal";
  if (!CARD_LINK_FORMATS.includes(format as CardLinkFormat)) {
    write("Unknown card link format. Use terminal, raw, or markdown.");
    return { exitCode: 2 };
  }

  let workspaceRoot: string;
  try {
    workspaceRoot = await canonicalizeWorkspacePath(options.cwd ?? process.cwd());
  } catch {
    write("Current directory is not a Flowmark workspace. Run this command from its root.");
    return { exitCode: 1 };
  }
  const validation = await validateWorkspace(workspaceRoot, { strict: true });
  if (validation.errors.length > 0) {
    reportDiagnostics([...validation.errors, ...validation.warnings], write);
    return { exitCode: 1 };
  }
  const card = validation.workspace?.cards.get(cardId);
  if (!card || card.archived) {
    write(`No active Flowmark card with ID "${cardId}" exists in this workspace.`);
    return { exitCode: 1 };
  }

  const sessions = await pruneStaleSessions({
    registryPath: options.registryPath,
    probe: options.probeSession ?? probeManagedSession,
  });
  if (!findSessionByWorkspace(sessions.sessions, workspaceRoot)) {
    write("No running Flowmark session exists for this workspace. Start it with `flowmark`.");
    return { exitCode: 1 };
  }

  const url = buildFlowmarkCardUrl(workspaceRoot, cardId);
  write(formatFlowmarkCardLink(url, format as CardLinkFormat));
  return { exitCode: 0 };
}

async function installCardLinks(options: CliOptions, write: (message: string) => void) {
  if (!options.installCardLinkHandler) {
    write(
      "Card link installation requires the standalone binary. Build it with `bun run binary`, then run `dist/flowmark links install`.",
    );
    return { exitCode: 1 };
  }
  const result = await options.installCardLinkHandler();
  write(`Installed Flowmark card link handler: ${result.appPath}`);
  write("The first card link may ask for permission to control Safari.");
  return { exitCode: 0 };
}

async function openCardLink(
  value: string | undefined,
  options: CliOptions,
  write: (message: string) => void,
) {
  if (!value) {
    write("Internal Flowmark URL handler is missing its URL.");
    return { exitCode: 2 };
  }
  const { workspacePath, cardId } = parseFlowmarkCardUrl(value);
  let workspaceRoot: string;
  try {
    workspaceRoot = await canonicalizeWorkspacePath(workspacePath);
  } catch {
    write(`Flowmark workspace no longer exists: ${workspacePath}`);
    return { exitCode: 1 };
  }
  const validation = await validateWorkspace(workspaceRoot, { strict: true });
  if (validation.errors.length > 0) {
    reportDiagnostics([...validation.errors, ...validation.warnings], write);
    return { exitCode: 1 };
  }
  const card = validation.workspace?.cards.get(cardId);
  if (!card || card.archived) {
    write(`No active Flowmark card with ID "${cardId}" exists in ${workspaceRoot}.`);
    return { exitCode: 1 };
  }

  const sessions = await pruneStaleSessions({
    registryPath: options.registryPath,
    probe: options.probeSession ?? probeManagedSession,
  });
  const session = findSessionByWorkspace(sessions.sessions, workspaceRoot);
  if (!session) {
    write(`No running Flowmark session exists for ${workspaceRoot}.`);
    return { exitCode: 1 };
  }

  await (options.openCardInSafari ?? openCardInSafariDefault)(session.url, cardId);
  return { exitCode: 0 };
}

export async function runCli(args: string[], options: CliOptions = {}): Promise<CliResult> {
  const cwd = options.cwd ?? process.cwd();
  const write = options.write ?? console.log;
  if (args.includes("-h") || args.includes("--help") || args[0] === "help") {
    write(HELP_TEXT);
    return { exitCode: 0 };
  }
  const command = args.find((argument) => !argument.startsWith("-")) ?? "serve";
  const commandIndex = args.indexOf(command);
  const strict = args.includes("--strict");
  if (
    ![
      "serve",
      "init",
      "update",
      "validate",
      "repair",
      "schema",
      "list",
      "stop",
      "link",
      "links",
      "__open-url",
      "__session",
    ].includes(command)
  ) {
    write(`Unknown command: ${command}\n\n${HELP_TEXT}`);
    return { exitCode: 2 };
  }
  if (command === "update") {
    if (args.some((_, index) => index !== commandIndex)) {
      write("Usage: flowmark update");
      return { exitCode: 2 };
    }
    if (!options.runUpdate) {
      write(
        "This Flowmark command is running from a source checkout and cannot update itself. Run git pull, then rebuild the standalone binary with `bun run binary`.",
      );
      return { exitCode: 1 };
    }
    try {
      const result = await options.runUpdate();
      write(`Updated Flowmark using ${result.asset}.`);
      write(`Executable: ${result.executablePath}`);
      if (result.warning) write(`Warning: ${result.warning}`);
      write("Restart any running Flowmark sessions to use the updated executable.");
      return { exitCode: 0 };
    } catch (error) {
      write(error instanceof Error ? error.message : String(error));
      return { exitCode: 1 };
    }
  }
  if (command === "list") {
    try {
      return await listSessions(options, write);
    } catch (error) {
      write(error instanceof Error ? error.message : String(error));
      return { exitCode: 1 };
    }
  }
  if (command === "stop") {
    try {
      const id = args.slice(commandIndex + 1).find((argument) => !argument.startsWith("-"));
      return await stopSession(id, options, write);
    } catch (error) {
      write(error instanceof Error ? error.message : String(error));
      return { exitCode: 1 };
    }
  }
  if (command === "link") {
    try {
      const cardId = args.slice(commandIndex + 1).find((argument) => !argument.startsWith("-"));
      return await linkCard(cardId, args, { ...options, cwd }, write);
    } catch (error) {
      write(error instanceof Error ? error.message : String(error));
      return { exitCode: 1 };
    }
  }
  if (command === "links") {
    if (args[commandIndex + 1] !== "install" || args.length !== commandIndex + 2) {
      write("Usage: flowmark links install");
      return { exitCode: 2 };
    }
    try {
      return await installCardLinks(options, write);
    } catch (error) {
      write(error instanceof Error ? error.message : String(error));
      return { exitCode: 1 };
    }
  }
  if (command === "__open-url") {
    try {
      return await openCardLink(args[commandIndex + 1], options, write);
    } catch (error) {
      write(error instanceof Error ? error.message : String(error));
      return { exitCode: 1 };
    }
  }
  if (command === "schema") {
    const formatIndex = args.indexOf("--format");
    const formatValue = formatIndex >= 0 ? args[formatIndex + 1] : "yaml";
    if (formatValue !== "yaml" && formatValue !== "json") {
      write(`Unknown schema format: ${formatValue ?? "(missing)"}. Use yaml or json.`);
      return { exitCode: 2 };
    }
    const component = args[1]?.startsWith("-") ? undefined : args[1];
    if (!component && !args.includes("--all")) {
      write(SCHEMA_HELP);
      return { exitCode: 0 };
    }
    if (component && !isComponentName(component)) {
      write(`Unknown component schema: ${component}.\n\n${SCHEMA_HELP}`);
      return { exitCode: 2 };
    }
    const components = args.includes("--all")
      ? COMPONENT_NAMES
      : [component as (typeof COMPONENT_NAMES)[number]];
    write(formatComponentSchemas(components, formatValue as SchemaFormat).trimEnd());
    return { exitCode: 0 };
  }
  if (command === "init") {
    try {
      const result = await initializeWorkspace(cwd);
      reportDiagnostics([...result.validation.errors, ...result.validation.warnings], write);
      if (result.validation.errors.length > 0) return { exitCode: 1 };
      write(
        result.created
          ? "Initialized Flowmark workspace."
          : "Flowmark workspace already initialized.",
      );
      return { exitCode: 0 };
    } catch (error) {
      write(error instanceof Error ? error.message : String(error));
      return { exitCode: 1 };
    }
  }
  const requestedWorkspace = command === "__session" ? flagValue(args, "--workspace") : cwd;
  if (!requestedWorkspace) {
    write("Internal Flowmark session is missing --workspace.");
    return { exitCode: 2 };
  }
  let workspaceRoot: string;
  try {
    workspaceRoot = await canonicalizeWorkspacePath(requestedWorkspace);
  } catch {
    workspaceRoot = requestedWorkspace;
  }
  const validation = await validateWorkspace(workspaceRoot, { strict });
  const diagnostics = [...validation.errors, ...validation.warnings];
  if (validation.errors.length > 0) reportDiagnostics(diagnostics, write);
  if (validation.errors.length > 0) return { exitCode: 1 };
  if (command === "validate") {
    reportDiagnostics(diagnostics, write);
    return { exitCode: 0 };
  }
  if (command === "repair") {
    await ensureRuntimeDirectories(workspaceRoot);
    write("Rebuilt disposable runtime directories under .flowmark/.");
    return { exitCode: 0 };
  }

  if (command === "__session") {
    const id = flagValue(args, "--session-id");
    const mode = flagValue(args, "--mode");
    if (!id || (mode !== "foreground" && mode !== "daemon")) {
      write("Invalid internal Flowmark session arguments.");
      return { exitCode: 2 };
    }
    try {
      await runManagedSession({
        id,
        mode,
        workspaceRoot,
        registryPath: flagValue(args, "--registry-path"),
        logPath: flagValue(args, "--log-path"),
        readyTimeoutMs: Number(flagValue(args, "--ready-timeout-ms") ?? 30_000),
        startJobs: options.startJobs,
        startWebServer: options.startWebServer,
        output: (chunk, stream) =>
          (stream === "stdout" ? process.stdout : process.stderr).write(chunk),
      });
      return { exitCode: 0 };
    } catch (error) {
      write(error instanceof Error ? error.message : String(error));
      return { exitCode: 1 };
    }
  }

  if (options.startServer) {
    const stopJobs = await (options.startJobs ?? startWorkspaceJobs)(workspaceRoot);
    try {
      await options.startServer();
    } finally {
      stopJobs();
    }
    return { exitCode: 0 };
  }

  const probe = options.probeSession ?? probeManagedSession;
  let releaseLaunchLock: (() => Promise<void>) | undefined;
  let launchLockReleased = false;
  const releaseLock = async () => {
    if (launchLockReleased) return;
    launchLockReleased = true;
    await releaseLaunchLock?.();
  };
  try {
    releaseLaunchLock = await acquireWorkspaceLaunchLock(workspaceRoot, {
      registryPath: options.registryPath,
    });
    const currentSessions = await pruneStaleSessions({
      registryPath: options.registryPath,
      probe,
    });
    const existing = findSessionByWorkspace(currentSessions.sessions, workspaceRoot);
    if (existing) {
      await releaseLock();
      write(existing.url);
      write(`Session: ${existing.id} (already running)`);
      serveWarnings(diagnostics, write);
      return { exitCode: 0 };
    }
  } catch (error) {
    await releaseLock().catch(() => {});
    write(error instanceof Error ? error.message : String(error));
    return { exitCode: 1 };
  }

  if (args.includes("--daemon")) {
    const id = createSessionId();
    const logPath = sessionLogPath(id, options.registryPath);
    try {
      const launched = await (options.launchDaemon ?? defaultLaunchDaemon)({
        id,
        workspaceRoot,
        registryPath: options.registryPath,
        logPath,
      });
      let session = await waitForSession(id, options);
      if (!session) {
        session = (await readSessionRegistry({ registryPath: options.registryPath })).sessions.find(
          (entry) => entry.id === id,
        );
      }
      if (!session) {
        await launched?.stop?.();
        await releaseLock();
        write(`Flowmark daemon did not become ready. See ${logPath}`);
        return { exitCode: 1 };
      }
      await releaseLock();
      write(session.url);
      write(`Session: ${session.id}`);
      serveWarnings(diagnostics, write);
      return { exitCode: 0 };
    } catch (error) {
      await releaseLock().catch(() => {});
      write(error instanceof Error ? error.message : String(error));
      return { exitCode: 1 };
    }
  }

  const id = createSessionId();
  const bufferedOutput: Array<{ chunk: string; stream: "stdout" | "stderr" }> = [];
  let ready = false;
  try {
    await runManagedSession({
      id,
      mode: "foreground",
      workspaceRoot,
      registryPath: options.registryPath,
      startJobs: options.startJobs,
      startWebServer: options.startWebServer,
      output: (chunk, stream) => {
        if (!ready) {
          bufferedOutput.push({ chunk, stream });
          return;
        }
        (stream === "stdout" ? process.stdout : process.stderr).write(chunk);
      },
      onReady: async (session) => {
        await releaseLock();
        write(session.url);
        write(`Session: ${session.id}`);
        serveWarnings(diagnostics, write);
        ready = true;
        for (const entry of bufferedOutput) {
          (entry.stream === "stdout" ? process.stdout : process.stderr).write(entry.chunk);
        }
        bufferedOutput.length = 0;
      },
    });
  } catch (error) {
    write(error instanceof Error ? error.message : String(error));
    return { exitCode: 1 };
  } finally {
    await releaseLock().catch(() => {});
  }
  return { exitCode: 0 };
}

if (import.meta.main) {
  void runCli(process.argv.slice(2))
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
