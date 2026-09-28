import "server-only";

export const dynamic = "force-dynamic";

/* Estado de los servicios. El login y las pantallas llegan en la etapa 3. */
async function estado() {
  try {
    const r = await fetch(`${process.env.API_URL ?? "http://127.0.0.1:4000"}/readyz`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    return (await r.json()) as { ok: boolean; db: boolean; redis: boolean };
  } catch {
    return { ok: false, db: false, redis: false };
  }
}

export default async function Inicio() {
  const e = await estado();
  const fila = (nombre: string, ok: boolean) => (
    <li className="flex items-center justify-between border-b border-linea py-3 last:border-0">
      <span>{nombre}</span>
      <span className={`rounded-full px-3 py-0.5 text-sm font-bold ${ok ? "bg-ahorro-claro text-ahorro" : "bg-red-50 text-oferta"}`}>{ok ? "OK" : "Sin respuesta"}</span>
    </li>
  );
  return (
    <main className="mx-auto max-w-lg px-4 py-20">
      <h1 className="text-4xl text-marca">Backoffice Isuwaya</h1>
      <p className="mt-2 text-tinta-suave">El ingreso y la gestión de productos, descuentos, clientes y envíos se habilitan en la etapa 3.</p>
      <ul className="mt-8 rounded-2xl border border-linea bg-white px-5">
        {fila("API", e.ok)}
        {fila("Base de datos (Stocker · esquema tienda)", e.db)}
        {fila("Redis", e.redis)}
      </ul>
    </main>
  );
}
