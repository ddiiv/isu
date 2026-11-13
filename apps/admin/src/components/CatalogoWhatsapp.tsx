"use client";
import { useState } from "react";
import { api, fecha, useDatos } from "@/lib/api";
import { Boton } from "./ui";

/* Productos: pedirle a Meta que traiga ya el catálogo de WhatsApp (sin esperar la carga programada). */
export function CatalogoWhatsapp({ aviso }: { aviso: { ok: (t: string) => void; error: (e: unknown) => void } }) {
  const { datos } = useDatos<{ configurado: boolean; ultima: { inicio: string | null; fin: string | null } | null }>("catalogo-whatsapp");
  const [pidiendo, setPidiendo] = useState(false);
  if (!datos?.configurado) return null;
  async function actualizar() {
    setPidiendo(true);
    try {
      await api("catalogo-whatsapp/actualizar", { metodo: "POST" });
      aviso.ok("Le pedimos a Meta que traiga el catálogo. Tarda unos minutos en verse en WhatsApp.");
    } catch (e) { aviso.error(e); } finally { setPidiendo(false); }
  }
  const u = datos.ultima;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Boton variante="borde" disabled={pidiendo} onClick={actualizar}>{pidiendo ? "Pidiendo…" : "Actualizar catálogo de WhatsApp"}</Boton>
      {u?.inicio && <span className="text-xs text-tinta-tenue">Última carga de Meta: {fecha(u.inicio)}{u.fin ? "" : " (cargando)"}</span>}
    </span>
  );
}
