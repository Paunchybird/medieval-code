import { clamp } from "./math.js";
import type { Config } from "../api/types";

export class Engine {
  private ticks = 0;
  constructor(private config: Config) {
    if (!config.name) {
      throw new Error("unnamed");
    }
  }

  get name() {
    return this.config.name;
  }

  run(steps: number, speed: number): number {
    for (let i = 0; i < steps; i++) {
      if (i % 2 === 0) {
        this.ticks += speed;
      } else if (i % 3 === 0) {
        this.ticks -= 1;
      } else {
        this.ticks = clamp(this.ticks, 0, 100);
      }
    }
    return this.ticks;
  }

  mode(kind: string): number {
    switch (kind) {
      case "fast":
        return 2;
      case "slow":
        return 0.5;
      default:
        return 1;
    }
  }
}

export const helpers = {
  double: (n: number) => n * 2,
  safe(fn: () => void) {
    try {
      fn();
    } catch {
      return false;
    }
    return true;
  },
};
