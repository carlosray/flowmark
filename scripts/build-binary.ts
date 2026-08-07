#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_TARGETS = ["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-x64"] as const;

export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];

export interface PublicAsset {
  urlPath: string;
  sourcePath: string;
  mimeType: string;
}

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export function releaseArtifactName(target?: string) {
  if (!target) return "flowmark";
  if (!(RELEASE_TARGETS as readonly string[]).includes(target)) {
    throw new Error(`Unsupported release target: ${target}`);
  }
  return `flowmark-${target.slice("bun-".length)}`;
}

export function mimeTypeFor(path: string) {
  switch (extname(path).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(root, path) : [path];
    }),
  );
  return nested.flat();
}

export async function discoverPublicAssets(publicRoot: string): Promise<PublicAsset[]> {
  const files = await listFiles(publicRoot);
  return files
    .map((sourcePath) => {
      const publicPath = relative(publicRoot, sourcePath).split(sep).join("/");
      return {
        urlPath: `/${publicPath}`,
        sourcePath,
        mimeType: mimeTypeFor(publicPath),
      };
    })
    .sort((left, right) => left.urlPath.localeCompare(right.urlPath));
}

export function generateReleaseEntry(assets: PublicAsset[]) {
  const imports = assets
    .map((_, index) => `import asset${index} from "./assets/flowmark-asset-${index}.asset";`)
    .join("\n");
  const rows = assets
    .map(
      (asset, index) =>
        `  [${JSON.stringify(asset.urlPath)}, { file: asset${index}, type: ${JSON.stringify(asset.mimeType)} }],`,
    )
    .join("\n");

  return `import { spawn } from "node:child_process";
import { mkdir, open, realpath } from "node:fs/promises";
import { dirname } from "node:path";

import nitroHandler from "../.output/server/index.mjs";
import { runCli } from "../src/cli.ts";
import type { DaemonLaunchOptions } from "../src/cli.ts";
import { isAllowedLoopbackRequest } from "../src/lib/local-web-server.ts";
import { installMacosCardLinkHandler, openCardInSafari } from "../src/lib/macos-card-link-handler.ts";
import { updateFlowmark } from "../src/lib/self-update.ts";
${imports}

const embeddedAssets = new Map<string, { file: string; type: string }>([
${rows}
]);

function startEmbeddedServer(workspaceRoot: string, port: number) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request) {
      if (!isAllowedLoopbackRequest(request, server.port)) {
        return new Response("Misdirected request", { status: 421 });
      }
      process.env.FLOWMARK_WORKSPACE_ROOT = workspaceRoot;
      return nitroHandler.fetch(
        request,
        {
          ASSETS: {
            async fetch(assetRequest: Request) {
              const asset = embeddedAssets.get(new URL(assetRequest.url).pathname);
              if (!asset) return new Response("Not found", { status: 404 });
              return new Response(Bun.file(asset.file), {
                headers: { "content-type": asset.type },
              });
            },
          },
        },
        { waitUntil(promise: Promise<unknown>) { void promise; } },
      );
    },
  });
  return {
    url: \`http://127.0.0.1:\${server.port}/\`,
    async close() {
      await server.stop(true);
    },
  };
}

async function startWebServer(workspaceRoot: string) {
  process.env.FLOWMARK_WORKSPACE_ROOT = workspaceRoot;
  const preferredPort = 3000;
  try {
    return startEmbeddedServer(workspaceRoot, preferredPort);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    return startEmbeddedServer(workspaceRoot, 0);
  }
}

async function launchDaemon(options: DaemonLaunchOptions) {
  await mkdir(dirname(options.logPath), { recursive: true });
  const log = await open(options.logPath, "a", 0o600);
  const args = [
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

const result = await runCli(process.argv.slice(2), {
  startWebServer,
  launchDaemon,
  runUpdate: async () =>
    updateFlowmark({ executablePath: await realpath(process.execPath) }),
  installCardLinkHandler: async () =>
    installMacosCardLinkHandler({ executablePath: await realpath(process.execPath) }),
  openCardInSafari,
});
process.exitCode = result.exitCode;
`;
}

function flagValue(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function run(command: string, args: string[]) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env },
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited with code ${code}.`);
}

export async function buildBinary(args = process.argv.slice(2)) {
  const target = flagValue(args, "--target");
  if (target && !(RELEASE_TARGETS as readonly string[]).includes(target)) {
    throw new Error(`Unsupported release target: ${target}`);
  }

  if (!args.includes("--skip-web-build")) {
    await run(process.execPath, ["run", "build"]);
  }

  const publicRoot = join(projectRoot, ".output", "public");
  const assets = await discoverPublicAssets(publicRoot);
  if (assets.length === 0) throw new Error("Production build contains no public assets.");

  const buildRoot = join(projectRoot, ".flowmark-build");
  const assetRoot = join(buildRoot, "assets");
  await rm(buildRoot, { recursive: true, force: true });
  await mkdir(assetRoot, { recursive: true });
  await Promise.all(
    assets.map((asset, index) =>
      cp(asset.sourcePath, join(assetRoot, `flowmark-asset-${index}.asset`)),
    ),
  );

  const entryPath = join(buildRoot, "release-entry.ts");
  await writeFile(entryPath, generateReleaseEntry(assets), "utf8");

  const output =
    flagValue(args, "--outfile") ?? join(projectRoot, "dist", releaseArtifactName(target));
  await mkdir(resolve(output, ".."), { recursive: true });
  await run(process.execPath, [
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    ...(target ? [`--target=${target}`] : []),
    `--outfile=${output}`,
    entryPath,
  ]);
  return output;
}

if (import.meta.main) {
  await buildBinary().then(
    (output) => console.log(output),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
