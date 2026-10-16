import { Engine } from "../core/engine.js";
import { sum } from "../core/math";
import type { Config } from "./types.js";
import http from "node:http";

export function start(config: Config) {
  const engine = new Engine(config);
  const handler = (req: { url?: string }) => {
    while (engine.run(1, 1) < 10) {
      if (req.url === "/stop") break;
    }
    return sum([1, 2, 3]);
  };
  return { engine, handler, http };
}
