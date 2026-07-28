import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const SESSION_REGISTRY_SCHEMA_VERSION = 1 as const;

export type SessionMode = "foreground" | "daemon";

export interface FlowmarkSession {
  id: string;
  mode: SessionMode;
  pid: number;
  workspace_path: string;
  url: string;
  started_at: string;
  ready_at: string;
  updated_at: string;
  control_url: string;
  control_token: string;
  log_path?: string;
}

export interface SessionRegistry {
  schema_version: typeof SESSION_REGISTRY_SCHEMA_VERSION;
  sessions: FlowmarkSession[];
}

export interface SessionRegistryOptions {
  registryPath?: string;
}

export interface PruneSessionOptions extends SessionRegistryOptions {
  probe: (session: FlowmarkSession) => Promise<boolean>;
  probeRetries?: number;
  probeRetryDelayMs?: number;
}

const EMPTY_REGISTRY = (): SessionRegistry => ({
  schema_version: SESSION_REGISTRY_SCHEMA_VERSION,
  sessions: [],
});

export function getSessionRegistryPath(homeDirectory = homedir()) {
  return join(homeDirectory, ".flowmark", "sessions.json");
}

export function createSessionId() {
  return `session_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export async function canonicalizeWorkspacePath(workspacePath: string) {
  return realpath(workspacePath);
}

function isSession(value: unknown): value is FlowmarkSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FlowmarkSession>;
  return (
    typeof candidate.id === "string" &&
    (candidate.mode === "foreground" || candidate.mode === "daemon") &&
    typeof candidate.pid === "number" &&
    typeof candidate.workspace_path === "string" &&
    typeof candidate.url === "string" &&
    typeof candidate.started_at === "string" &&
    typeof candidate.ready_at === "string" &&
    typeof candidate.updated_at === "string" &&
    typeof candidate.control_url === "string" &&
    typeof candidate.control_token === "string" &&
    (candidate.log_path === undefined || typeof candidate.log_path === "string")
  );
}

class InvalidRegistryError extends Error {}

function parseRegistry(source: string, registryPath: string): SessionRegistry {
  try {
    const value = JSON.parse(source) as Partial<SessionRegistry>;
    if (
      value.schema_version !== SESSION_REGISTRY_SCHEMA_VERSION ||
      !Array.isArray(value.sessions) ||
      !value.sessions.every(isSession)
    ) {
      throw new Error("unsupported or invalid registry fields");
    }
    return {
      schema_version: SESSION_REGISTRY_SCHEMA_VERSION,
      sessions: value.sessions,
    };
  } catch (error) {
    throw new InvalidRegistryError(
      `Invalid Flowmark session registry at ${registryPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function readRegistryFile(registryPath: string) {
  let source: string;
  try {
    source = await readFile(registryPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_REGISTRY();
    throw error;
  }
  try {
    return parseRegistry(source, registryPath);
  } catch (error) {
    if (!(error instanceof InvalidRegistryError)) throw error;
    const backupPath = `${registryPath}.corrupt-${Date.now()}-${randomUUID().slice(0, 8)}`;
    try {
      await rename(registryPath, backupPath);
    } catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") throw renameError;
    }
    return EMPTY_REGISTRY();
  }
}

export async function readSessionRegistry(options: SessionRegistryOptions = {}) {
  return readRegistryFile(options.registryPath ?? getSessionRegistryPath());
}

async function acquireRegistryLock(registryPath: string, timeoutMs = 5_000) {
  const lockPath = `${registryPath}.lock`;
  const deadline = Date.now() + timeoutMs;
  await mkdir(dirname(registryPath), { recursive: true });

  while (true) {
    try {
      await mkdir(lockPath);
      return async () => rm(lockPath, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > 30_000) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for Flowmark session registry lock: ${lockPath}`);
      }
      await delay(15);
    }
  }
}

export async function acquireWorkspaceLaunchLock(
  canonicalWorkspacePath: string,
  options: SessionRegistryOptions = {},
) {
  const registryPath = options.registryPath ?? getSessionRegistryPath();
  const workspaceHash = createHash("sha256")
    .update(canonicalWorkspacePath)
    .digest("hex")
    .slice(0, 24);
  const lockTarget = join(dirname(registryPath), "locks", `workspace-${workspaceHash}`);
  return acquireRegistryLock(lockTarget, 70_000);
}

async function writeRegistryFile(registryPath: string, registry: SessionRegistry) {
  await mkdir(dirname(registryPath), { recursive: true });
  const temporaryPath = `${registryPath}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporaryPath, registryPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function mutateSessionRegistry(
  mutate: (registry: SessionRegistry) => SessionRegistry | void,
  options: SessionRegistryOptions,
) {
  const registryPath = options.registryPath ?? getSessionRegistryPath();
  const release = await acquireRegistryLock(registryPath);
  try {
    const registry = await readRegistryFile(registryPath);
    const updated = mutate(registry) ?? registry;
    await writeRegistryFile(registryPath, updated);
    return updated;
  } finally {
    await release();
  }
}

export async function registerSession(
  session: FlowmarkSession,
  options: SessionRegistryOptions = {},
) {
  return mutateSessionRegistry((registry) => {
    const sessions = registry.sessions.filter((entry) => entry.id !== session.id);
    sessions.push(session);
    return { ...registry, sessions };
  }, options);
}

export async function updateSession(
  id: string,
  patch: Partial<Omit<FlowmarkSession, "id">>,
  options: SessionRegistryOptions = {},
) {
  let found = false;
  await mutateSessionRegistry(
    (registry) => ({
      ...registry,
      sessions: registry.sessions.map((entry) => {
        if (entry.id !== id) return entry;
        found = true;
        return { ...entry, ...patch };
      }),
    }),
    options,
  );
  return found;
}

export async function unregisterSession(id: string, options: SessionRegistryOptions = {}) {
  let removed = false;
  await mutateSessionRegistry(
    (registry) => ({
      ...registry,
      sessions: registry.sessions.filter((entry) => {
        if (entry.id !== id) return true;
        removed = true;
        return false;
      }),
    }),
    options,
  );
  return removed;
}

export function findSessionByWorkspace(
  sessions: FlowmarkSession[],
  canonicalWorkspacePath: string,
) {
  return sessions.find((session) => session.workspace_path === canonicalWorkspacePath);
}

export async function pruneStaleSessions(options: PruneSessionOptions) {
  const registry = await readSessionRegistry(options);
  const attempts = Math.max(1, options.probeRetries ?? 2);
  const health = await Promise.all(
    registry.sessions.map(async (session) => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (await options.probe(session).catch(() => false)) return { session, live: true };
        if (attempt + 1 < attempts) await delay(options.probeRetryDelayMs ?? 50);
      }
      return { session, live: false };
    }),
  );
  const stale = health.filter(({ live }) => !live).map(({ session }) => session);
  const staleIds = new Set(stale.map((session) => session.id));

  if (staleIds.size > 0) {
    await mutateSessionRegistry(
      (current) => ({
        ...current,
        sessions: current.sessions.filter((session) => !staleIds.has(session.id)),
      }),
      options,
    );
  }

  const current = await readSessionRegistry(options);
  return { sessions: current.sessions, stale };
}
