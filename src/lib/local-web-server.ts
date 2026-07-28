export interface LocalWebServer {
  url: string;
  close(): Promise<void>;
}

export type StartLocalWebServer = (workspaceRoot: string) => Promise<LocalWebServer>;

export function isAllowedLoopbackRequest(request: Request, port: number) {
  const host = request.headers.get("host")?.toLowerCase();
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!host || !allowedHosts.has(host)) return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}
