"use client";
import { useEffect, useState } from "react";

/* Piezas chicas que usan todas las pantallas del backoffice. */
export function Titulo({ children, acciones }: { children: React.ReactNode; acciones?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-[2rem] leading-none sm:text-[2.6rem]">{children}</h1>
      {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
    </div>
  );
}

type Variante = "primario" | "borde" | "peligro" | "texto";
const VARIANTES: Record<Variante, string> = {
  primario: "bg-tinta text-white shadow-sm hover:bg-marca-fuerte",
  borde: "border border-linea bg-white shadow-sm hover:border-tinta",
  peligro: "border border-oferta/40 bg-white text-oferta shadow-sm hover:bg-red-50",
  texto: "text-marca underline-offset-2 hover:underline",
};
export function Boton({ variante = "primario", className = "", ...r }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return <button type="button" {...r} className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTES[variante]} ${className}`} />;
}

export function Campo({ etiqueta, ayuda, error, children, className = "" }: { etiqueta: string; ayuda?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="font-bold">{etiqueta}</span>
      <span className="mt-1 block">{children}</span>
      {ayuda && <span className="mt-1 block text-xs text-tinta-tenue">{ayuda}</span>}
      {error && <span className="mt-1 block text-xs font-bold text-oferta">{error}</span>}
    </label>
  );
}
export const claseEntrada = "w-full rounded-xl border border-linea bg-white px-3 py-2.5 text-[15px] shadow-sm transition focus:border-marca focus:outline-none focus:ring-4 focus:ring-marca/10 disabled:bg-fondo-suave";

export function Casilla({ etiqueta, marcada, onChange, disabled, ayuda }: { etiqueta: React.ReactNode; marcada: boolean; onChange: (v: boolean) => void; disabled?: boolean; ayuda?: string }) {
  return (
    <label className={`flex items-start gap-2.5 text-[15px] ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" className="mt-1 size-4 accent-[var(--color-marca)]" checked={marcada} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="font-bold">{etiqueta}</span>{ayuda && <span className="block text-xs text-tinta-tenue">{ayuda}</span>}</span>
    </label>
  );
}

export function Insignia({ children, clase = "bg-fondo-suave text-tinta-suave" }: { children: React.ReactNode; clase?: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${clase}`}>{children}</span>;
}

export function Tarjeta({ titulo, children, className = "", acciones }: { titulo?: React.ReactNode; children: React.ReactNode; className?: string; acciones?: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-linea/80 bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,0.05)] sm:p-6 ${className}`}>
      {(titulo || acciones) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-linea/70 pb-3">
          {titulo && <h2 className="text-xl font-bold font-sans">{titulo}</h2>}
          {acciones}
        </div>
      )}
      {children}
    </section>
  );
}

export function Mensaje({ tipo = "error", children }: { tipo?: "error" | "ok" | "info"; children: React.ReactNode }) {
  if (!children) return null;
  const c = { error: "bg-red-50 text-oferta", ok: "bg-ahorro-claro text-ahorro", info: "bg-marca-claro text-marca-fuerte" }[tipo];
  return <p role={tipo === "error" ? "alert" : "status"} className={`rounded-xl px-4 py-2.5 text-sm font-bold ${c}`}>{children}</p>;
}

/** Un aviso que se va solo a los pocos segundos ("Guardado"). */
export function useAviso() {
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  useEffect(() => {
    if (!aviso || aviso.tipo === "error") return;
    const t = setTimeout(() => setAviso(null), 3500);
    return () => clearTimeout(t);
  }, [aviso]);
  return {
    aviso,
    ok: (texto: string) => setAviso({ tipo: "ok", texto }),
    error: (e: unknown) => setAviso({ tipo: "error", texto: e instanceof Error ? e.message : String(e) }),
    limpiar: () => setAviso(null),
    Aviso: () => (aviso ? <Mensaje tipo={aviso.tipo}>{aviso.texto}</Mensaje> : null),
  };
}

export function Paginador({ pagina, total, porPagina, onCambiar }: { pagina: number; total: number; porPagina: number; onCambiar: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return <p className="mt-4 text-sm text-tinta-tenue">{total} {total === 1 ? "resultado" : "resultados"}</p>;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span className="text-tinta-tenue">{total} resultados · página {pagina} de {paginas}</span>
      <div className="flex gap-2">
        <Boton variante="borde" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>Anterior</Boton>
        <Boton variante="borde" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)}>Siguiente</Boton>
      </div>
    </div>
  );
}

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return <p className="py-10 text-center text-tinta-tenue" role="status">{texto}</p>;
}

/** Entrada de dinero en pesos que guarda centavos. */
export function EntradaPesos({ valor, onChange, id }: { valor: number | null; onChange: (c: number | null) => void; id?: string }) {
  return (
    <span className="relative block">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tinta-tenue">$</span>
      <input id={id} inputMode="numeric" className={`${claseEntrada} pl-7`} value={valor === null ? "" : (valor / 100).toLocaleString("es-AR")}
        onChange={(e) => { const d = e.target.value.replace(/\D/g, "").slice(0, 10); onChange(d ? Number(d) * 100 : null); }} />
    </span>
  );
}
