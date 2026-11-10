"use client";
import { REABRIR_COOKIES } from "./AvisoCookies";

/* Link del pie para cambiar la elección de cookies. Sólo existe si hay GA (lo decide el pie). */
export function EnlaceCookies() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(REABRIR_COOKIES))} className="block text-left text-tinta-suave hover:text-marca">
      Cookies
    </button>
  );
}
