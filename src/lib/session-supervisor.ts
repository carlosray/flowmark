import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import type { LocalWebServer, StartLocalWebServer } from "./local-web-server.ts";
import { startWorkspaceJobs } from "./workspace/rule-runner.ts";
import {
  registerSession,
  unregisterSession,
  type FlowmarkSession,
  type SessionMode,
} from "./session-registry.ts";

export const LOCAL_DEV_SERVER_ARGS = ["run", "dev", "--", "--host", "127.0.0.1"];
export const MANAGED_SESSION_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;

export interface ManagedServerProcess {
  pid?: number;
  stdout: Readable | null;
  stderr: Readable | null;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

interface SessionControlOptions {
  token: string;
  onStop: () => void;
}

export interface SessionControl {
  url: string;
  close: () => Promise<void>;
}

export interface ManagedSessionOptions {
  id: string;
  mode: SessionMode;
  workspaceRoot: string;
  registryPath?: string;
  logPath?: string;
  appRoot?: string;
  readyTimeoutMs?: number;
  installSignalHandlers?: boolean;
  startJobs?: (workspaceRoot: string) => Promise<() => void>;
  startWebServer?: StartLocalWebServer;
  spawnServer?: (workspaceRoot: string, appRoot: string) => ManagedServerProcess;
  terminateServer?: (server: ManagedServerProcess, force: boolean) => void;
  output?: (chunk: string, stream: "stdout" | "stderr") => void;
  onReady?: (session: FlowmarkSession) => void | Promise<void>;
  now?: () => Date;
}

type ControlRequestResult = {
  statusCode: number;
  body: string;
};

export function parseViteLoopbackUrl(output: string) {
  const withoutAnsi = output.replace(new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, "g"), "");
  const match = withoutAnsi.match(
    /(?:Local:\s*)?https?:\/\/(127\.0\.0\.1|localhost):(\d+)(?:\/|\b)/i,
  );
  if (!match) return null;
  return `http://127.0.0.1:${match[2]}/`;
}

export async function startSessionControlServer(
  options: SessionControlOptions,
): Promise<SessionControl> {
  const server = createServer((incoming, response) => {
    const authorized = incoming.headers.authorization === `Bearer ${options.token}`;
    if (!authorized) {
      response.writeHead(401).end("Unauthorized");
      return;
    }
    if (incoming.method === "GET" && incoming.url === "/health") {
      response.writeHead(204).end();
      return;
    }
    if (incoming.method === "POST" && incoming.url === "/stop") {
      response.writeHead(202).end("Stopping");
      queueMicrotask(options.onStop);
      return;
    }
    response.writeHead(404).end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function controlRequest(
  session: FlowmarkSession,
  method: "GET" | "POST",
  path: string,
  timeoutMs = 1_000,
) {
  return new Promise<ControlRequestResult>((resolve, reject) => {
    const url = new URL(path, session.control_url);
    const outgoing = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: { Authorization: `Bearer ${session.control_token}` },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body }));
      },
    );
    outgoing.setTimeout(timeoutMs, () => outgoing.destroy(new Error("Session request timed out.")));
    outgoing.once("error", reject);
    outgoing.end();
  });
}

export async function probeSession(session: FlowmarkSession) {
  try {
    return (await controlRequest(session, "GET", "/health")).statusCode === 204;
  } catch {
    return false;
  }
}

export async function requestSessionStop(session: FlowmarkSession) {
  const response = await controlRequest(session, "POST", "/stop");
  if (response.statusCode !== 202) {
    throw new Error(
      `Flowmark session ${session.id} refused the stop request (${response.statusCode}).`,
    );
  }
}

function defaultSpawnServer(workspaceRoot: string, appRoot: string) {
  return spawn(process.execPath, LOCAL_DEV_SERVER_ARGS, {
    cwd: appRoot,
    env: { ...process.env, FLOWMARK_WORKSPACE_ROOT: workspaceRoot },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
}

function defaultTerminateServer(server: ManagedServerProcess, force: boolean) {
  const signal = force ? "SIGKILL" : "SIGTERM";
  if (process.platform !== "win32" && server.pid) {
    try {
      process.kill(-server.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    return;
  }
  server.kill(signal);
}

function waitForExit(server: ManagedServerProcess) {
  return new Promise<
    | { type: "exit"; code: number | null; signal: NodeJS.Signals | null }
    | { type: "error"; error: Error }
  >((resolve) => {
    server.once("exit", (code, signal) => resolve({ type: "exit", code, signal }));
    server.once("error", (error) => resolve({ type: "error", error }));
  });
}

function waitForReadiness(
  server: ManagedServerProcess,
  timeoutMs: number,
  output?: ManagedSessionOptions["output"],
) {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let bufferedOutput = "";

    const inspect = (chunk: Buffer | string, stream: "stdout" | "stderr") => {
      const text = String(chunk);
      output?.(text, stream);
      bufferedOutput = `${bufferedOutput}${text}`.slice(-8_192);
      const url = parseViteLoopbackUrl(bufferedOutput);
      if (url && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(url);
      }
    };

    server.stdout?.on("data", (chunk) => inspect(chunk, "stdout"));
    server.stderr?.on("data", (chunk) => inspect(chunk, "stderr"));
    server.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    server.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `Flowmark UI server exited with code ${code ?? "unknown"} before becoming ready.`,
        ),
      );
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Flowmark UI server did not become ready within ${timeoutMs}ms.`));
    }, timeoutMs);
  });
}

function createStopSignal() {
  let resolveStop!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  return { promise, request: resolveStop };
}

async function stopServer(
  server: ManagedServerProcess,
  exit: ReturnType<typeof waitForExit>,
  terminate: NonNullable<ManagedSessionOptions["terminateServer"]>,
) {
  terminate(server, false);
  const graceful = await Promise.race([
    exit.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (graceful) return;
  terminate(server, true);
  await exit;
}

export async function runManagedSession(options: ManagedSessionOptions) {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const stop = createStopSignal();
  const token = randomUUID();
  const control = await startSessionControlServer({ token, onStop: stop.request });
  const signalHandler = () => stop.request();
  let stopJobs: (() => void) | undefined;
  let server: ManagedServerProcess | undefined;
  let serverExit: ReturnType<typeof waitForExit> | undefined;
  let serverExited = false;
  let webServer: LocalWebServer | undefined;
  let webServerClosed = false;
  let registered = false;

  const closeWebServer = async () => {
    if (!webServer || webServerClosed) return;
    webServerClosed = true;
    await webServer.close();
  };

  if (options.installSignalHandlers !== false) {
    for (const signal of MANAGED_SESSION_SIGNALS) process.on(signal, signalHandler);
  }

  try {
    stopJobs = await (options.startJobs ?? startWorkspaceJobs)(options.workspaceRoot);
    let url: string;
    if (options.startWebServer) {
      webServer = await options.startWebServer(options.workspaceRoot);
      const parsedUrl = new URL(webServer.url);
      if (parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "localhost") {
        throw new Error("Flowmark production server must bind to loopback.");
      }
      parsedUrl.hostname = "127.0.0.1";
      url = parsedUrl.toString();
    } else {
      const appRoot = options.appRoot ?? fileURLToPath(new URL("../..", import.meta.url));
      server = (options.spawnServer ?? defaultSpawnServer)(options.workspaceRoot, appRoot);
      const exit = waitForExit(server);
      serverExit = exit;
      void exit.then(() => {
        serverExited = true;
      });
      url = await waitForReadiness(server, options.readyTimeoutMs ?? 30_000, options.output);
    }
    const readyAt = now().toISOString();
    const session: FlowmarkSession = {
      id: options.id,
      mode: options.mode,
      pid: process.pid,
      workspace_path: options.workspaceRoot,
      url,
      started_at: startedAt,
      ready_at: readyAt,
      updated_at: readyAt,
      control_url: control.url,
      control_token: token,
      ...(options.logPath ? { log_path: options.logPath } : {}),
    };
    await registerSession(session, { registryPath: options.registryPath });
    registered = true;
    await options.onReady?.(session);

    const outcome = serverExit
      ? await Promise.race([serverExit, stop.promise.then(() => ({ type: "stop" as const }))])
      : await stop.promise.then(() => ({ type: "stop" as const }));
    if (outcome.type === "stop") {
      if (server && serverExit) {
        await stopServer(server, serverExit, options.terminateServer ?? defaultTerminateServer);
      } else {
        await closeWebServer();
      }
    } else if (outcome.type === "error") {
      throw outcome.error;
    } else if (outcome.code !== 0 && outcome.signal === null) {
      throw new Error(`Flowmark UI server exited with code ${outcome.code ?? "unknown"}.`);
    }
  } finally {
    if (server && serverExit && !serverExited) {
      await stopServer(server, serverExit, options.terminateServer ?? defaultTerminateServer).catch(
        () => {},
      );
    }
    await closeWebServer().catch(() => {});
    if (registered) {
      await unregisterSession(options.id, { registryPath: options.registryPath }).catch(() => {});
    }
    stopJobs?.();
    await control.close().catch(() => {});
    if (options.installSignalHandlers !== false) {
      for (const signal of MANAGED_SESSION_SIGNALS) process.off(signal, signalHandler);
    }
  }
}
