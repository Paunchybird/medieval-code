import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateTownModel } from "@medieval-code/model";
import { scanRepo } from "../packages/cli/src/scan";
import { createViewerServer } from "../packages/cli/src/server";
import { formatSummary, summarize } from "../packages/cli/src/summary";

const FIXTURE = fileURLToPath(new URL("./fixtures/kingdom", import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mc-cli-"));

function get(port: number, p: string): Promise<{ status: number; body: string; type: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, type: String(res.headers["content-type"]) }));
    }).on("error", reject);
  });
}

const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe("scan", () => {
  it("writes a valid town.json", () => {
    const out = path.join(tmp(), "town.json");
    expect(scanRepo({ root: FIXTURE, out })).toBe(out);
    const town = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(validateTownModel(town)).toBe(true);
    expect(town.meta.parsedFiles).toBe(9);
    expect(town.meta.root).toBe(FIXTURE);
  });

  it("honours .medieval-code.json excludes and caps", () => {
    const dir = tmp();
    fs.cpSync(FIXTURE, dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".medieval-code.json"), JSON.stringify({ excludeGlobs: ["tools/**"], theme: "night" }));
    const out = scanRepo({ root: dir, out: path.join(dir, "t.json") });
    const town = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(town.meta.parsedFiles).toBe(5);
    expect(town.meta.theme).toBe("night");
    expect(town.districts.some((d: { id: string }) => d.id.startsWith("tools"))).toBe(false);
  });

  it("summarises hotspots for the terminal", () => {
    const out = path.join(tmp(), "town.json");
    scanRepo({ root: FIXTURE, out });
    const town = JSON.parse(fs.readFileSync(out, "utf8"));
    const s = summarize(town);
    expect(s.hotspots[0]).toMatchObject({ name: "run", complexity: 5, file: "src/core/engine.ts" });
    expect(formatSummary(town)).toContain("9 import routes");
  });
});

describe("viewer server", () => {
  it("serves town.json, the viewer files, and refuses path traversal", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>x</title>");
    const townFile = path.join(tmp(), "town.json");
    fs.writeFileSync(townFile, '{"ok":1}');
    const server = createViewerServer(townFile, root);
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;

    expect(await get(port, "/town.json")).toMatchObject({ status: 200, body: '{"ok":1}' });
    const idx = await get(port, "/");
    expect(idx.status).toBe(200);
    expect(idx.type).toContain("text/html");
    expect((await get(port, "/missing.js")).status).toBe(404);
    expect((await get(port, "/..%2f..%2fetc%2fpasswd")).status).toBe(403);
    // a re-scan shows up without restarting the server
    fs.writeFileSync(townFile, '{"ok":2}');
    expect((await get(port, "/town.json")).body).toBe('{"ok":2}');
  });
});
