import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const DEFAULT_REPOSITORY = "carlosray/flowmark";

export function releaseAssetName(platform: NodeJS.Platform, architecture: string): string {
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(`Unsupported operating system: ${platform}.`);
  }
  if (architecture !== "arm64" && architecture !== "x64") {
    throw new Error(`Unsupported architecture: ${architecture}.`);
  }
  if (platform === "linux" && architecture === "arm64") {
    throw new Error("Linux ARM64 release binaries are not available yet.");
  }
  return `flowmark-${platform}-${architecture}.tar.gz`;
}

export function checksumForAsset(manifest: string, asset: string): string {
  for (const line of manifest.split(/\r?\n/)) {
    const match = line.match(/^([a-fA-F0-9]{64})[\t ]+\*?(.+)$/);
    if (match?.[2] === asset) return match[1].toLowerCase();
  }
  throw new Error(`SHA256SUMS does not contain an entry for ${asset}.`);
}

export interface UpdateFlowmarkOptions {
  executablePath: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  repository?: string;
  download?: (url: string, destination: string) => Promise<void>;
}

export async function downloadReleaseFile(
  url: string,
  destination: string,
  options: { fetch?: typeof fetch; connectTimeoutMs?: number; stallTimeoutMs?: number } = {},
) {
  const connectionController = new AbortController();
  const connectionTimeout = setTimeout(
    () => connectionController.abort(new Error("connection timed out")),
    options.connectTimeoutMs ?? 30_000,
  );
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      headers: { "user-agent": "flowmark-updater" },
      redirect: "follow",
      signal: connectionController.signal,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not download ${url}: ${detail}. Check your network connection and try again.`,
      { cause: error },
    );
  } finally {
    clearTimeout(connectionTimeout);
  }
  if (!response.ok) {
    throw new Error(`Could not download ${url}: HTTP ${response.status}.`);
  }
  if (!response.body) throw new Error(`Could not download ${url}: response body is empty.`);

  const reader = response.body.getReader();
  let output: Awaited<ReturnType<typeof open>> | undefined;
  let destinationCreated = false;
  try {
    output = await open(destination, "wx", 0o600);
    destinationCreated = true;
    while (true) {
      let stallTimeout: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          stallTimeout = setTimeout(
            () => reject(new Error("download stalled")),
            options.stallTimeoutMs ?? 60_000,
          );
        }),
      ]).finally(() => clearTimeout(stallTimeout));
      if (chunk.done) break;

      let offset = 0;
      while (offset < chunk.value.byteLength) {
        const { bytesWritten } = await output.write(
          chunk.value,
          offset,
          chunk.value.byteLength - offset,
        );
        offset += bytesWritten;
      }
    }
    await output.sync();
  } catch (error) {
    await reader.cancel().catch(() => {});
    await output?.close().catch(() => {});
    output = undefined;
    if (destinationCreated) await rm(destination, { force: true });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not download ${url}: ${detail}. Check your network connection and try again.`,
      { cause: error },
    );
  } finally {
    await output?.close();
    reader.releaseLock();
  }
}

async function sha256(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function extractExecutable(archivePath: string, destination: string) {
  await mkdir(destination);
  const child = spawn("tar", ["-xzf", archivePath, "-C", destination, "flowmark"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(
      `Could not extract ${basename(archivePath)}${stderr.trim() ? `: ${stderr.trim()}` : "."}`,
    );
  }

  const extracted = join(destination, "flowmark");
  const details = await lstat(extracted).catch(() => undefined);
  if (!details?.isFile()) {
    throw new Error("The release archive does not contain a Flowmark executable.");
  }
  return extracted;
}

async function validateExecutable(executablePath: string) {
  await chmod(executablePath, 0o755);
  const child = spawn(executablePath, ["--help"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  let timedOut = false;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < 8192) stderr += chunk;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 10_000);
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  })
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not run the downloaded Flowmark executable: ${detail}.`, {
        cause: error,
      });
    })
    .finally(() => clearTimeout(timeout));
  if (timedOut) throw new Error("The downloaded Flowmark executable did not respond to --help.");
  if (exitCode !== 0) {
    throw new Error(
      `The downloaded Flowmark executable failed its --help check${stderr.trim() ? `: ${stderr.trim()}` : "."}`,
    );
  }
}

async function syncDirectory(directoryPath: string) {
  const directory = await open(directoryPath, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function installExecutable(sourcePath: string, executablePath: string) {
  const directory = dirname(executablePath);
  const temporaryPath = join(
    directory,
    `.${basename(executablePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    try {
      await copyFile(sourcePath, temporaryPath, constants.COPYFILE_EXCL);
      await chmod(temporaryPath, 0o755);
      const prepared = await open(temporaryPath, "r");
      try {
        await prepared.sync();
      } finally {
        await prepared.close();
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not replace the Flowmark executable at ${executablePath}: ${detail}. Check that the install directory is writable.`,
        { cause: error },
      );
    }

    await validateExecutable(temporaryPath);
    try {
      await rename(temporaryPath, executablePath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not replace the Flowmark executable at ${executablePath}: ${detail}. Check that the install directory is writable.`,
        { cause: error },
      );
    }

    try {
      await syncDirectory(directory);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return `Flowmark was replaced, but the install directory could not be synchronized: ${detail}`;
    }
    return undefined;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function updateFlowmark(options: UpdateFlowmarkOptions) {
  const asset = releaseAssetName(
    options.platform ?? process.platform,
    options.architecture ?? process.arch,
  );
  const repository = options.repository ?? DEFAULT_REPOSITORY;
  const download = options.download ?? downloadReleaseFile;
  const releaseBase = `https://github.com/${repository}/releases/latest/download`;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "flowmark-update-"));
  const archivePath = join(temporaryDirectory, asset);
  const checksumsPath = join(temporaryDirectory, "SHA256SUMS");
  const extractedDirectory = join(temporaryDirectory, "extracted");

  try {
    await download(`${releaseBase}/${asset}`, archivePath);
    await download(`${releaseBase}/SHA256SUMS`, checksumsPath);
    const expected = checksumForAsset(await readFile(checksumsPath, "utf8"), asset);
    const actual = await sha256(archivePath);
    if (actual !== expected) throw new Error(`Checksum verification failed for ${asset}.`);

    const extractedPath = await extractExecutable(archivePath, extractedDirectory);
    const warning = await installExecutable(extractedPath, options.executablePath);
    return {
      asset,
      executablePath: options.executablePath,
      ...(warning ? { warning } : {}),
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
