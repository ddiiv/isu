import pg from "pg";
import { z } from "zod";

/*
 * Escucha los avisos de Stocker (NOTIFY stock_cambio, '<negocio>:<variante>',
 * contrato v1 § 5 c).
 *
 * Stocker avisa QUÉ variante cambió (también al apartar o liberar una
 * reserva), no cuánto hay: el número se le pide por su API, que es la que
 * sabe calcularlo. El aviso es de toda la base, así que se filtra por negocio.
 *
 * NOTIFY no guarda nada si nadie escucha: si la conexión se corta, los avisos
 * de ese rato se pierden. Por eso, al reconectar, se pide el catálogo
 * completo, y además la conciliación periódica lo cubre igual.
 */
export const CANAL = "stock_cambio";
/* Etapa 4: Stocker despachó un pedido de la tienda (o le falta mercadería). */
export const CANAL_ENVIOS = "stocker_tienda_envios";
const AvisoEnvio = z.object({ b: z.number().int().positive(), p: z.string().regex(/^ISU-\d{4,10}$/), e: z.enum(["despachado", "faltante"]) });

/** '<negocio>:<variante>' → [negocio, variante] */
function leerAviso(t: string): [number, number] | null {
  const m = /^(\d{1,10}):(\d{1,12})$/.exec(t.trim());
  if (!m) return null;
  const b = Number(m[1]), v = Number(m[2]);
  return b > 0 && v > 0 && Number.isSafeInteger(v) ? [b, v] : null;
}

export interface OpcionesEscucha {
  url: string;
  ssl?: boolean;
  /** negocio de la tienda en Stocker; null = todavía no se sabe (no filtra) */
  negocio: () => Promise<number | null>;
  /** ids de variante de Stocker que cambiaron */
  alCambiar: (variantes: number[]) => Promise<void> | void;
  alReconectar: () => Promise<void> | void;
  /** Aviso de despacho de un pedido de la tienda. */
  alEnvio?: (numero: string, evento: "despachado" | "faltante") => Promise<void> | void;
  /** espera para juntar avisos seguidos (una venta de 5 artículos = 1 pedido) */
  esperaMs?: number;
  log?: Pick<Console, "warn" | "error">;
}

export function escucharStocker(o: OpcionesEscucha) {
  const espera = o.esperaMs ?? 800;
  const log = o.log ?? console;
  let cliente: pg.Client | null = null;
  let escuchando = false;
  let parado = false;
  let intentos = 0;
  let primera = true;
  const pendientes = new Set<number>();
  let timer: NodeJS.Timeout | null = null;
  let reconexion: NodeJS.Timeout | null = null;

  const vaciar = async () => {
    timer = null;
    const variantes = [...pendientes];
    pendientes.clear();
    if (variantes.length) {
      try { await o.alCambiar(variantes); } catch (e) { log.error("[escucha] no se pudo encolar el aviso:", (e as Error).message); }
    }
  };

  async function conectar() {
    if (parado) return;
    const c = new pg.Client({
      connectionString: o.url,
      ssl: o.ssl ? { rejectUnauthorized: false } : undefined,
      application_name: "isu-tienda-escucha",
      // Sin statement_timeout de sesión que corte el LISTEN: es una conexión ociosa a propósito.
      keepAlive: true,
    });
    c.on("notification", async (n) => {
      if (n.channel === CANAL_ENVIOS && n.payload && o.alEnvio) {
        let a: z.infer<typeof AvisoEnvio>;
        try { a = AvisoEnvio.parse(JSON.parse(n.payload)); } catch { return; }
        const mio = await o.negocio().catch(() => null);
        if (mio !== null && a.b !== mio) return;
        try { await o.alEnvio(a.p, a.e); } catch (e) { log.error("[escucha] no se pudo encolar el despacho:", (e as Error).message); }
        return;
      }
      if (n.channel !== CANAL || !n.payload) return;
      const aviso = leerAviso(n.payload);
      if (!aviso) return;
      const mio = await o.negocio().catch(() => null);
      if (mio !== null && aviso[0] !== mio) return;
      if (pendientes.size >= 5000) return; // una avalancha: la cubre el catálogo periódico
      pendientes.add(aviso[1]);
      if (!timer) timer = setTimeout(() => void vaciar(), espera);
    });
    const caida = (motivo: string) => {
      if (cliente !== c) return;
      cliente = null;
      escuchando = false;
      c.removeAllListeners("error");
      c.on("error", () => {});
      c.end().catch(() => {});
      if (parado) return;
      const ms = Math.min(30_000, 1000 * 2 ** Math.min(intentos++, 5));
      log.warn(`[escucha] conexión perdida (${motivo}); reintento en ${ms} ms`);
      reconexion = setTimeout(() => void conectar(), ms);
    };
    c.on("error", (e) => caida(e.message));
    c.on("end", () => caida("cerrada"));
    cliente = c;
    try {
      await c.connect();
      await c.query(`LISTEN ${CANAL}`);
      if (o.alEnvio) await c.query(`LISTEN ${CANAL_ENVIOS}`);
      escuchando = true;
      intentos = 0;
      if (!primera) await o.alReconectar();
      primera = false;
    } catch (e) {
      caida((e as Error).message);
    }
  }

  void conectar();
  return {
    conectado: () => escuchando,
    async parar() {
      parado = true;
      if (reconexion) clearTimeout(reconexion);
      if (timer) { clearTimeout(timer); await vaciar(); }
      const c = cliente;
      cliente = null;
      escuchando = false;
      if (c) await c.end().catch(() => {});
    },
  };
}
