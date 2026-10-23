import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "coverage"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The route tree is a configuration module: it declares lazily-imported
    // page components and default-exports a plain array, so Fast Refresh cannot
    // track it. The rule's advice ("move the components to another file") would
    // only scatter the tree.
    files: ["src/routes.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // The provider and the hook that reads it are one unit — a consumer that can
    // call its hook without being able to mount the provider it needs is a footgun,
    // and splitting them to satisfy a dev-ergonomics rule would make both halves
    // worse. Fast Refresh loses component-level granularity on these files.
    files: ["src/contexts/AuthContext.tsx", "src/contexts/SalonFormattingContext.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
]);
