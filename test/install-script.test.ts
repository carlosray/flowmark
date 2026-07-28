import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const installer = join(root, "install.sh");

async function fixture(options: { checksum?: string } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "flowmark-install-test-"));
  const fakeBin = join(directory, "bin");
  const release = join(directory, "release");
  const packageDirectory = join(directory, "package");
  const installDirectory = join(directory, "installed");
  const curlLog = join(directory, "curl.log");
  await Promise.all([
    mkdir(fakeBin),
    mkdir(release),
    mkdir(packageDirectory),
    mkdir(installDirectory),
  ]);

  await writeFile(join(packageDirectory, "flowmark"), "#!/bin/sh\necho flowmark-test\n");
  await chmod(join(packageDirectory, "flowmark"), 0o755);
  const archiveName = "flowmark-darwin-arm64.tar.gz";
  const archivePath = join(release, archiveName);
  const tar = spawnSync("tar", ["-C", packageDirectory, "-czf", archivePath, "flowmark"], {
    encoding: "utf8",
  });
  assert.equal(tar.status, 0, tar.stderr);

  const checksum =
    options.checksum ??
    createHash("sha256")
      .update(await readFile(archivePath))
      .digest("hex");
  await writeFile(join(release, "SHA256SUMS"), `${checksum}  ${archiveName}\n`);

  await writeFile(
    join(fakeBin, "uname"),
    `#!/bin/sh
case "$1" in
  -s) printf '%s\\n' "\${FAKE_UNAME_SYSTEM:-Darwin}" ;;
  -m) printf '%s\\n' "\${FAKE_UNAME_MACHINE:-arm64}" ;;
  *) exit 2 ;;
esac
`,
  );
  await writeFile(
    join(fakeBin, "curl"),
    `#!/bin/sh
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
printf '%s\\n' "$url" >> "$FAKE_CURL_LOG"
cp "$FAKE_RELEASE_DIR/\${url##*/}" "$output"
`,
  );
  await Promise.all([chmod(join(fakeBin, "uname"), 0o755), chmod(join(fakeBin, "curl"), 0o755)]);

  return {
    directory,
    release,
    installDirectory,
    curlLog,
    env: {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`,
      HOME: directory,
      FLOWMARK_INSTALL_DIR: installDirectory,
      FAKE_CURL_LOG: curlLog,
      FAKE_RELEASE_DIR: release,
    },
  };
}

test("installer selects the latest Darwin ARM64 archive, verifies it, and installs executable", async () => {
  const testFixture = await fixture();
  try {
    const result = spawnSync("sh", [installer], {
      env: testFixture.env,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      await readFile(testFixture.curlLog, "utf8"),
      /\/releases\/latest\/download\/flowmark-darwin-arm64\.tar\.gz/,
    );
    assert.equal(
      await readFile(join(testFixture.installDirectory, "flowmark"), "utf8"),
      "#!/bin/sh\necho flowmark-test\n",
    );
    assert.notEqual((await stat(join(testFixture.installDirectory, "flowmark"))).mode & 0o111, 0);
    assert.match(result.stdout, /installed Flowmark/i);
  } finally {
    await rm(testFixture.directory, { recursive: true, force: true });
  }
});

test("installer supports a pinned release version", async () => {
  const testFixture = await fixture();
  try {
    const result = spawnSync("sh", [installer], {
      env: { ...testFixture.env, FLOWMARK_VERSION: "v0.1.0" },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      await readFile(testFixture.curlLog, "utf8"),
      /\/releases\/download\/v0\.1\.0\/flowmark-darwin-arm64\.tar\.gz/,
    );
  } finally {
    await rm(testFixture.directory, { recursive: true, force: true });
  }
});

test("installer rejects unsupported operating systems before downloading", async () => {
  const testFixture = await fixture();
  try {
    const result = spawnSync("sh", [installer], {
      env: { ...testFixture.env, FAKE_UNAME_SYSTEM: "Plan9" },
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported operating system.*Plan9/i);
    await assert.rejects(() => readFile(testFixture.curlLog, "utf8"));
  } finally {
    await rm(testFixture.directory, { recursive: true, force: true });
  }
});

test("installer rejects a corrupted archive without replacing the target", async () => {
  const testFixture = await fixture({ checksum: "0".repeat(64) });
  const target = join(testFixture.installDirectory, "flowmark");
  try {
    await writeFile(target, "existing installation\n");
    const result = spawnSync("sh", [installer], {
      env: testFixture.env,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum/i);
    assert.equal(await readFile(target, "utf8"), "existing installation\n");
  } finally {
    await rm(testFixture.directory, { recursive: true, force: true });
  }
});
