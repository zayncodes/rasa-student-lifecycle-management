import "server-only";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { isLocalClientDataModeEnabled } from "@/lib/local-client-data.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isLoopbackHost(hostHeader: string | null) {
  if (!hostHeader) return false;
  const host = hostHeader.split(",", 1)[0].trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]")) === "::1";
  const hostname = host.split(":", 1)[0];
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function configuredDataPath() {
  const configuredPath = process.env.LOCAL_CLIENT_DATA_PATH?.trim();
  if (!configuredPath) return null;
  const isWindowsAbsolutePath = /^[A-Za-z]:[\\/]/.test(configuredPath);
  if ((!path.isAbsolute(configuredPath) && !isWindowsAbsolutePath) || path.extname(configuredPath).toLowerCase() !== ".json") {
    return null;
  }
  return configuredPath;
}

export async function GET(request: Request) {
  if (!isLocalClientDataModeEnabled() || !isLoopbackHost(request.headers.get("host"))) {
    return new Response("Not found", { status: 404 });
  }

  const dataPath = configuredDataPath();
  if (!dataPath) {
    return new Response("Local workbook extraction is not configured.", { status: 404 });
  }

  try {
    const file = await stat(dataPath);
    if (!file.isFile()) throw new Error("Configured local data path is not a file.");
    const stream = Readable.toWeb(createReadStream(dataPath)) as ReadableStream;
    return new Response(stream, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Length": String(file.size),
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Local workbook extraction was not found.", { status: 404 });
  }
}
