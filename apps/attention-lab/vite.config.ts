import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@aperture/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      "@aperture/codex": resolve(__dirname, "../../packages/codex/src/index.ts"),
      "@aperture/paperclip": resolve(__dirname, "../../packages/paperclip/src/index.ts"),
    },
  },
});
