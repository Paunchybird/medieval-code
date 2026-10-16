import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

// Tests run against the TypeScript sources, so `npm test` needs no build.
export default defineConfig({
  resolve: {
    alias: {
      "@medieval-code/model": src("model"),
      "@medieval-code/parser": src("parser"),
      "@medieval-code/layout": src("layout"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/fixtures/**", "**/node_modules/**"],
    testTimeout: 30000,
  },
});
