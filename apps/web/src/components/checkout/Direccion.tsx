"use client";
import { useEffect, useId, useRef, useState } from "react";
import { provinciasDelCP, sinTildes, type LugarDireccion, type RevisionDireccion, type SugerenciaDireccion } from "@isu/shared";
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
 * CampoLocalidad: mientras se escribe, localidades de la provincia elegida
 * (Georef, por la API de la tienda), con el mismo teclado que la calle. Si lo
 * escrito no coincide con ninguna pero hay parecidas ("Ramos Megia"), las
 * ofrece como "¿Quisiste decir…?". El código postal no se deduce de la
 * localidad: no hay fuente oficial gratis, sólo lo completa Google.
 *
 * AvisoCP: si el código postal no es de la provincia elegida, lo dice y deja
 * cambiarla con un toque; si no existe, pide revisarlo. No frena nada.
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

export function CampoLocalidad({ valor, alCambiar, provincia, activo, error, clase }: {
  valor: string; alCambiar: (v: string) => void; provincia: string; activo: boolean; error?: string; clase: string;
}) {
  const id = useId();
  const [nombres, setNombres] = useState<string[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(-1);
  // Sólo se pide mientras la persona escribe (no cuando Google o "Sí, usar esta" completan el campo).
  const escribiendo = useRef(false);
  const campo = useRef<HTMLInputElement>(null);
  const enfocado = () => typeof document !== "undefined" && document.activeElement === campo.current;
  const texto = sinTildes(valor);
  // Ya escribió una de las oficiales: no hay nada que ofrecer. Si ninguna la contiene, es un error de tipeo.
  const exacta = nombres.some((n) => sinTildes(n) === texto);
  const aproximadas = !nombres.some((n) => sinTildes(n).includes(texto));
  const lista = abierto && !exacta ? nombres : [];

  useEffect(() => {
    if (!activo || !escribiendo.current) return;
    if (valor.trim().length < 3) { setNombres([]); setAbierto(false); return; }
    let vigente = true;
    const t = setTimeout(() => {
      api<{ localidades: string[] }>("direcciones/localidades", { cuerpo: { texto: valor.trim(), provincia } })
        .then((r) => { if (vigente) { setNombres(r.localidades); setAbierto(r.localidades.length > 0 && enfocado()); setActiva(-1); } })
        .catch(() => { if (vigente) { setNombres([]); setAbierto(false); } });
    }, 350);
    return () => { vigente = false; clearTimeout(t); };
  }, [valor, provincia, activo]);

  function elegir(n: string) {
    setAbierto(false);
    escribiendo.current = false;
    alCambiar(n);
  }

  const teclas = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!lista.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiva((i) => (i + 1) % lista.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiva((i) => (i <= 0 ? lista.length - 1 : i - 1)); }
    else if (e.key === "Enter" && activa >= 0) { e.preventDefault(); elegir(lista[activa]!); }
    else if (e.key === "Escape") { e.preventDefault(); setAbierto(false); }
  };

  return (
    <div>
      <label htmlFor={`${id}-loc`} className="mb-1 block text-sm font-bold">Localidad</label>
      <div className="relative">
        <input ref={campo} id={`${id}-loc`} name="localidad" value={valor} autoComplete={activo ? "off" : "address-level2"} aria-invalid={!!error} aria-describedby={error ? "e-localidad" : undefined}
          className={clase} onKeyDown={teclas}
          onChange={(e) => { escribiendo.current = true; alCambiar(e.target.value); }}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onFocus={() => nombres.length && escribiendo.current && setAbierto(true)}
          {...(activo ? {
            role: "combobox", "aria-autocomplete": "list" as const, "aria-expanded": lista.length > 0, "aria-controls": `${id}-lista`,
            "aria-activedescendant": lista.length && activa >= 0 ? `${id}-op-${activa}` : undefined,
          } : {})} />
        {activo && lista.length > 0 && (
          <ul id={`${id}-lista`} role="listbox" aria-label={aproximadas ? "¿Quisiste decir…?" : "Localidades sugeridas"}
            className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-linea bg-white shadow-xl">
            {aproximadas && <li role="presentation" className="border-b border-linea px-3.5 py-1.5 text-xs font-bold text-tinta-suave">¿Quisiste decir…?</li>}
            {lista.map((n, i) => (
              <li key={n} id={`${id}-op-${i}`} role="option" aria-selected={i === activa}
                onMouseDown={(e) => { e.preventDefault(); elegir(n); }} onMouseEnter={() => setActiva(i)}
                className={`cursor-pointer px-3.5 py-2.5 text-sm font-bold ${i === activa ? "bg-marca-claro/60" : ""}`}>{n}</li>
            ))}
          </ul>
        )}
      </div>
      {error && <p id="e-localidad" className="mt-1 text-sm text-oferta">{error}</p>}
    </div>
  );
}

export function AvisoCP({ cp, provincia, alElegir }: { cp: string; provincia: string; alElegir: (p: string) => void }) {
  const c = cp.trim();
  // Sólo con el código completo (4 números o el CPA): mientras se escribe, nada.
  if (!/^([A-Za-z]\d{4}[A-Za-z]{3}|\d{4})$/.test(c)) return null;
  const de = provinciasDelCP(c);
  if (de.includes(provincia)) return null;
  if (!de.length) return <p className="mt-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status">No encontramos ese código postal. Revisalo.</p>;
  return (
    <div className="mt-1 rounded-xl border border-marca/30 bg-marca-claro/40 p-3 text-sm" role="status">
      <p>El código postal <b>{c}</b> es de <b>{de.join(" o ")}</b>.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {de.map((p) => <button key={p} type="button" onClick={() => alElegir(p)} className="rounded-lg bg-tinta px-3 py-1.5 font-bold text-white">Cambiar la provincia a {p}</button>)}
      </div>
    </div>
  );
}
