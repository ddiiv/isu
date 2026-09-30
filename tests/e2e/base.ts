import { test as base, expect, type Page } from "@playwright/test";

/*
 * Igual que el `test` de Playwright, pero cada navegación espera a que la
 * página tenga su JavaScript andando (<html data-hidratado>). En modo
 * desarrollo Next compila al vuelo y un clic temprano se pierde.
 */
export const test = base.extend({
  page: async ({ page }, usar) => {
    const esperar = () => page.locator("html[data-hidratado]").waitFor({ state: "attached", timeout: 60_000 }).catch(() => {});
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (...a: Parameters<Page["goto"]>) => { const r = await goto(...a); await esperar(); return r; };
    page.reload = async (...a: Parameters<Page["reload"]>) => { const r = await reload(...a); await esperar(); return r; };
    await usar(page);
  },
});
export { expect, type Page };
