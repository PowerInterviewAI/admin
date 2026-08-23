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
    // Where `NEXT_DIST_DIR` sends a build run while `pnpm dev` holds `.next` (see next.config.ts).
    // It is generated output, and linting it buries the real findings under ten thousand of its own.
    ".next-*/**",
  ]),
]);

export default eslintConfig;
