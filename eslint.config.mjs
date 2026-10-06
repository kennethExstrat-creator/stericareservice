import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Reference material only: the website snapshot and forms (BUILD_SPEC 2.1).
    "docs/**",
    "supabase/**",
    // Agent worktrees (parallel builds) are separate checkouts.
    ".claude/**",
  ]),
]);

export default eslintConfig;
