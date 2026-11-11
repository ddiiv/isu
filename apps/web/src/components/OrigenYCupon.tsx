"use client";
import { useEffect, useState } from "react";
import { origenAGuardar, origenVigente, type Origen } from "@isu/shared/puro";
import { useCarrito } from "./carrito/Carrito";

/*
 * Dos cosas que llegan por el link y se guardan en el navegador:
 *  - El origen de la compra (UTM, click id, sitio de referencia) en `isu:origen`;
 *    el checkout lo manda con el pedido. No se guarda nada personal.
 *  - `?cupon=CODIGO`: va al carrito, que lo valida y avisa. El del link pisa al
 *    que había guardado (es lo último que la persona eligió).
 */
const CLAVE = "isu:origen";
const CODIGO = /^[A-Za-z0-9_-]{3,40}$/;

/** El origen vigente para mandar con el pedido (undefined si no hay o venció). */
export function leerOrigen(): Origen | undefined {
  try { return origenVigente(JSON.parse(localStorage.getItem(CLAVE) ?? "null"), Date.now()) ?? undefined; } catch { return undefined; }
}

export function OrigenYCupon() {
  const { ponerCupon } = useCarrito();
  const [guardado, setGuardado] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    try {
      const nuevo = origenAGuardar(JSON.parse(localStorage.getItem(CLAVE) ?? "null"), url.searchParams, document.referrer, url.hostname, Date.now());
      if (nuevo) localStorage.setItem(CLAVE, JSON.stringify(nuevo));
    } catch { /* modo privado o dato roto: sin origen */ }

    const cupon = url.searchParams.get("cupon");
    if (cupon === null) return;
    // El carrito lee lo guardado en su propio efecto, que corre después de éste: se pone un instante más tarde para no ser pisado.
    // (Y el parámetro se limpia ahí también: en desarrollo React corre el efecto dos veces.)
    const t = setTimeout(() => {
      url.searchParams.delete("cupon");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      if (!CODIGO.test(cupon)) return;
      ponerCupon(cupon); setGuardado(cupon.toUpperCase());
    }, 0);
    const o = setTimeout(() => setGuardado(null), 8000);
    return () => { clearTimeout(t); clearTimeout(o); };
  // Sólo en cada carga de la página.
  }, []);

  return guardado ? (
    <p role="status" className="fixed inset-x-4 bottom-24 z-40 mx-auto max-w-sm rounded-2xl bg-tinta px-4 py-3 text-center text-sm text-white shadow-lg">
      Te guardamos el cupón <b>{guardado}</b>: se aplica en tu carrito.
    </p>
  ) : null;
}
