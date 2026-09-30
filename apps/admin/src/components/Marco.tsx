"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

/*
 * El marco de todas las pantallas: menú lateral según el rol y quién está
 * adentro. Si no hay sesión, al ingreso. Los permisos de verdad los controla
 * la API en cada pedido: acá sólo se esconde lo que no se puede usar.
 */
export type Rol = "dueno" | "operador" | "lectura";
export interface Yo { email: string; nombre: string; rol: Rol; debeCambiarClave: boolean }
const Contexto = createContext<Yo | null>(null);
export const useYo = () => useContext(Contexto)!;
export const puede = (yo: Yo, rol: Rol) => ({ lectura: 0, operador: 1, dueno: 2 })[yo.rol] >= ({ lectura: 0, operador: 1, dueno: 2 })[rol];

const MENU: Array<{ href: string; texto: string; rol: Rol }> = [
  { href: "/", texto: "Panel", rol: "lectura" },
  { href: "/pedidos", texto: "Pedidos", rol: "lectura" },
  { href: "/envios", texto: "Envíos", rol: "lectura" },
  { href: "/productos", texto: "Productos", rol: "lectura" },
  { href: "/guias-talles", texto: "Guías de talles", rol: "lectura" },
  { href: "/categorias", texto: "Categorías", rol: "lectura" },
  { href: "/descuentos", texto: "Descuentos", rol: "lectura" },
  { href: "/cupones", texto: "Cupones", rol: "lectura" },
  { href: "/clientes", texto: "Clientes", rol: "lectura" },
  { href: "/asistente", texto: "Asistente", rol: "lectura" },
  { href: "/ajustes", texto: "Ajustes", rol: "dueno" },
  { href: "/usuarios", texto: "Usuarios", rol: "dueno" },
  { href: "/auditoria", texto: "Auditoría", rol: "dueno" },
];
const ROLES: Record<Rol, string> = { dueno: "Dueño", operador: "Operador", lectura: "Sólo lectura" };

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
  if (!yo) return <p className="p-10 text-center text-tinta-tenue">Cargando…</p>;

  const activo = (href: string) => (href === "/" ? ruta === "/" : ruta.startsWith(href));
  return (
    <Contexto.Provider value={yo}>
      <header className="flex items-center justify-between border-b border-linea bg-white px-4 py-3 lg:hidden">
        <Link href="/" className="font-display text-xl text-marca">Isuwaya</Link>
        <button type="button" className="rounded-full border border-linea px-3 py-1.5 text-sm font-bold" aria-expanded={menu} onClick={() => setMenu(!menu)}>Menú</button>
      </header>
      <div className="min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className={`${menu ? "block" : "hidden"} border-b border-linea bg-white lg:sticky lg:top-0 lg:block lg:h-screen lg:border-b-0 lg:border-r`}>
          <div className="flex h-full flex-col p-4">
            <Link href="/" className="mb-6 hidden font-display text-2xl text-marca lg:block">Isuwaya</Link>
            <nav aria-label="Secciones" className="flex-1">
              <ul className="space-y-0.5">
                {MENU.filter((m) => puede(yo, m.rol)).map((m) => (
                  <li key={m.href}>
                    <Link href={m.href} aria-current={activo(m.href) ? "page" : undefined}
                      className={`block rounded-xl px-3 py-2 text-[15px] ${activo(m.href) ? "bg-marca-claro font-bold text-marca-fuerte" : "hover:bg-fondo-suave"}`}>{m.texto}</Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="mt-6 border-t border-linea pt-4 text-sm">
              <p className="font-bold">{yo.nombre}</p>
              <p className="text-tinta-tenue">{ROLES[yo.rol]}</p>
              <div className="mt-2 flex gap-3">
                <Link href="/cambiar-clave" className="text-marca hover:underline">Contraseña</Link>
                <button type="button" className="text-marca hover:underline" onClick={async () => { await api("salir", { metodo: "POST" }).catch(() => {}); window.location.href = "/ingresar"; }}>Salir</button>
              </div>
            </div>
          </div>
        </aside>
        <div className="min-w-0">
          <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-10">{children}</main>
        </div>
      </div>
    </Contexto.Provider>
  );
}
