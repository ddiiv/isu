import { ErrorTransporte, pedir } from "./http.js";

/*
 * WhatsApp Cloud API (Meta): el mismo proveedor y las mismas variables que
 * usa Stocker (WHATSAPP_META_TOKEN, WHATSAPP_META_PHONE_NUMBER_ID), así se
 * manda desde el número del negocio.
 *
 * Los avisos del envío salen SIEMPRE como plantilla aprobada por Meta: un
 * mensaje libre sólo se puede mandar dentro de las 24 h de que el cliente
 * escribió, y un aviso de "tu pedido está en camino" no cumple eso.
 */
export interface ConfigWhatsapp { url: string; version: string; token: string; telefonoId: string; idioma: string }

/*
 * Teléfono argentino → formato de WhatsApp (549 + característica + número,
 * sin el 0 ni el 15). Acepta cómo lo escribe la gente: "11 5555-1234",
 * "011 15 5555 1234", "+54 9 11 5555 1234", "0351 15 555-1234".
 * null si no parece un celular argentino.
 */
export function telefonoWhatsapp(crudo: string): string | null {
  let d = crudo.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9") && d.length === 11) return `54${d}`;
  d = d.replace(/^0+/, "");
  if (d.length === 12) {
    // Característica de 2 a 4 dígitos seguida de "15".
    for (const largo of [2, 3, 4]) {
      if (d.slice(largo, largo + 2) === "15") { d = d.slice(0, largo) + d.slice(largo + 2); break; }
    }
  }
  // Las características argentinas empiezan con 1, 2 o 3 (0800, 0810, 0600 no son celulares).
  if (d.length !== 10 || !/^[123]/.test(d)) return null;
  return `549${d}`;
}

export interface Whatsapp {
  plantilla(telefono: string, nombre: string, parametros: string[]): Promise<{ id: string | null }>;
}

export function whatsapp(c: ConfigWhatsapp): Whatsapp {
  const url = `${c.url.replace(/\/+$/, "")}/${c.version}/${encodeURIComponent(c.telefonoId)}/messages`;
  return {
    async plantilla(telefono, nombre, parametros) {
      const to = telefonoWhatsapp(telefono);
      if (!to) throw new ErrorTransporte("whatsapp", "el teléfono no es un celular argentino", null, false);
      if (!/^[a-z0-9_]{1,512}$/.test(nombre)) throw new ErrorTransporte("whatsapp", "nombre de plantilla inválido", null, false);
      const r = await pedir<{ messages?: Array<{ id?: string }> }>("whatsapp", url, {
        method: "POST", headers: { authorization: `Bearer ${c.token}` },
        cuerpo: {
          messaging_product: "whatsapp", to, type: "template",
          template: {
            name: nombre, language: { code: c.idioma },
            components: parametros.length ? [{ type: "body", parameters: parametros.map((p) => ({ type: "text", text: p.slice(0, 200) })) }] : [],
          },
        },
      });
      return { id: r.messages?.[0]?.id ?? null };
    },
  };
}
