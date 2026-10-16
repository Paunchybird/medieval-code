import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export function viewerRoot(): string {
  return path.resolve(__dirname, "../../viewer/dist");
}

/** Serves the built viewer plus one town.json. */
export function createViewerServer(townJsonPath: string, root = viewerRoot()): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/town.json") {
      // read on every request, so a re-scan shows up on reload
      fs.readFile(townJsonPath, (err, data) => {
        if (err) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(`Cannot read ${townJsonPath}`);
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(data);
      });
      return;
    }

    const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = path.join(root, rel);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    });
  });
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
}

/**
 * Starts the viewer on `port`, or on the next free port when it is busy
 * (up to 20 tries). Resolves with the server and the port it got.
 */
export async function serveViewer(port: number, townJsonPath: string): Promise<{ server: http.Server; port: number }> {
  const root = viewerRoot();
  if (!fs.existsSync(path.join(root, "index.html"))) {
    throw new Error(`The viewer is not built (${root} is missing). Run "npm run build" in the medieval-code folder.`);
  }
  const server = createViewerServer(townJsonPath, root);
  for (let p = port; p < port + 20; p++) {
    try {
      return { server, port: await listen(server, p) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  throw new Error(`Ports ${port}–${port + 19} are all busy. Pick another with --port.`);
}
