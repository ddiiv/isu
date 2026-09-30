"use client";
import { useState } from "react";
import { api, fecha, useDatos } from "@/lib/api";
import { Boton, Campo, Cargando, claseEntrada, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { useYo, type Rol } from "@/components/Marco";

interface Usuario { id: number; email: string; nombre: string; rol: Rol; activo: boolean; dobleFactor: boolean; claveProvisoria: boolean; ultimoIngreso: string | null; bloqueado: boolean }
const ROLES: Array<[Rol, string, string]> = [
  ["dueno", "Dueño", "Todo, incluidos ajustes, datos bancarios y usuarios."],
  ["operador", "Operador", "Pedidos, pagos, productos, fotos, categorías, descuentos, guías y clientes."],
  ["lectura", "Sólo lectura", "Mirar, sin cambiar nada."],
];

/* Usuarios del backoffice. La contraseña provisoria se muestra UNA vez: pasásela por un canal seguro. */
export default function Usuarios() {
  const yo = useYo();
  const { datos, error, recargar } = useDatos<{ usuarios: Usuario[] }>("usuarios");
  const [nuevo, setNuevo] = useState<{ email: string; nombre: string; rol: Rol } | null>(null);
  const [clave, setClave] = useState<{ email: string; clave: string } | null>(null);
  const aviso = useAviso();
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;
  const accion = (fn: () => Promise<unknown>) => fn().then(recargar, aviso.error);

  return (
    <>
      <Titulo acciones={<Boton onClick={() => setNuevo({ email: "", nombre: "", rol: "operador" })}>Nuevo usuario</Boton>}>Usuarios</Titulo>
      <div className="mb-4 space-y-2">
        <aviso.Aviso />
        {clave && (
          <div className="rounded-2xl border-2 border-marca bg-marca-claro p-4 text-sm">
            <p className="font-bold">Contraseña provisoria de {clave.email}</p>
            <p className="mt-1"><code className="rounded bg-white px-2 py-1 text-lg font-bold tracking-wider">{clave.clave}</code></p>
            <p className="mt-2 text-tinta-suave">No se vuelve a mostrar. Al entrar va a configurar el doble factor y elegir su contraseña.</p>
            <Boton variante="texto" className="mt-1 px-0" onClick={() => setClave(null)}>Ya la copié</Boton>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="overflow-x-auto rounded-2xl border border-linea bg-white">
          <table className="tabla-apilada w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-linea text-tinta-tenue"><tr><th className="px-4 py-3">Usuario</th><th className="px-4 py-3">Rol</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Último ingreso</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-linea">
              {datos.usuarios.map((u) => {
                const soyYo = u.email === yo.email;
                return (
                  <tr key={u.id} className={u.activo ? "" : "text-tinta-tenue"}>
                    <td className="px-4 py-3"><span className="font-bold">{u.nombre}</span>{soyYo && " (vos)"}<br /><span className="text-xs">{u.email}</span></td>
                    <td className="px-4 py-3" data-etiqueta="Rol">
                      <select className="rounded-full border border-linea bg-white px-2 py-1" value={u.rol} disabled={soyYo} aria-label={`Rol de ${u.nombre}`} onChange={(e) => void accion(() => api(`usuarios/${u.id}`, { metodo: "PATCH", cuerpo: { rol: e.target.value } }))}>
                        {ROLES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                      </select>
                    </td>
                    <td className="space-x-1 px-4 py-3">
                      {!u.activo ? <Insignia>Desactivado</Insignia> : u.bloqueado ? <Insignia clase="bg-red-50 text-oferta">Bloqueado</Insignia> : u.claveProvisoria || !u.dobleFactor ? <Insignia clase="bg-amber-50 text-amber-800">Sin terminar de configurar</Insignia> : <Insignia clase="bg-ahorro-claro text-ahorro">Activo</Insignia>}
                    </td>
                    <td className="px-4 py-3 text-xs" data-etiqueta="Último ingreso">{fecha(u.ultimoIngreso)}</td>
                    <td className="px-4 py-3 text-right">
                      {!soyYo && <span className="flex justify-end gap-3">
                        <Boton variante="texto" onClick={() => confirm(`¿Restablecer a ${u.nombre}? Se le genera una contraseña provisoria nueva y tiene que volver a configurar el doble factor.`) && void api<{ claveProvisoria: string }>(`usuarios/${u.id}/restablecer`, { metodo: "POST" }).then((r) => { setClave({ email: u.email, clave: r.claveProvisoria }); return recargar(); }, aviso.error)}>Restablecer</Boton>
                        <Boton variante="texto" className={u.activo ? "text-oferta" : ""} onClick={() => void accion(() => api(`usuarios/${u.id}`, { metodo: "PATCH", cuerpo: { activo: !u.activo } }))}>{u.activo ? "Desactivar" : "Activar"}</Boton>
                      </span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="space-y-6">
          {nuevo && (
            <Tarjeta titulo="Nuevo usuario">
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void api<{ claveProvisoria: string }>("usuarios", { cuerpo: nuevo }).then((r) => { setClave({ email: nuevo.email, clave: r.claveProvisoria }); setNuevo(null); return recargar(); }, aviso.error); }}>
                <Campo etiqueta="Nombre"><input required minLength={2} maxLength={100} className={claseEntrada} value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></Campo>
                <Campo etiqueta="Email"><input type="email" required className={claseEntrada} value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} /></Campo>
                <Campo etiqueta="Rol">
                  <select className={claseEntrada} value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value as Rol })}>{ROLES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
                </Campo>
                <div className="flex gap-2"><Boton type="submit">Crear</Boton><Boton variante="borde" onClick={() => setNuevo(null)}>Cancelar</Boton></div>
              </form>
            </Tarjeta>
          )}
          <Tarjeta titulo="Roles">
            <dl className="space-y-2 text-sm">{ROLES.map(([k, t, d]) => <div key={k}><dt className="font-bold">{t}</dt><dd className="text-tinta-suave">{d}</dd></div>)}</dl>
          </Tarjeta>
        </div>
      </div>
    </>
  );
}
