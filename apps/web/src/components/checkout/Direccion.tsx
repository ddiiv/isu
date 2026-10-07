"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { LugarDireccion, RevisionDireccion, SugerenciaDireccion } from "@isu/shared";
import { api } from "@/lib/cliente-api";

/*
 * Ayudas para la dirección del checkout (etapa 11).
 *
 * CampoCalle: mientras se escribe la calle, sugerencias de Google (por la
 * API de la tienda: la clave nunca llega al navegador). Elegir una completa
 * calle, número, código postal, localidad y provincia. Es un "combobox"
 * accesible: flechas, Enter y Escape. Sin sugerencias (apagado, tope del día,
 * Google caído), es un campo común.
 *
 * AvisoDireccion: con la dirección completa, la revisa con Georef y dice si
 * no existe o propone la oficial. Nunca frena la compra.
 */
const nuevaSesion = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "00000000-0000-4000-8000-000000000000");

export function CampoCalle({ valor, alCambiar, alElegir, activo, error, clase }: {
  valor: string; alCambiar: (v: string) => void; alElegir: (l: LugarDireccion) => void; activo: boolean; error?: string; clase: string;
}) {
  const id = useId();
  const [sugerencias, setSugerencias] = useState<SugerenciaDireccion[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(-1);
  const [eligiendo, setEligiendo] = useState(false);
  const sesion = useRef(nuevaSesion());
  // Sólo se pide mientras la persona escribe (no después de elegir una sugerencia).
  const escribiendo = useRef(false);
  const campo = useRef<HTMLInputElement>(null);
  // Si la respuesta llega cuando ya se pasó a otro campo, no se abre la lista encima.
  const enfocado = () => typeof document !== "undefined" && document.activeElement === campo.current;

  useEffect(() => {
    if (!activo || !escribiendo.current) return;
    const texto = valor.trim();
    if (texto.length < 4) { setSugerencias([]); setAbierto(false); return; }
    let vigente = true;
    const t = setTimeout(() => {
      api<{ sugerencias: SugerenciaDireccion[] }>("direcciones/sugerencias", { cuerpo: { texto, sesion: sesion.current } })
        .then((r) => { if (vigente) { setSugerencias(r.sugerencias); setAbierto(r.sugerencias.length > 0 && enfocado()); setActiva(-1); } })
        .catch(() => { if (vigente) { setSugerencias([]); setAbierto(false); } });
    }, 350);
    return () => { vigente = false; clearTimeout(t); };
  }, [valor, activo]);

  async function elegir(s: SugerenciaDireccion) {
    setAbierto(false);
    escribiendo.current = false;
    setEligiendo(true);
    try {
      const l = await api<LugarDireccion>("direcciones/lugar", { cuerpo: { id: s.id, sesion: sesion.current } });
      alElegir(l.calle ? l : { ...l, calle: s.principal });
    } catch {
      // Sin los datos: queda lo que dice la sugerencia y se completa a mano.
      alCambiar(s.principal);
    } finally {
      setEligiendo(false);
      // Una sesión por dirección elegida: la próxima búsqueda es otra.
      sesion.current = nuevaSesion();
    }
  }

  const teclas = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!abierto || !sugerencias.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiva((i) => (i + 1) % sugerencias.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiva((i) => (i <= 0 ? sugerencias.length - 1 : i - 1)); }
    else if (e.key === "Enter" && activa >= 0) { e.preventDefault(); void elegir(sugerencias[activa]!); }
    else if (e.key === "Escape") { e.preventDefault(); setAbierto(false); }
  };

  return (
    // Etiqueta aparte (no envolviendo): si no, el nombre del campo incluiría las sugerencias.
    <div>
      <label htmlFor={`${id}-calle`} className="mb-1 block text-sm font-bold">Calle</label>
      <div className="relative">
        <input ref={campo} id={`${id}-calle`} name="calle" value={valor} autoComplete={activo ? "off" : "address-line1"} aria-invalid={!!error} aria-describedby={error ? "e-calle" : undefined}
          className={clase} onKeyDown={teclas}
          onChange={(e) => { escribiendo.current = true; alCambiar(e.target.value); }}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onFocus={() => sugerencias.length && escribiendo.current && setAbierto(true)}
          {...(activo ? {
            role: "combobox", "aria-autocomplete": "list" as const, "aria-expanded": abierto, "aria-controls": `${id}-lista`,
            "aria-activedescendant": abierto && activa >= 0 ? `${id}-op-${activa}` : undefined,
            placeholder: "Empezá a escribir tu calle y altura",
          } : {})} />
        {eligiendo && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-tinta-tenue" role="status">Completando…</span>}
        {activo && abierto && (
          <ul id={`${id}-lista`} role="listbox" aria-label="Direcciones sugeridas"
            className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-linea bg-white shadow-xl">
            {sugerencias.map((s, i) => (
              <li key={s.id} id={`${id}-op-${i}`} role="option" aria-selected={i === activa}
                onMouseDown={(e) => { e.preventDefault(); void elegir(s); }} onMouseEnter={() => setActiva(i)}
                className={`cursor-pointer px-3.5 py-2.5 text-sm ${i === activa ? "bg-marca-claro/60" : ""}`}>
                <span className="block font-bold">{s.principal}</span>
                {s.secundario && <span className="block text-xs text-tinta-suave">{s.secundario}</span>}
              </li>
            ))}
            {/* Atribución que pide Google cuando sus datos se muestran sin un mapa. */}
            <li role="presentation" aria-hidden="true" className="border-t border-linea px-3.5 py-1.5 text-right text-[11px] text-tinta-tenue">Google Maps</li>
          </ul>
        )}
      </div>
      {error && <p id="e-calle" className="mt-1 text-sm text-oferta">{error}</p>}
    </div>
  );
}

export function AvisoDireccion({ d, activo, alUsar }: {
  d: { calle: string; numero: string; localidad: string; provincia: string }; activo: boolean;
  alUsar: (s: NonNullable<RevisionDireccion["sugerencia"]>) => void;
}) {
  const [r, setR] = useState<RevisionDireccion | null>(null);
  const [descartada, setDescartada] = useState<string | null>(null);
  const clave = `${d.calle.trim()}|${d.numero.trim()}|${d.localidad.trim()}|${d.provincia}`;
  const completa = d.calle.trim().length >= 2 && /\d/.test(d.numero) && !!d.provincia;

  useEffect(() => {
    setR(null);
    if (!activo || !completa) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<RevisionDireccion>("direcciones/revisar", { cuerpo: { calle: d.calle.trim(), numero: d.numero.trim(), localidad: d.localidad.trim(), provincia: d.provincia } })
        .then((x) => { if (vigente) setR(x); }).catch(() => {});
    }, 900);
    return () => { vigente = false; clearTimeout(t); };
    // Dependencias a propósito: se revisa cuando cambia la dirección
  }, [clave, activo]);

  if (!r || r.estado === "sin_servicio" || descartada === clave) return null;
  if (r.estado === "ok") return <p className="text-sm font-bold text-ahorro" role="status">✓ Encontramos tu dirección.</p>;
  if (r.estado === "sugerencia" && r.sugerencia) {
    const s = r.sugerencia;
    return (
      <div className="rounded-xl border border-marca/30 bg-marca-claro/40 p-3 text-sm" role="status">
        <p>¿Tu dirección es <b>{s.texto}</b>?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => alUsar(s)} className="rounded-lg bg-tinta px-3 py-1.5 font-bold text-white">Sí, usar esta</button>
          <button type="button" onClick={() => setDescartada(clave)} className="rounded-lg border border-linea bg-white px-3 py-1.5 font-bold">No, está bien como la escribí</button>
        </div>
      </div>
    );
  }
  return (
    <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status">
      {r.estado === "altura"
        ? <>No encontramos la altura <b>{d.numero}</b> en esa calle. Revisá el número; si está bien, seguí igual.</>
        : <>No encontramos esa calle en <b>{d.provincia}</b>. Revisá cómo está escrita; si está bien, seguí igual.</>}
    </p>
  );
}
