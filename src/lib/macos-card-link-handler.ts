import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildSessionCardUrl } from "./card-links";

type RunCommand = (command: string, args: string[]) => Promise<string | void>;

interface CommandOptions {
  run?: RunCommand;
  homeDirectory?: string;
  fileExists?: (path: string) => Promise<boolean>;
  readWebAppStartUrl?: (appPath: string) => Promise<string | undefined>;
}

export interface InstallMacosCardLinkHandlerOptions extends CommandOptions {
  executablePath: string;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}

function appleScriptString(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function buildCardLinkHandlerAppleScript(executablePath: string) {
  return `on open location flowmarkURL
  try
    do shell script quoted form of ${appleScriptString(executablePath)} & " __open-url " & quoted form of flowmarkURL
  end try
end open location
`;
}

export const SAFARI_CARD_OPEN_SCRIPT = `on run argv
  set sessionURL to item 1 of argv
  set targetURL to item 2 of argv
  tell application "Safari"
    set targetTab to missing value
    set targetWindow to missing value
    repeat with candidateWindow in windows
      repeat with candidateTab in tabs of candidateWindow
        try
          if (URL of candidateTab as text) starts with sessionURL then
            set targetTab to candidateTab
            set targetWindow to candidateWindow
            exit repeat
          end if
        end try
      end repeat
      if targetTab is not missing value then exit repeat
    end repeat
    if targetTab is missing value then
      make new document with properties {URL:targetURL}
    else
      set URL of targetTab to targetURL
      set current tab of targetWindow to targetTab
      set index of targetWindow to 1
    end if
    activate
  end tell
end run`;

async function runCommand(command: string, args: string[]) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`${command} exited with code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`);
  }
  return stdout;
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readWebAppStartUrl(appPath: string) {
  try {
    const result = await runCommand("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :Manifest:start_url",
      join(appPath, "Contents", "Info.plist"),
    ]);
    return result?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function sameOrigin(left: string, right: string) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

export async function openCardInSafari(
  sessionUrl: string,
  cardId: string,
  options: CommandOptions = {},
) {
  const targetUrl = buildSessionCardUrl(sessionUrl, cardId);
  const run = options.run ?? runCommand;
  const homeDirectory = options.homeDirectory ?? process.env.HOME;
  const webAppPath = homeDirectory
    ? join(homeDirectory, "Applications", "FlowMark.app")
    : undefined;
  if (webAppPath && (await (options.fileExists ?? fileExists)(webAppPath))) {
    const startUrl = await (options.readWebAppStartUrl ?? readWebAppStartUrl)(webAppPath);
    if (startUrl && sameOrigin(startUrl, sessionUrl)) {
      await run("open", ["-a", webAppPath, targetUrl]);
      return;
    }
  }
  await run("osascript", ["-e", SAFARI_CARD_OPEN_SCRIPT, "--", sessionUrl, targetUrl]);
}

export async function installMacosCardLinkHandler(options: InstallMacosCardLinkHandlerOptions) {
  if ((options.platform ?? process.platform) !== "darwin") {
    throw new Error("Flowmark Safari card links are available on macOS only.");
  }

  const run = options.run ?? runCommand;
  const homeDirectory = options.homeDirectory ?? process.env.HOME;
  if (!homeDirectory)
    throw new Error("Cannot install Flowmark card links without a home directory.");

  const appPath = join(homeDirectory, ".flowmark", "apps", "Flowmark Card Links.app");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "flowmark-card-links-"));
  const sourcePath = join(temporaryRoot, "handler.applescript");
  const compiledPath = join(temporaryRoot, "Flowmark Card Links.app");
  const infoPath = join(compiledPath, "Contents", "Info.plist");

  try {
    await writeFile(sourcePath, buildCardLinkHandlerAppleScript(options.executablePath), "utf8");
    await run("osacompile", ["-o", compiledPath, sourcePath]);
    await run("plutil", [
      "-replace",
      "CFBundleIdentifier",
      "-string",
      "com.flowmark.card-links",
      infoPath,
    ]);
    await run("plutil", ["-replace", "CFBundleName", "-string", "Flowmark Card Links", infoPath]);
    await run("plutil", [
      "-insert",
      "CFBundleURLTypes",
      "-json",
      JSON.stringify([
        {
          CFBundleURLName: "com.flowmark.card-links",
          CFBundleURLSchemes: ["flowmark"],
        },
      ]),
      infoPath,
    ]);
    await run("plutil", [
      "-replace",
      "NSAppleEventsUsageDescription",
      "-string",
      "Flowmark activates your existing Safari task-board tab.",
      infoPath,
    ]);

    await mkdir(dirname(appPath), { recursive: true });
    await rm(appPath, { recursive: true, force: true });
    await rename(compiledPath, appPath);
    await run(
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      ["-f", appPath],
    );
    return { appPath };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
