"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

/*
 * El marco de todas las pantallas: menú lateral según el rol y quién está
 * adentro. Si no hay sesión, al ingreso. Los permisos de verdad los controla
 * la API en cada pedido: acá sólo se esconde lo que no se puede usar.
 *
 * Etapa 10: menú oscuro agrupado por tema (Ventas, Catálogo, Promociones,
 * Tienda, Administración), con íconos. En el celular, una barra arriba y el
 * menú como cajón lateral.
 */
export type Rol = "dueno" | "operador" | "lectura";
export interface Yo { email: string; nombre: string; rol: Rol; debeCambiarClave: boolean }
const Contexto = createContext<Yo | null>(null);
export const useYo = () => useContext(Contexto)!;
export const puede = (yo: Yo, rol: Rol) => ({ lectura: 0, operador: 1, dueno: 2 })[yo.rol] >= ({ lectura: 0, operador: 1, dueno: 2 })[rol];

/* Íconos de trazo (24×24), del mismo grosor que los de la tienda. */
const ICONOS: Record<string, string> = {
  panel: "M4 13h6V4H4zm10 7h6v-9h-6zM4 20h6v-4H4zm10-11h6V4h-6z",
  pedidos: "M6 3h12l1 4H5zM5 7h14v13H5zM9 11h6",
  transferencias: "M4 9h13l-3-3M20 15H7l3 3",
  envios: "M3 7h11v9H3zm11 3h4l3 3v3h-7zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  clientes: "M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm10 9v-1a4 4 0 0 0-3-3.9M15 4.1a3 3 0 0 1 0 5.8",
  productos: "M8 4l4 2 4-2 4 3-2 4-2-1v10H8V10l-2 1-2-4z",
  categorias: "M4 5h7v7H4zm9 0h7v7h-7zM4 14h7v6H4zm9 0h7v6h-7z",
  talles: "M3 8h18v8H3zM7 8v3m4-3v4m4-4v3m4-3v4",
  portada: "M4 5h16v14H4zm0 10 4-4 3 3 3-3 6 6",
  resenas: "m12 4 2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2l.9-5.5-4-3.9 5.5-.8z",
  descuentos: "M5 19 19 5M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm9 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  cupones: "M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zm10 0v10",
  asistente: "M5 5h14v10H9l-4 4z M9 10h.01M12 10h.01M15 10h.01",
  redirecciones: "M5 12h11m-4-4 4 4-4 4M19 5v14",
  ajustes: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  usuarios: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0",
  auditoria: "M9 5h10M9 12h10M9 19h10M5 5h.01M5 12h.01M5 19h.01",
};
function Icono({ nombre, className = "size-[18px]" }: { nombre: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={ICONOS[nombre] ?? ""} />
    </svg>
  );
}

interface Item { href: string; texto: string; rol: Rol; icono: string }
const GRUPOS: Array<{ titulo: string | null; items: Item[] }> = [
  { titulo: null, items: [{ href: "/", texto: "Panel", rol: "lectura", icono: "panel" }] },
  { titulo: "Ventas", items: [
    { href: "/pedidos", texto: "Pedidos", rol: "lectura", icono: "pedidos" },
    { href: "/transferencias", texto: "Transferencias", rol: "lectura", icono: "transferencias" },
    { href: "/envios", texto: "Envíos", rol: "lectura", icono: "envios" },
    { href: "/clientes", texto: "Clientes", rol: "lectura", icono: "clientes" },
  ] },
  { titulo: "Catálogo", items: [
    { href: "/productos", texto: "Productos", rol: "lectura", icono: "productos" },
    { href: "/categorias", texto: "Categorías", rol: "lectura", icono: "categorias" },
    { href: "/guias-talles", texto: "Guías de talles", rol: "lectura", icono: "talles" },
    { href: "/portada", texto: "Portada", rol: "lectura", icono: "portada" },
    { href: "/resenas", texto: "Reseñas", rol: "lectura", icono: "resenas" },
  ] },
  { titulo: "Promociones", items: [
    { href: "/descuentos", texto: "Descuentos", rol: "lectura", icono: "descuentos" },
    { href: "/cupones", texto: "Cupones", rol: "lectura", icono: "cupones" },
  ] },
  { titulo: "Tienda", items: [
    { href: "/asistente", texto: "Asistente", rol: "lectura", icono: "asistente" },
    { href: "/redirecciones", texto: "Redirecciones", rol: "lectura", icono: "redirecciones" },
  ] },
  { titulo: "Administración", items: [
    { href: "/ajustes", texto: "Ajustes", rol: "dueno", icono: "ajustes" },
    { href: "/usuarios", texto: "Usuarios", rol: "dueno", icono: "usuarios" },
    { href: "/auditoria", texto: "Auditoría", rol: "dueno", icono: "auditoria" },
  ] },
];
const ROLES: Record<Rol, string> = { dueno: "Dueño", operador: "Operador", lectura: "Sólo lectura" };
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

export function Marco({ children }: { children: React.ReactNode }) {
  const [yo, setYo] = useState<Yo | null>(null);
  const [menu, setMenu] = useState(false);
  const ruta = usePathname();
  useEffect(() => {
    api<Yo | undefined>("yo").then((y) => {
      if (!y) window.location.href = `/ingresar?volver=${encodeURIComponent(location.pathname)}`;
      else if (y.debeCambiarClave) window.location.href = "/cambiar-clave";
      else setYo(y);
    }).catch(() => { /* api() ya lleva al ingreso */ });
  }, []);
  useEffect(() => setMenu(false), [ruta]);
  useEffect(() => {
    if (!menu) return;
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [menu]);
  if (!yo) return <p className="p-10 text-center text-tinta-tenue" role="status">Cargando…</p>;

  const activo = (href: string) => (href === "/" ? ruta === "/" : ruta.startsWith(href));
  const grupos = GRUPOS.map((g) => ({ ...g, items: g.items.filter((m) => puede(yo, m.rol)) })).filter((g) => g.items.length);
  return (
    <Contexto.Provider value={yo}>
      <header className="sticky top-0 z-30 flex items-center justify-between bg-tinta px-4 py-3 text-white lg:hidden">
        <Link href="/" className="flex items-baseline gap-2"><span className="font-display text-xl">Isuwaya</span><span className="text-xs text-white/60">Backoffice</span></Link>
        <button type="button" className="rounded-full border border-white/25 px-3.5 py-1.5 text-sm font-bold" aria-expanded={menu} aria-controls="menu-backoffice" onClick={() => setMenu(!menu)}>Menú</button>
      </header>
      {menu && <button type="button" aria-label="Cerrar menú" className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMenu(false)} />}
      <div className="min-h-screen lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
        <aside id="menu-backoffice"
          className={`${menu ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-40 w-72 bg-tinta text-white transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-auto lg:translate-x-0`}>
          <div className="flex h-full flex-col">
            <Link href="/" className="flex items-baseline gap-2 px-6 pb-5 pt-6">
              <span className="font-display text-2xl">Isuwaya</span><span className="text-xs font-bold uppercase tracking-widest text-white/50">Backoffice</span>
            </Link>
            <nav aria-label="Secciones" className="flex-1 overflow-y-auto px-3 pb-4">
              {grupos.map((g) => (
                <div key={g.titulo ?? "inicio"} className="mb-4">
                  {g.titulo && <p className="mb-1 px-3 text-[11px] font-bold uppercase tracking-widest text-white/40">{g.titulo}</p>}
                  <ul className="space-y-0.5">
                    {g.items.map((m) => (
                      <li key={m.href}>
                        <Link href={m.href} aria-current={activo(m.href) ? "page" : undefined}
                          className={`relative flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] transition ${activo(m.href) ? "bg-white/12 font-bold text-white before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-marca-claro" : "text-white/70 hover:bg-white/6 hover:text-white"}`}>
                          <Icono nombre={m.icono} />{m.texto}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
            <div className="border-t border-white/10 p-4">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-marca font-bold">{iniciales(yo.nombre)}</span>
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-bold">{yo.nombre}</span>
                  <span className="block text-white/55">{ROLES[yo.rol]}</span>
                </span>
              </div>
              <div className="mt-3 flex gap-2 text-sm">
                <Link href="/cambiar-clave" className="flex-1 rounded-lg border border-white/15 px-3 py-1.5 text-center text-white/80 hover:bg-white/10">Contraseña</Link>
                <button type="button" className="flex-1 rounded-lg border border-white/15 px-3 py-1.5 text-white/80 hover:bg-white/10" onClick={async () => { await api("salir", { metodo: "POST" }).catch(() => {}); window.location.href = "/ingresar"; }}>Salir</button>
              </div>
            </div>
          </div>
        </aside>
        <div className="min-w-0">
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-8 lg:py-10">{children}</main>
        </div>
      </div>
    </Contexto.Provider>
  );
}
