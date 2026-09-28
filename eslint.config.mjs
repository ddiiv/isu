import js from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/next-env.d.ts", "coverage/**", "playwright-report/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      // Da falsos positivos con cada obj[clave] tipado; los accesos dinámicos
      // con datos del usuario se validan con Zod antes de llegar acá.
      "security/detect-object-injection": "off",
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
    },
  },
  {
    // Los scripts de prueba imprimen su informe: ahí la consola es la salida.
    files: ["tests/**/*.mjs"],
    rules: { "no-console": "off" },
  },
);
