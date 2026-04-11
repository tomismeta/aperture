import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/internal.ts", "src/semantic.ts", "src/trace.ts"],
  outDir: "public-dist",
  format: ["esm"],
  platform: "node",
  target: "node18",
  bundle: true,
  clean: true,
  dts: {
    compilerOptions: {
      composite: false,
    },
  },
  sourcemap: false,
  splitting: false,
  minify: false,
  treeshake: true,
  skipNodeModulesBundle: true,
});
