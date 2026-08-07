import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  discoverPublicAssets,
  generateReleaseEntry,
  mimeTypeFor,
  releaseArtifactName,
} from "../scripts/build-binary.ts";
import { extractAssetPath, extractDaemonDetails } from "../scripts/smoke-binary.ts";
import { isAllowedLoopbackRequest } from "../src/lib/local-web-server.ts";
import { releaseAssetName } from "../src/lib/self-update.ts";

test("release artifact names are stable for native and cross targets", () => {
  assert.equal(releaseArtifactName(), "flowmark");
  assert.equal(releaseArtifactName("bun-darwin-arm64"), "flowmark-darwin-arm64");
  assert.equal(releaseArtifactName("bun-darwin-x64"), "flowmark-darwin-x64");
  assert.equal(releaseArtifactName("bun-linux-x64"), "flowmark-linux-x64");
  assert.throws(() => releaseArtifactName("bun-windows-x64"), /unsupported release target/i);
});

test("updater asset selection stays aligned with binary release targets", () => {
  for (const [target, platform, architecture] of [
    ["bun-darwin-arm64", "darwin", "arm64"],
    ["bun-darwin-x64", "darwin", "x64"],
    ["bun-linux-x64", "linux", "x64"],
  ] as const) {
    assert.equal(releaseAssetName(platform, architecture), `${releaseArtifactName(target)}.tar.gz`);
  }
});

test("embedded public assets are sorted and retain their public URL and MIME type", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-assets-"));
  try {
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "assets", "z.js"), "console.log('z')");
    await writeFile(join(root, "assets", "a.css"), "body{}");
    await writeFile(join(root, "icon.png"), "png");

    assert.deepEqual(
      (await discoverPublicAssets(root)).map(({ urlPath, mimeType }) => ({
        urlPath,
        mimeType,
      })),
      [
        { urlPath: "/assets/a.css", mimeType: "text/css; charset=utf-8" },
        { urlPath: "/assets/z.js", mimeType: "text/javascript; charset=utf-8" },
        { urlPath: "/icon.png", mimeType: "image/png" },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MIME lookup covers release web assets and falls back safely", () => {
  assert.equal(mimeTypeFor("app.js"), "text/javascript; charset=utf-8");
  assert.equal(mimeTypeFor("app.css"), "text/css; charset=utf-8");
  assert.equal(mimeTypeFor("icon.svg"), "image/svg+xml");
  assert.equal(mimeTypeFor("font.woff2"), "font/woff2");
  assert.equal(mimeTypeFor("unknown.bin"), "application/octet-stream");
});

test("generated entry is loopback-only, embeds assets, and injects release adapters", () => {
  const source = generateReleaseEntry([
    {
      urlPath: "/assets/app.js",
      sourcePath: "/build/public/assets/app.js",
      mimeType: "text/javascript; charset=utf-8",
    },
  ]);

  assert.match(source, /hostname:\s*"127\.0\.0\.1"/);
  assert.match(source, /startWebServer/);
  assert.match(source, /launchDaemon/);
  assert.match(source, /import \{[^}]*realpath[^}]*\} from "node:fs\/promises"/);
  assert.match(source, /import \{ updateFlowmark \} from "\.\.\/src\/lib\/self-update\.ts"/);
  assert.match(source, /runUpdate:\s*async \(\)\s*=>/);
  assert.match(source, /installMacosCardLinkHandler/);
  assert.match(source, /openCardInSafari/);
  assert.match(source, /installCardLinkHandler:\s*async \(\)\s*=>/);
  assert.match(
    source,
    /updateFlowmark\(\{ executablePath: await realpath\(process\.execPath\) \}\)/,
  );
  assert.match(source, /FLOWMARK_WORKSPACE_ROOT/);
  assert.match(source, /isAllowedLoopbackRequest/);
  assert.match(source, /\/assets\/app\.js/);
  assert.match(source, /flowmark-asset-0\.asset/);
  assert.match(source, /preferredPort = 3000/);
  assert.match(source, /EADDRINUSE/);
  assert.match(source, /startEmbeddedServer\(workspaceRoot, 0\)/);
  assert.doesNotMatch(source, /0\.0\.0\.0/);
});

test("release server rejects DNS-rebinding hosts and cross-origin writes", () => {
  const port = 43123;
  assert.equal(
    isAllowedLoopbackRequest(
      new Request(`http://127.0.0.1:${port}/`, {
        headers: { host: `127.0.0.1:${port}` },
      }),
      port,
    ),
    true,
  );
  assert.equal(
    isAllowedLoopbackRequest(
      new Request(`http://localhost:${port}/`, {
        method: "POST",
        headers: {
          host: `localhost:${port}`,
          origin: `http://localhost:${port}`,
        },
      }),
      port,
    ),
    true,
  );
  assert.equal(
    isAllowedLoopbackRequest(
      new Request(`http://attacker.example:${port}/`, {
        headers: { host: `attacker.example:${port}` },
      }),
      port,
    ),
    false,
  );
  assert.equal(
    isAllowedLoopbackRequest(
      new Request(`http://127.0.0.1:${port}/`, {
        method: "POST",
        headers: {
          host: `127.0.0.1:${port}`,
          origin: "https://attacker.example",
        },
      }),
      port,
    ),
    false,
  );
});

test("binary smoke output parsing requires a loopback URL and session ID", () => {
  assert.deepEqual(
    extractDaemonDetails("http://127.0.0.1:43123/\nSession: session_0123456789ab\n"),
    {
      id: "session_0123456789ab",
      url: "http://127.0.0.1:43123/",
    },
  );
  assert.throws(
    () => extractDaemonDetails("http://192.168.1.10:43123/\nSession: session_0123456789ab\n"),
    /loopback/i,
  );
  assert.throws(() => extractDaemonDetails("not ready"), /session/i);
});

test("binary smoke asset parsing finds a built stylesheet or script", () => {
  assert.equal(
    extractAssetPath(
      '<link rel="stylesheet" href="/assets/app-123.css"><script src="/assets/app.js"></script>',
    ),
    "/assets/app-123.css",
  );
  assert.throws(() => extractAssetPath("<main>Flowmark</main>"), /asset/i);
});
