import type { FastifyRequest } from "fastify";
import { iguales } from "./cripto.js";

/*
 * Quién hace el pedido de verdad.
 *
 * Cuando pide el servidor de la tienda (credencial interna), la IP que
 * importa es la del navegador, que viene en `x-isu-ip`. Esa cabecera sólo se
 * cree si la credencial interna es válida: cualquier otro la puede inventar.
 */
export function esInterno(req: FastifyRequest, token: string | undefined): boolean {
  const h = req.headers["x-isu-interno"];
  return !!token && typeof h === "string" && iguales(h, token);
}

const IP = /^[0-9a-fA-F:.]{3,45}$/;
export function ipDe(req: FastifyRequest, token: string | undefined): string {
  if (esInterno(req, token)) {
    const h = req.headers["x-isu-ip"];
    if (typeof h === "string" && IP.test(h)) return h;
  }
  return req.ip;
}
