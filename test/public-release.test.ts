import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function exists(path: string) {
  try {
    await access(join(root, path));
    return true;
  } catch {
    return false;
  }
}

async function sourceFiles(directory: string): Promise<string[]> {
  const absolute = join(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relative = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(relative) : [relative];
    }),
  );
  return files.flat();
}

test("public repository has the expected community and automation files", async () => {
  for (const path of [
    "README.md",
    "LICENSE",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "install.sh",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/pull_request_template.md",
  ]) {
    assert.equal(await exists(path), true, `${path} must exist`);
  }
});

test("private, generated, and Lovable import artifacts are absent", async () => {
  for (const path of [
    ".lovable",
    "Markdown Flow.zip",
    "workspace.yaml",
    "cards",
    "columns",
    "tags",
    "rules",
    "comments",
    "checklists",
    "templates",
    "archive",
    "src/lib/markdown.ts",
  ]) {
    assert.equal(await exists(path), false, `${path} must not ship at repository root`);
  }
});

test("public source and documentation contain no private checkout paths or Lovable hooks", async () => {
  const files = [
    "AGENTS.md",
    "README.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "install.sh",
    "package.json",
    "vite.config.ts",
    ...(await sourceFiles(".github")),
    ...(await sourceFiles("scripts")),
    ...(await sourceFiles("src")),
    ...(await sourceFiles("docs")),
  ].filter((path) => !path.endsWith(".png"));
  const content = (
    await Promise.all(
      files.map(async (path) => `${path}\n${await readFile(join(root, path), "utf8")}`),
    )
  ).join("\n");

  assert.doesNotMatch(content, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(content, /~\/workdir/);
  assert.doesNotMatch(content, /@nebius\.com/);
  assert.doesNotMatch(content, /__lovable|reportLovableError/);
});

test("build configuration uses official local-only tooling", async () => {
  const vite = await readFile(join(root, "vite.config.ts"), "utf8");
  const rootRoute = await readFile(join(root, "src/routes/__root.tsx"), "utf8");
  const packageJson = await readFile(join(root, "package.json"), "utf8");

  assert.match(vite, /@tanstack\/react-start\/plugin\/vite/);
  assert.match(vite, /@vitejs\/plugin-react/);
  assert.match(vite, /@tailwindcss\/vite/);
  assert.match(vite, /nitro\/vite/);
  assert.match(vite, /resolve:\s*\{\s*tsconfigPaths:\s*true/);
  assert.doesNotMatch(vite, /@lovable\.dev/);
  assert.doesNotMatch(packageJson, /@lovable\.dev|vite-tsconfig-paths/);
  assert.doesNotMatch(rootRoute, /fonts\.googleapis\.com|fonts\.gstatic\.com|preconnect/);
});

test("the public source tree contains only UI primitives used by Flowmark", async () => {
  assert.deepEqual((await sourceFiles("src/components/ui")).sort(), [
    "src/components/ui/button.tsx",
    "src/components/ui/calendar.tsx",
    "src/components/ui/dialog.tsx",
    "src/components/ui/dropdown-menu.tsx",
    "src/components/ui/popover.tsx",
  ]);

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  for (const dependency of [
    "@hookform/resolvers",
    "@radix-ui/react-accordion",
    "@radix-ui/react-alert-dialog",
    "@radix-ui/react-aspect-ratio",
    "@radix-ui/react-avatar",
    "@radix-ui/react-checkbox",
    "@radix-ui/react-collapsible",
    "@radix-ui/react-context-menu",
    "@radix-ui/react-hover-card",
    "@radix-ui/react-label",
    "@radix-ui/react-menubar",
    "@radix-ui/react-navigation-menu",
    "@radix-ui/react-progress",
    "@radix-ui/react-radio-group",
    "@radix-ui/react-scroll-area",
    "@radix-ui/react-select",
    "@radix-ui/react-separator",
    "@radix-ui/react-slider",
    "@radix-ui/react-switch",
    "@radix-ui/react-tabs",
    "@radix-ui/react-toggle",
    "@radix-ui/react-toggle-group",
    "@radix-ui/react-tooltip",
    "cmdk",
    "embla-carousel-react",
    "input-otp",
    "react-hook-form",
    "react-resizable-panels",
    "recharts",
    "sonner",
    "vaul",
    "zod",
  ]) {
    assert.equal(
      packageJson.dependencies[dependency],
      undefined,
      `${dependency} must not ship when its generated component is unused`,
    );
  }
});

test("package and document metadata identify a public MIT-licensed Flowmark release", async () => {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const rootRoute = await readFile(join(root, "src/routes/__root.tsx"), "utf8");
  const routes = (
    await Promise.all(
      (await sourceFiles("src/routes"))
        .filter((path) => path.endsWith(".tsx"))
        .map((path) => readFile(join(root, path), "utf8")),
    )
  ).join("\n");
  const lockfile = await readFile(join(root, "bun.lock"), "utf8");

  assert.equal(packageJson.name, "flowmark");
  assert.equal(packageJson.version, "0.1.0");
  assert.equal(packageJson.private, undefined);
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.author, "carlosray");
  assert.match(String(packageJson.description), /local-first/i);
  assert.match(rootRoute, /Flowmark — Local-first Markdown Kanban/);
  assert.doesNotMatch(routes, /Flow — Local-first Markdown Kanban/);
  assert.match(lockfile, /"name": "flowmark"/);
  assert.doesNotMatch(lockfile, /tanstack_start_ts/);
});

test("GitHub automation verifies source and publishes every supported binary target", async () => {
  const ci = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");
  const release = await readFile(join(root, ".github/workflows/release.yml"), "utf8");

  for (const command of [
    "bun run test",
    "bun run typecheck",
    "bun run lint",
    "bun run format:check",
    "bun run build",
    "bun run binary",
    "bun run test:binary",
  ]) {
    assert.match(ci, new RegExp(command.replaceAll(" ", "\\s+")));
  }
  assert.match(ci, /oven-sh\/setup-bun@v2/);
  assert.match(ci, /branches: \["main", "master"\]/);
  assert.match(release, /bun-darwin-arm64/);
  assert.match(release, /bun-darwin-x64/);
  assert.match(release, /bun-linux-x64/);
  assert.match(release, /sha256sum/);
  assert.match(release, /install\.sh/);
  assert.match(release, /gh release create/);
});

test("README rule examples use validator-compatible due-date actions", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  assert.doesNotMatch(readme, /mode: end_of_day\s+offset_days:/);
});

test("README install instructions match packaged release archives", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  for (const artifact of [
    "flowmark-darwin-arm64.tar.gz",
    "flowmark-darwin-x64.tar.gz",
    "flowmark-linux-x64.tar.gz",
  ]) {
    assert.match(readme, new RegExp(artifact.replaceAll(".", "\\.")));
  }
  assert.match(readme, /tar -xzf/);
  assert.match(readme, /SHA256SUMS/);
});

test("README leads with agent-native workflows and a one-line verified installer", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const installerSource = await readFile(join(root, "install.sh"), "utf8");

  assert.match(readme.slice(0, 2_500), /coding agents/i);
  assert.match(readme, /flowmark init/);
  assert.match(readme, /flowmark schema --all/);
  assert.match(readme, /flowmark validate --strict/);
  assert.match(readme, /ask your agent/i);
  assert.match(
    readme,
    /curl -fsSL https:\/\/raw\.githubusercontent\.com\/carlosray\/flowmark\/master\/install\.sh \| sh/,
  );
  assert.match(installerSource, /SHA256SUMS/);
  assert.match(installerSource, /sha256sum|shasum/);
  assert.match(installerSource, /FLOWMARK_INSTALL_DIR/);
  assert.match(installerSource, /FLOWMARK_VERSION/);
  assert.doesNotMatch(installerSource, /\bsudo\b/);
});

test("type checking covers release scripts and tests", async () => {
  const tsconfig = await readFile(join(root, "tsconfig.json"), "utf8");
  assert.match(tsconfig, /scripts\/\*\*\/\*\.ts/);
  assert.match(tsconfig, /test\/\*\*\/\*\.ts/);
  assert.match(tsconfig, /test\/\*\*\/\*\.tsx/);
});

test("the reproducible Bun lockfile is explicitly committed", async () => {
  const ignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /!bun\.lock/);
});
