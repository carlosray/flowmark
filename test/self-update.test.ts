import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import {
  checksumForAsset,
  downloadReleaseFile,
  releaseAssetName,
  updateFlowmark,
} from "../src/lib/self-update.ts";

test("release assets match every supported binary target", async () => {
  assert.equal(releaseAssetName("darwin", "arm64"), "flowmark-darwin-arm64.tar.gz");
  assert.equal(releaseAssetName("darwin", "x64"), "flowmark-darwin-x64.tar.gz");
  assert.equal(releaseAssetName("linux", "x64"), "flowmark-linux-x64.tar.gz");
  assert.throws(() => releaseAssetName("linux", "arm64"), /not available/i);
  assert.throws(() => releaseAssetName("win32", "x64"), /unsupported operating system/i);
  assert.throws(() => releaseAssetName("darwin", "riscv64"), /unsupported architecture/i);
});

test("checksum parsing requires an exact release asset entry", async () => {
  const asset = "flowmark-darwin-arm64.tar.gz";
  const checksum = "a".repeat(64);

  assert.equal(checksumForAsset(`${checksum}  ${asset}\n`, asset), checksum);
  assert.equal(checksumForAsset(`${checksum.toUpperCase()}  *${asset}\n`, asset), checksum);
  assert.throws(
    () => checksumForAsset(`${checksum}  another-${asset}\n`, asset),
    /does not contain/i,
  );
  assert.throws(() => checksumForAsset(`not-a-checksum  ${asset}\n`, asset), /does not contain/i);
});

test("network failures include the requested URL and an actionable retry hint", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-download-test-"));
  try {
    await assert.rejects(
      () =>
        downloadReleaseFile("https://example.invalid/flowmark.tar.gz", join(root, "asset"), {
          fetch: async () => {
            throw new Error("offline");
          },
        }),
      /example\.invalid.*offline.*network connection.*try again/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("streaming download failures keep their URL and actionable retry hint", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-download-stream-test-"));
  try {
    await assert.rejects(
      () =>
        downloadReleaseFile("https://example.invalid/flowmark.tar.gz", join(root, "asset"), {
          fetch: async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error("stream broke"));
                },
              }),
            ),
        }),
      /example\.invalid.*stream broke.*network connection.*try again/i,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stalled response is aborted without imposing a total download deadline", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-download-stall-test-"));
  try {
    await assert.rejects(
      () =>
        downloadReleaseFile("https://example.invalid/flowmark.tar.gz", join(root, "asset"), {
          fetch: async () => new Response(new ReadableStream({ pull() {} })),
          stallTimeoutMs: 5,
        }),
      /example\.invalid.*download stalled.*network connection.*try again/i,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function updateFixture(
  options: {
    malformed?: boolean;
    missingExecutable?: boolean;
    symlinkExecutable?: boolean;
    unusableExecutable?: boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "flowmark-update-test-"));
  const release = join(root, "release");
  const packageDirectory = join(root, "package");
  const installDirectory = join(root, "install");
  const executablePath = join(installDirectory, "flowmark");
  const asset = "flowmark-darwin-arm64.tar.gz";
  const archivePath = join(release, asset);
  await Promise.all([mkdir(release), mkdir(packageDirectory), mkdir(installDirectory)]);
  await writeFile(executablePath, "old executable\n");
  await chmod(executablePath, 0o755);

  if (options.malformed) {
    await writeFile(archivePath, "not a tar archive\n");
  } else {
    const packagedName = options.missingExecutable ? "not-flowmark" : "flowmark";
    if (options.symlinkExecutable) {
      const outsideArchive = join(root, "outside-archive");
      await writeFile(outsideArchive, "untrusted executable\n");
      await symlink(outsideArchive, join(packageDirectory, packagedName));
    } else {
      await writeFile(
        join(packageDirectory, packagedName),
        options.unusableExecutable
          ? "#!/bin/sh\nexit 7\n"
          : "#!/bin/sh\nprintf 'Flowmark help\\n'\n",
      );
      await chmod(join(packageDirectory, packagedName), 0o755);
    }
    const tar = spawnSync("tar", ["-C", packageDirectory, "-czf", archivePath, packagedName], {
      encoding: "utf8",
    });
    assert.equal(tar.status, 0, tar.stderr);
  }

  const checksum = createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
  await writeFile(join(release, "SHA256SUMS"), `${checksum}  ${asset}\n`);
  const urls: string[] = [];

  return {
    root,
    release,
    installDirectory,
    executablePath,
    asset,
    urls,
    download: async (url: string, destination: string) => {
      urls.push(url);
      await copyFile(join(release, basename(url)), destination);
    },
  };
}

test("a verified release atomically replaces the installed executable", async () => {
  const fixture = await updateFixture();
  try {
    const result = await updateFlowmark({
      executablePath: fixture.executablePath,
      platform: "darwin",
      architecture: "arm64",
      download: fixture.download,
    });

    assert.deepEqual(result, {
      asset: fixture.asset,
      executablePath: fixture.executablePath,
    });
    assert.equal(
      await readFile(fixture.executablePath, "utf8"),
      "#!/bin/sh\nprintf 'Flowmark help\\n'\n",
    );
    assert.notEqual((await stat(fixture.executablePath)).mode & 0o111, 0);
    assert.deepEqual(await readdir(join(fixture.root, "install")), ["flowmark"]);
    assert.deepEqual(fixture.urls, [
      `https://github.com/carlosray/flowmark/releases/latest/download/${fixture.asset}`,
      "https://github.com/carlosray/flowmark/releases/latest/download/SHA256SUMS",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("checksum mismatch leaves the installed executable untouched", async () => {
  const fixture = await updateFixture();
  try {
    await writeFile(join(fixture.release, "SHA256SUMS"), `${"0".repeat(64)}  ${fixture.asset}\n`);
    await assert.rejects(
      () =>
        updateFlowmark({
          executablePath: fixture.executablePath,
          platform: "darwin",
          architecture: "arm64",
          download: fixture.download,
        }),
      /checksum verification failed/i,
    );
    assert.equal(await readFile(fixture.executablePath, "utf8"), "old executable\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("an unwritable install directory preserves the binary and reports how to fix it", async () => {
  const fixture = await updateFixture();
  try {
    await chmod(fixture.installDirectory, 0o555);
    await assert.rejects(
      () =>
        updateFlowmark({
          executablePath: fixture.executablePath,
          platform: "darwin",
          architecture: "arm64",
          download: fixture.download,
        }),
      /could not replace.*install directory is writable/i,
    );
    assert.equal(await readFile(fixture.executablePath, "utf8"), "old executable\n");
    assert.deepEqual(await readdir(fixture.installDirectory), ["flowmark"]);
  } finally {
    await chmod(fixture.installDirectory, 0o755);
    await rm(fixture.root, { recursive: true, force: true });
  }
});

for (const [name, options] of [
  ["malformed release archive", { malformed: true }],
  ["release archive without a Flowmark executable", { missingExecutable: true }],
  ["release archive with a symlinked executable", { symlinkExecutable: true }],
  ["release archive with an unusable executable", { unusableExecutable: true }],
] as const) {
  test(`${name} leaves the installed executable untouched`, async () => {
    const fixture = await updateFixture(options);
    try {
      await assert.rejects(
        () =>
          updateFlowmark({
            executablePath: fixture.executablePath,
            platform: "darwin",
            architecture: "arm64",
            download: fixture.download,
          }),
        /extract|executable/i,
      );
      assert.equal(await readFile(fixture.executablePath, "utf8"), "old executable\n");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}
