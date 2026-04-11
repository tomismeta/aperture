import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/public-dist/**",
      "**/generated/**",
      "**/*.d.ts",
      "**/*.js",
      "**/*.js.map",
      "**/*.tsbuildinfo",
      ".aperture/**",
      ".claude/**",
      ".codex/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        tsconfigRootDir: rootDir,
      },
    },
    rules: {
      "no-control-regex": "off",
      "no-fallthrough": "warn",
      "no-shadow": "off",
      "no-unused-vars": "off",
      "no-useless-escape": "off",
      "no-useless-assignment": "warn",
      "preserve-caught-error": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-shadow": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
