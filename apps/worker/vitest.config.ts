import { defineConfig } from "vitest/config";
// De a un archivo: comparten la base y la sincronización con Stocker da de baja lo que no está en su catálogo.
export default defineConfig({ test: { testTimeout: 30_000, fileParallelism: false } });
