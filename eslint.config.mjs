import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Renderer: React in a sandboxed browser context.
    files: ["src/**/*.{ts,tsx}", "desktop/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: { globals: globals.browser },
  },
  {
    // Electron main process, build scripts, the Stream Deck plugin and tests.
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  {
    // Playwright tests also contain callbacks that run inside the app page.
    files: ["tests/**/*.cjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    // Node-side helpers may reuse browser names (ImageData, Animation).
    rules: { "no-redeclare": ["error", { builtinGlobals: false }] },
  },
  globalIgnores([
    "node_modules/**",
    "build/**",
    "release/**",
    ".claude/**",
    "public/plugins/**",
  ]),
]);

export default eslintConfig;
