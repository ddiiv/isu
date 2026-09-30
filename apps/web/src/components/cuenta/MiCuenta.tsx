"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatearPesos, type ClientePublico } from "@isu/shared";
import { api, type ErrorApi } from "@/lib/cliente-api";

interface Cuenta { cliente: ClientePublico; pedidos: Array<{ numero: string; estado: string; total: number; creadoEn: string; articulos: number }> }
const ESTADOS: Record<string, string> = {
  esperando_pago: "Falta el pago", esperando_transferencia: "Esperando transferencia", transferencia_informada: "Verificando pago",
  a_pagar_en_local: "Pagás al retirar", pagado: "Pagado", pagado_tarde: "Pagado (a revisar)", vencido: "Vencido", cancelado: "Cancelado",
  sin_stock: "Sin stock", sin_confirmar: "Sin confirmar", enviado: "En camino", entregado: "Entregado", listo_para_retirar: "Listo para retirar", retirado: "Retirado",
};
const campo = "w-full rounded-xl border border-linea bg-white px-4 py-3 text-base outline-none focus:border-tinta";

function Campo(props: React.InputHTMLAttributes<HTMLInputElement> & { etiqueta: string }) {
  const { etiqueta, ...resto } = props;
  return <label className="block"><span className="mb-1 block text-sm font-bold">{etiqueta}</span><input className={campo} {...resto} /></label>;
}

export function MiCuenta() {
  const [cuenta, setCuenta] = useState<Cuenta | null | undefined>(undefined);
  const cargar = useCallback(() => api<Cuenta | undefined>("cuenta").then((c) => setCuenta(c ?? null)).catch(() => setCuenta(null)), []);
  useEffect(() => { void cargar(); }, [cargar]);
  if (cuenta === undefined) return <div className="contenedor py-24 text-center text-tinta-tenue" aria-busy="true">Cargando…</div>;
  return cuenta ? <Panel cuenta={cuenta} alSalir={() => setCuenta(null)} alCambiar={cargar} /> : <Ingreso alEntrar={cargar} />;
}

function Ingreso({ alEntrar }: { alEntrar: () => void }) {
  const [modo, setModo] = useState<"ingresar" | "registro" | "olvide">("ingresar");
  const [f, setF] = useState({ email: "", contrasena: "", nombre: "", apellido: "", aceptaNovedades: false });
  const [msg, setMsg] = useState<{ tipo: "error" | "ok"; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null); setEnviando(true);
    try {
      if (modo === "olvide") {
        const r = await api<{ mensaje: string }>("cuenta/olvide", { cuerpo: { email: f.email } });
        setMsg({ tipo: "ok", texto: r.mensaje });
      } else if (modo === "registro") {
        await api("cuenta/registro", { cuerpo: { email: f.email, contrasena: f.contrasena, nombre: f.nombre, apellido: f.apellido, aceptaNovedades: f.aceptaNovedades } });
        alEntrar();
      } else {
        await api("cuenta/ingresar", { cuerpo: { email: f.email, contrasena: f.contrasena } });
        alEntrar();
      }
    } catch (err) {
      const x = err as ErrorApi;
      setMsg({ tipo: x.codigo === "confirmar_email" ? "ok" : "error", texto: x.status === 400 && x.codigo === "validacion" ? "Revisá los datos: la contraseña tiene que tener al menos 8 caracteres." : x.message });
    } finally { setEnviando(false); }
  }

  return (
    <div className="contenedor max-w-md py-12">
      <h1 className="text-center text-[clamp(2.2rem,6vw,3.2rem)] leading-none">{modo === "registro" ? "Creá tu cuenta" : modo === "olvide" ? "Olvidé mi contraseña" : "Ingresá"}</h1>
      {modo !== "olvide" && (
        <div className="mt-6 grid grid-cols-2 rounded-full bg-fondo-suave p-1" role="tablist">
          {(["ingresar", "registro"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={modo === m} onClick={() => { setModo(m); setMsg(null); }}
              className={`rounded-full py-2 text-sm font-bold ${modo === m ? "bg-white shadow-sm" : "text-tinta-tenue"}`}>{m === "ingresar" ? "Ya tengo cuenta" : "Soy nuevo"}</button>
          ))}
        </div>
      )}
      <form onSubmit={enviar} className="mt-6 space-y-4">
        {modo === "registro" && (
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Nombre" value={f.nombre} onChange={cambiar("nombre")} autoComplete="given-name" required minLength={2} />
            <Campo etiqueta="Apellido" value={f.apellido} onChange={cambiar("apellido")} autoComplete="family-name" required minLength={2} />
          </div>
        )}
        <Campo etiqueta="Email" type="email" value={f.email} onChange={cambiar("email")} autoComplete="email" required />
        {modo !== "olvide" && (
          <Campo etiqueta="Contraseña" type="password" value={f.contrasena} onChange={cambiar("contrasena")} required
            minLength={modo === "registro" ? 8 : 1} autoComplete={modo === "registro" ? "new-password" : "current-password"} />
        )}
        {modo === "registro" && (
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={f.aceptaNovedades} onChange={cambiar("aceptaNovedades")} className="mt-0.5 size-4 accent-tinta" />Quiero recibir novedades y promociones por mail.</label>
        )}
        {msg && <p role={msg.tipo === "error" ? "alert" : "status"} className={`rounded-xl p-3 text-sm font-bold ${msg.tipo === "error" ? "bg-oferta/10 text-oferta" : "bg-ahorro-claro text-ahorro"}`}>{msg.texto}</p>}
        <button type="submit" disabled={enviando} className="boton w-full bg-tinta py-4 text-base text-white hover:bg-marca-fuerte disabled:opacity-60">
          {enviando ? "Un momento…" : modo === "registro" ? "Crear cuenta" : modo === "olvide" ? "Mandarme el enlace" : "Ingresar"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm">
        {modo === "olvide"
          ? <button type="button" className="underline" onClick={() => { setModo("ingresar"); setMsg(null); }}>Volver a ingresar</button>
          : <button type="button" className="underline" onClick={() => { setModo("olvide"); setMsg(null); }}>Olvidé mi contraseña</button>}
      </p>
      <p className="mt-6 text-center text-sm text-tinta-tenue">No hace falta cuenta para comprar: la podés crear después y tus pedidos quedan asociados a tu email.</p>
    </div>
  );
}

function Panel({ cuenta, alSalir, alCambiar }: { cuenta: Cuenta; alSalir: () => void; alCambiar: () => void }) {
  const c = cuenta.cliente;
  const [datos, setDatos] = useState({ nombre: c.nombre, apellido: c.apellido ?? "", telefono: c.telefono ?? "", dni: c.dni ?? "" });
  const [claves, setClaves] = useState({ actual: "", nueva: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { await api("cuenta", { metodo: "PATCH", cuerpo: datos }); setMsg("Datos guardados."); alCambiar(); } catch (err) { setMsg((err as Error).message); }
  };
  const cambiarClave = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { await api("cuenta/contrasena", { cuerpo: claves }); setClaves({ actual: "", nueva: "" }); setMsg("Contraseña cambiada. Cerramos tus otras sesiones."); } catch (err) { setMsg((err as Error).message); }
  };
  const salir = async () => { await api("cuenta/salir", { cuerpo: {} }).catch(() => {}); alSalir(); };
  return (
    <div className="contenedor py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[clamp(2.2rem,6vw,3.6rem)] leading-none">Hola, {c.nombre}</h1>
        <button type="button" onClick={salir} className="boton-borde py-2">Cerrar sesión</button>
      </div>
      {msg && <p role="status" className="mt-4 rounded-xl bg-marca-claro p-3 text-sm font-bold">{msg}</p>}
      <div className="mt-8 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <h2 className="text-2xl">Mis pedidos</h2>
          {cuenta.pedidos.length ? (
            <ul className="mt-4 divide-y divide-linea rounded-[var(--radius-foto)] border border-linea">
              {cuenta.pedidos.map((p) => (
                <li key={p.numero}>
                  <Link href={`/pedido/${p.numero}`} className="flex items-center justify-between gap-3 p-4 hover:bg-fondo-suave">
                    <span><b>{p.numero}</b><br /><span className="text-sm text-tinta-tenue">{new Date(p.creadoEn).toLocaleDateString("es-AR")} · {p.articulos} {p.articulos === 1 ? "prenda" : "prendas"}</span></span>
                    <span className="text-right"><b>{formatearPesos(p.total)}</b><br /><span className="text-sm">{ESTADOS[p.estado] ?? p.estado}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 text-tinta-suave">Todavía no hiciste pedidos. <Link href="/" className="underline">Ver la tienda</Link></p>}
        </section>
        <section className="space-y-8">
          <form onSubmit={guardar} className="space-y-3">
            <h2 className="text-2xl">Mis datos</h2>
            <p className="text-sm text-tinta-tenue">{c.email}</p>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Nombre" value={datos.nombre} onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} required />
              <Campo etiqueta="Apellido" value={datos.apellido} onChange={(e) => setDatos({ ...datos, apellido: e.target.value })} required />
              <Campo etiqueta="Celular" type="tel" value={datos.telefono} onChange={(e) => setDatos({ ...datos, telefono: e.target.value })} />
              <Campo etiqueta="DNI" inputMode="numeric" value={datos.dni} onChange={(e) => setDatos({ ...datos, dni: e.target.value })} />
            </div>
            <button type="submit" className="boton-primario">Guardar</button>
          </form>
          <form onSubmit={cambiarClave} className="space-y-3">
            <h2 className="text-2xl">Contraseña</h2>
            <Campo etiqueta="Actual" type="password" autoComplete="current-password" value={claves.actual} onChange={(e) => setClaves({ ...claves, actual: e.target.value })} required />
            <Campo etiqueta="Nueva (8 o más caracteres)" type="password" autoComplete="new-password" minLength={8} value={claves.nueva} onChange={(e) => setClaves({ ...claves, nueva: e.target.value })} required />
            <button type="submit" className="boton-borde">Cambiar contraseña</button>
          </form>
        </section>
      </div>
    </div>
  );
}
