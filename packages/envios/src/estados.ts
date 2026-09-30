import type { EstadoEnvio } from "./tipos.js";

/*
 * Cada transporte describe el estado con su texto ("En distribución",
 * "ENTREGADO", "Visita - Domicilio cerrado", "Disponible para retirar"…).
 * Esto lo lleva a los estados de la tienda. El orden importa: "No entregado"
 * contiene "entregado", y "Devuelto" gana a "en tránsito".
 */
const REGLAS: Array<[RegExp, EstadoEnvio]> = [
  [/\b(anulad|cancelad)/, "cancelado"],
  [/(devuel|devoluci|retorno al remitente|regreso al remitente)/, "devuelto"],
  [/(no entregad|no se pudo entregar|visita|ausente|rechazad|domicilio (cerrado|inexistente|incorrecto)|direcci[oó]n incorrecta|intento fallido)/, "no_entregado"],
  [/\bentregad/, "entregado"],
  [/((disponible|listo) para (retir|ser retirad)|en sucursal de destino|lleg[oó] a (la )?sucursal|esperando retiro|para retirar)/, "en_sucursal"],
  [/(en distribuci[oó]n|en reparto|sali[oó] a (repartir|reparto|distribuci)|en ruta de entrega|out for delivery)/, "en_reparto"],
  // Todavía no lo tiene el transporte ("Pendiente de ingreso", "Preimposición").
  [/(pendiente de ingreso|pre ?imposici|a la espera de (ingreso|retiro)|etiqueta (creada|generada))/, "creado"],
  [/(ingres|admitid|en tr[aá]nsito|en camino|en viaje|despachad|recibid|centro de (distribuci|procesamiento)|retirad[oa] por el transporte|en proceso|clasificad|colectad)/, "en_camino"],
];

export function estadoDeTexto(t: string): EstadoEnvio {
  const n = t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [re, estado] of REGLAS) if (re.test(n) || re.test(t.toLowerCase())) return estado;
  return "creado";
}

/* Mercado Envíos y Cabify tienen estados propios en inglés. */
export function estadoMercadoEnvios(status: string, substatus?: string | null): EstadoEnvio {
  const s = (substatus ?? "").toLowerCase();
  switch (status) {
    case "delivered": return "entregado";
    case "not_delivered": return s.includes("returning") || s.includes("returned") ? "devuelto" : "no_entregado";
    case "cancelled": return "cancelado";
    case "shipped":
      if (s.includes("out_for_delivery")) return "en_reparto";
      if (s.includes("withdrawal")) return "en_sucursal";
      if (s.includes("receiver_absent") || s.includes("bad_address")) return "no_entregado";
      return "en_camino";
    default: return "creado";
  }
}

export function estadoCabify(status: string): EstadoEnvio {
  switch (status) {
    case "delivered": case "completed": return "entregado";
    case "picked_up": case "in_transit": return "en_reparto";
    case "failed": return "no_entregado";
    case "returned": return "devuelto";
    case "cancelled": case "canceled": return "cancelado";
    default: return "creado";
  }
}

/*
 * Para no retroceder: un evento viejo que llega tarde no pisa uno más
 * avanzado. Sucursal, reparto y visita fallida son del mismo nivel: después
 * de una visita fallida puede volver a salir a reparto.
 */
const ORDEN: Record<EstadoEnvio, number> = { creado: 0, en_camino: 1, en_sucursal: 2, en_reparto: 2, no_entregado: 2, entregado: 3, devuelto: 3, cancelado: 3 };
export const avanza = (de: EstadoEnvio, a: EstadoEnvio) => ORDEN[a] > ORDEN[de] || (ORDEN[a] === ORDEN[de] && a !== de && de !== "entregado");
