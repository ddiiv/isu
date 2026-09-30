"use client";
import { useState } from "react";
import { CuponEntrada, resumenCupon } from "@isu/shared";
import { api, ESTADOS, fecha, pesos, useDatos } from "@/lib/api";
import { nombresCategorias, type Categoria, type FilaProducto } from "@/lib/catalogo";
import { Boton, Campo, Cargando, Casilla, claseEntrada, EntradaPesos, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Cupones (con código, el cliente lo escribe en el carrito o el checkout) y
 * promociones automáticas (sin código, se aplican solas cuando la compra
 * cumple: "10% superando $80.000"). Uno solo por compra: si le tocan varios,
 * gana el que más le descuenta. Va después de la rebaja de la prenda y antes
 * del descuento por transferencia.
 */
type Tipo = "porcentaje" | "monto" | "envio_gratis";
interface Cupon {
  id?: number; codigo: string | null; nombre: string; automatico: boolean; tipo: Tipo; valor: number;
  alcance: "todo" | "categorias" | "productos"; categoriaIds: number[]; productoIds: number[]; sobreRebajas: boolean; minimo: number;
  desde: string | null; hasta: string | null; usosMax: number | null; usosPorCliente: number | null; activo: boolean;
  usos?: number; vigente?: boolean; creadoPor?: string; creadoEn?: string; pedidosPagados?: number; descontado?: number; vendido?: number;
}
interface Uso { numero: string; email: string; estado: string; total: number; descuento: number; creadoEn: string; vigente: boolean }

const vacio: Cupon = {
  codigo: "", nombre: "", automatico: false, tipo: "porcentaje", valor: 10, alcance: "todo", categoriaIds: [], productoIds: [],
  sobreRebajas: true, minimo: 0, desde: null, hasta: null, usosMax: null, usosPorCliente: null, activo: true,
};
const aLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const deLocal = (v: string) => (v ? new Date(v).toISOString() : null);
// Sin letras que se confunden (0/O, 1/I/L).
const codigoAlAzar = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % 31]).join("");
const entero = (v: string, max: number) => { const n = Math.trunc(Number(v.replace(/\D/g, ""))); return n > 0 ? Math.min(n, max) : null; };

export default function Cupones() {
  const yo = useYo();
  const operador = puede(yo, "operador");
  const { datos, error, recargar } = useDatos<{ cupones: Cupon[] }>("cupones");
  const { datos: cats } = useDatos<{ categorias: Categoria[] }>("categorias");
  const [f, setF] = useState<Cupon | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [usos, setUsos] = useState<{ cupon: Cupon; filas: Uso[] } | null>(null);
  const [q, setQ] = useState("");
  const [encontrados, setEncontrados] = useState<FilaProducto[]>([]);
  const [nombresProd, setNombresProd] = useState<Record<number, string>>({});
  const aviso = useAviso();
  const nombres = nombresCategorias(cats?.categorias ?? []);
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;

  // Sólo los campos que acepta la API (la lista trae además usos, totales, fechas de alta…).
  const cuerpoDe = (c: Cupon) => ({
    automatico: c.automatico, codigo: c.automatico ? null : c.codigo?.trim().toUpperCase() || null, nombre: c.nombre, tipo: c.tipo,
    valor: c.tipo === "envio_gratis" ? 0 : c.valor, alcance: c.alcance, categoriaIds: c.categoriaIds, productoIds: c.productoIds,
    sobreRebajas: c.sobreRebajas, minimo: c.minimo, desde: c.desde, hasta: c.hasta, usosMax: c.usosMax, usosPorCliente: c.usosPorCliente, activo: c.activo,
  });
  async function guardar() {
    if (!f) return;
    const cuerpo = cuerpoDe(f);
    // Las mismas reglas que la API: los errores se ven al lado de cada campo.
    const v = CuponEntrada.safeParse(cuerpo);
    if (!v.success) {
      const m: Record<string, string> = {};
      for (const i of v.error.issues) m[String(i.path[0] ?? "general")] ??= i.message;
      setErrores(m);
      return;
    }
    setErrores({});
    try {
      if (f.id) await api(`cupones/${f.id}`, { metodo: "PUT", cuerpo: v.data }); else await api("cupones", { cuerpo: v.data });
      aviso.ok(f.automatico ? "Promoción guardada: ya se aplica en el carrito." : "Cupón guardado: ya se puede usar en la tienda.");
      setF(null); await recargar();
    } catch (e) { aviso.error(e); }
  }
  async function pausar(c: Cupon) {
    try { await api(`cupones/${c.id}`, { metodo: "PUT", cuerpo: { ...cuerpoDe(c), activo: !c.activo } }); await recargar(); } catch (e) { aviso.error(e); }
  }
  async function verUsos(c: Cupon) {
    try { setUsos({ cupon: c, filas: (await api<{ usos: Uso[] }>(`cupones/${c.id}/usos`)).usos }); } catch (e) { aviso.error(e); }
  }
  async function buscar() {
    try { setEncontrados((await api<{ productos: FilaProducto[] }>("productos", { query: { q, filtro: "todos" } })).productos.slice(0, 20)); } catch (e) { aviso.error(e); }
  }
  const alcance = (c: Cupon) => c.alcance === "todo" ? "Toda la tienda" : c.alcance === "categorias" ? c.categoriaIds.map((x) => nombres.get(x) ?? `#${x}`).join(", ") : `${c.productoIds.length} prenda${c.productoIds.length === 1 ? "" : "s"}`;
  const err = (k: string) => errores[k] ?? null;

  return (
    <>
      <Titulo acciones={operador && (
        <span className="flex flex-wrap gap-2">
          <Boton onClick={() => { setErrores({}); setF({ ...vacio, codigo: codigoAlAzar() }); }}>Nuevo cupón</Boton>
          <Boton variante="borde" onClick={() => { setErrores({}); setF({ ...vacio, automatico: true, codigo: null, minimo: 8_000_000, nombre: "" }); }}>Nueva promo por monto</Boton>
        </span>
      )}>Cupones y promociones</Titulo>
      <p className="mb-4 max-w-3xl text-sm text-tinta-suave">
        Uno por compra: si al cliente le tocan varios (el cupón que escribió y alguna promo), se aplica el que más le descuenta.
        Se calcula sobre el precio ya rebajado y antes del descuento por transferencia.
      </p>
      <div className="mb-4"><aviso.Aviso /></div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Tarjeta>
          <ul className="divide-y divide-linea">
            {datos.cupones.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="font-bold">{c.automatico ? c.nombre : <code className="rounded bg-fondo-suave px-1.5 py-0.5">{c.codigo}</code>}</span>{" "}
                  <Insignia clase="bg-oferta text-white">{resumenCupon(c, pesos)}</Insignia>{" "}
                  {c.automatico && <Insignia clase="bg-marca-claro text-marca">Automática</Insignia>}{" "}
                  {c.vigente ? <Insignia clase="bg-ahorro-claro text-ahorro">Vigente</Insignia>
                    : <Insignia>{!c.activo ? "Pausado" : c.usosMax !== null && (c.usos ?? 0) >= c.usosMax ? "Agotado" : "Fuera de fecha"}</Insignia>}
                  {!c.automatico && <span className="block text-sm">{c.nombre}</span>}
                  <span className="block text-xs text-tinta-tenue">
                    {alcance(c)}{c.minimo ? ` · desde ${pesos(c.minimo)}` : ""}{!c.sobreRebajas ? " · no en ofertas" : ""}
                    {" · "}{c.desde ? `desde ${fecha(c.desde)}` : "desde ya"} · {c.hasta ? `hasta ${fecha(c.hasta)}` : "sin fin"}
                  </span>
                  <span className="block text-xs text-tinta-tenue">
                    Usos: {c.usos ?? 0}{c.usosMax !== null ? ` de ${c.usosMax}` : ""}{c.usosPorCliente ? ` · ${c.usosPorCliente} por cliente` : ""}
                    {" · "}{c.pedidosPagados ?? 0} pagados · descontado {pesos(c.descontado ?? 0)} · vendido {pesos(c.vendido ?? 0)}
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <Boton variante="texto" onClick={() => void verUsos(c)}>Pedidos</Boton>
                  {operador && <>
                    <Boton variante="texto" onClick={() => { setErrores({}); setF({ ...c }); }}>Editar</Boton>
                    <Boton variante="texto" onClick={() => void pausar(c)}>{c.activo ? "Pausar" : "Activar"}</Boton>
                    {!c.usos && !c.pedidosPagados && <Boton variante="texto" className="text-oferta" onClick={() => confirm(`¿Borrar "${c.codigo ?? c.nombre}"?`) && void api(`cupones/${c.id}`, { metodo: "DELETE" }).then(recargar, aviso.error)}>Borrar</Boton>}
                  </>}
                </span>
              </li>
            ))}
            {!datos.cupones.length && <li className="py-8 text-center text-tinta-tenue">Todavía no hay cupones ni promociones.</li>}
          </ul>
        </Tarjeta>

        {f && (
          <Tarjeta titulo={f.id ? (f.automatico ? "Editar promoción" : "Editar cupón") : f.automatico ? "Nueva promoción por monto" : "Nuevo cupón"}>
            <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="sr-only">Clase</legend>
                <label className="flex items-center gap-2"><input type="radio" checked={!f.automatico} onChange={() => setF({ ...f, automatico: false, codigo: f.codigo || codigoAlAzar() })} className="accent-marca" /> Cupón con código</label>
                <label className="flex items-center gap-2"><input type="radio" checked={f.automatico} onChange={() => setF({ ...f, automatico: true, codigo: null, usosPorCliente: null })} className="accent-marca" /> Promoción automática</label>
              </fieldset>
              {!f.automatico && (
                <Campo etiqueta="Código" ayuda="Lo que escribe el cliente. Mayúsculas, sin espacios." error={err("codigo")}>
                  <span className="flex gap-2">
                    <input required maxLength={30} className={`${claseEntrada} font-mono uppercase`} value={f.codigo ?? ""} aria-invalid={!!err("codigo")}
                      onChange={(e) => setF({ ...f, codigo: e.target.value.toUpperCase().replace(/\s+/g, "") })} />
                    <Boton variante="borde" onClick={() => setF({ ...f, codigo: codigoAlAzar() })}>Al azar</Boton>
                  </span>
                </Campo>
              )}
              <Campo etiqueta="Nombre" ayuda="Lo ve el cliente cuando se aplica (ej.: 10% OFF en remeras)." error={err("nombre")}>
                <input required maxLength={80} className={claseEntrada} value={f.nombre} aria-invalid={!!err("nombre")} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Descuento">
                  <select className={claseEntrada} value={f.tipo} onChange={(e) => { const t = e.target.value as Tipo; setF({ ...f, tipo: t, valor: t === "porcentaje" ? 10 : t === "monto" ? 500_000 : 0 }); }}>
                    <option value="porcentaje">Porcentaje</option><option value="monto">Monto fijo</option><option value="envio_gratis">Envío gratis</option>
                  </select>
                </Campo>
                {f.tipo === "porcentaje" && (
                  <Campo etiqueta="Porcentaje" error={err("valor")}>
                    <span className="relative block"><input type="number" min={1} max={90} className={`${claseEntrada} pr-8`} value={f.valor} aria-invalid={!!err("valor")}
                      onChange={(e) => setF({ ...f, valor: Math.max(0, Math.min(90, Math.trunc(Number(e.target.value)) || 0)) })} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tinta-tenue">%</span></span>
                  </Campo>
                )}
                {f.tipo === "monto" && <Campo etiqueta="Monto" error={err("valor")}><EntradaPesos valor={f.valor} onChange={(v) => setF({ ...f, valor: v ?? 0 })} /></Campo>}
              </div>
              {f.tipo === "envio_gratis" && <p className="text-xs text-tinta-tenue">Deja el envío en $0 con cualquier transporte, salvo Mercado Envíos (lo cobra Mercado Pago en su checkout).</p>}
              <Campo etiqueta="Compra mínima" ayuda="Sobre el total de productos ya rebajados. Vacío = sin mínimo." error={err("minimo")}>
                <EntradaPesos valor={f.minimo || null} onChange={(v) => setF({ ...f, minimo: v ?? 0 })} />
              </Campo>
              <Campo etiqueta="Se aplica a" error={err("categoriaIds") ?? err("productoIds")}>
                <select className={claseEntrada} value={f.alcance} onChange={(e) => setF({ ...f, alcance: e.target.value as Cupon["alcance"] })}>
                  <option value="todo">Toda la tienda</option><option value="categorias">Categorías</option><option value="productos">Prendas elegidas</option>
                </select>
              </Campo>
              {f.alcance === "categorias" && (
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-linea p-3">
                  {(cats?.categorias ?? []).map((c) => <Casilla key={c.id} etiqueta={<span className="font-normal">{nombres.get(c.id)}</span>} marcada={f.categoriaIds.includes(c.id)} onChange={(v) => setF({ ...f, categoriaIds: v ? [...f.categoriaIds, c.id] : f.categoriaIds.filter((x) => x !== c.id) })} />)}
                  <p className="text-xs text-tinta-tenue">Una categoría principal incluye sus subcategorías.</p>
                </div>
              )}
              {f.alcance === "productos" && (
                <div className="space-y-2 rounded-xl border border-linea p-3">
                  <div className="flex gap-2"><input className={claseEntrada} placeholder="Buscar prenda o SKU" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void buscar(); } }} /><Boton variante="borde" onClick={() => void buscar()}>Buscar</Boton></div>
                  <ul className="max-h-40 overflow-y-auto text-sm">{encontrados.map((p) => (
                    <li key={p.id}><Casilla etiqueta={<span className="font-normal">{p.nombre} <span className="text-xs text-tinta-tenue">{p.sku}</span></span>} marcada={f.productoIds.includes(p.id)}
                      onChange={(v) => { setNombresProd((n) => ({ ...n, [p.id]: p.nombre })); setF({ ...f, productoIds: v ? [...f.productoIds, p.id] : f.productoIds.filter((x) => x !== p.id) }); }} /></li>
                  ))}</ul>
                  <p className="text-xs text-tinta-tenue">Elegidas: {f.productoIds.length ? f.productoIds.map((id) => nombresProd[id] ?? `#${id}`).join(", ") : "ninguna"}</p>
                </div>
              )}
              {f.tipo !== "envio_gratis" && <Casilla etiqueta="También a prendas que ya están en oferta" marcada={f.sobreRebajas} onChange={(v) => setF({ ...f, sobreRebajas: v })} />}
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Desde"><input type="datetime-local" className={claseEntrada} value={aLocal(f.desde)} onChange={(e) => setF({ ...f, desde: deLocal(e.target.value) })} /></Campo>
                <Campo etiqueta="Hasta" error={err("hasta")}><input type="datetime-local" className={claseEntrada} value={aLocal(f.hasta)} onChange={(e) => setF({ ...f, hasta: deLocal(e.target.value) })} /></Campo>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Usos en total" ayuda="Vacío = sin tope.">
                  <input inputMode="numeric" className={claseEntrada} value={f.usosMax ?? ""} onChange={(e) => setF({ ...f, usosMax: entero(e.target.value, 10_000_000) })} />
                </Campo>
                {!f.automatico && (
                  <Campo etiqueta="Por cliente" ayuda="Por email. Vacío = sin tope." error={err("usosPorCliente")}>
                    <input inputMode="numeric" className={claseEntrada} value={f.usosPorCliente ?? ""} onChange={(e) => setF({ ...f, usosPorCliente: entero(e.target.value, 1000) })} />
                  </Campo>
                )}
              </div>
              <Casilla etiqueta="Activo" marcada={f.activo} onChange={(v) => setF({ ...f, activo: v })} />
              {errores.general && <Mensaje>{errores.general}</Mensaje>}
              <div className="flex gap-2"><Boton type="submit">Guardar</Boton><Boton variante="borde" onClick={() => setF(null)}>Cancelar</Boton></div>
            </form>
          </Tarjeta>
        )}

        {usos && !f && (
          <Tarjeta titulo={`Pedidos con ${usos.cupon.codigo ?? usos.cupon.nombre}`} acciones={<Boton variante="texto" onClick={() => setUsos(null)}>Cerrar</Boton>}>
            {usos.filas.length ? (
              <ul className="divide-y divide-linea text-sm">
                {usos.filas.map((u) => (
                  <li key={u.numero} className="flex flex-wrap justify-between gap-2 py-2">
                    <span><a href={`/pedidos/${u.numero}`} className="font-bold underline">{u.numero}</a> <span className="text-tinta-tenue">{u.email}</span>
                      <span className="block text-xs text-tinta-tenue">{fecha(u.creadoEn)} · {ESTADOS[u.estado]?.[0] ?? u.estado}{!u.vigente ? " · no cuenta (el pedido se cayó)" : ""}</span></span>
                    <span className="text-right">−{pesos(u.descuento)}<span className="block text-xs text-tinta-tenue">total {pesos(u.total)}</span></span>
                  </li>
                ))}
              </ul>
            ) : <p className="py-6 text-center text-tinta-tenue">Todavía no se usó.</p>}
          </Tarjeta>
        )}
      </div>
    </>
  );
}
