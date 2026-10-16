import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5179,
    proxy: {
      "/town.json": {
        target: "http://localhost:5180",
        changeOrigin: true,
      },
    },
  },
});
