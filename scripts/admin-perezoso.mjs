import net from "node:net";

/*
 * Backoffice a demanda (lo usa scripts/todo-en-uno.mjs).
 *
 * Next del admin ocupa 150 a 250 MB y casi todo el día nadie lo mira. Este "portero" escucha en el
 * puerto público del admin (el que Railway tiene apuntado) y es un puente de TCP: el admin de verdad
 * se levanta en otro puerto recién con la primera conexión y se apaga cuando pasan `inactividadMs` sin
 * que viaje un solo byte. El primer pedido espera a que el admin conteste (unos segundos) en vez de fallar;
 * después todo pasa tal cual, cabeceras incluidas (x-forwarded-for, cookies), porque no se interpreta HTTP.
 *
 * Se mide por bytes y no por conexiones abiertas: el proxy de Railway puede dejar conexiones ociosas
 * abiertas para siempre, y con eso el admin nunca se apagaría.
 */
export function crearAdminPerezoso({ puertoInterno, arrancar, decir = () => {}, inactividadMs = 15 * 60_000, esperaMaxMs = 30_000, esperaSalidaMs = 10_000, pausaTrasFalloMs = 10_000 }) {
  let hijo = null; // proceso del admin (arrancando o listo)
  let listo = null; // promesa: el admin ya contesta en puertoInterno
  let saliendo = null; // promesa: el admin anterior todavía se está yendo (su puerto sigue ocupado)
  let fallo = 0; // cuándo falló el último arranque: con una variable rota, cada pedido relanzaría Next sin pausa
  let ultimo = Date.now();
  let cerrado = false;
  const sockets = new Set();
  const tocar = () => { ultimo = Date.now(); };

  const duerme = (ms) => new Promise((r) => setTimeout(r, ms));
  const contesta = () => new Promise((r) => {
    const s = net.connect(puertoInterno, "127.0.0.1");
    s.once("connect", () => { s.destroy(); r(true); });
    s.once("error", () => r(false));
  });

  function asegurar() {
    if (listo) return listo;
    const p = (async () => {
      await saliendo;
      if (cerrado) throw new Error("apagando");
      if (Date.now() - fallo < pausaTrasFalloMs) throw new Error("el último arranque falló hace un momento");
      tocar();
      const h = arrancar();
      hijo = h;
      let murio = false;
      h.once("exit", (codigo, senal) => {
        murio = true;
        if (hijo === h) { hijo = null; if (!cerrado) decir(`admin se detuvo (${senal ?? `código ${codigo}`}); se vuelve a levantar con el próximo pedido`); }
        if (listo === p) listo = null;
      });
      const limite = Date.now() + esperaMaxMs;
      while (!(await contesta())) {
        if (murio || Date.now() > limite) {
          fallo = Date.now();
          // Que el próximo arranque espere a que éste suelte el puerto: si no, quedan dos admins.
          if (!murio) parar();
          throw new Error(murio ? "el backoffice se cayó al arrancar" : `el backoffice no contestó en ${esperaMaxMs / 1000} s`);
        }
        await duerme(100);
      }
      fallo = 0;
      tocar();
    })();
    listo = p;
    p.catch(() => { if (listo === p) listo = null; });
    return p;
  }

  function parar() {
    const h = hijo;
    if (!h) return;
    hijo = null;
    listo = null;
    saliendo = new Promise((r) => h.once("exit", () => r()));
    const duro = setTimeout(() => h.kill("SIGKILL"), esperaSalidaMs);
    duro.unref();
    h.once("exit", () => clearTimeout(duro));
    h.kill("SIGTERM");
    for (const s of sockets) s.destroy();
  }

  const servidor = net.createServer((cliente) => {
    tocar();
    sockets.add(cliente);
    cliente.on("close", () => sockets.delete(cliente));
    cliente.on("error", () => cliente.destroy());
    cliente.pause(); // lo que mande mientras el admin arranca queda esperando, no se pierde
    asegurar().then(() => {
      if (cliente.destroyed) return;
      const admin = net.connect(puertoInterno, "127.0.0.1");
      admin.on("error", () => cliente.destroy());
      admin.on("close", () => cliente.destroy());
      cliente.on("close", () => admin.destroy());
      admin.on("data", tocar);
      cliente.on("data", tocar);
      cliente.pipe(admin);
      admin.pipe(cliente);
    }, (e) => {
      decir(`admin: ${e.message}; corto la conexión (el próximo pedido lo intenta de nuevo)`);
      cliente.destroy();
    });
  });

  const reloj = setInterval(() => {
    if (hijo && listo && Date.now() - ultimo > inactividadMs) {
      decir(`admin: ${Math.round(inactividadMs / 60_000)} min sin uso, lo apago (se vuelve a levantar solo con el próximo pedido)`);
      parar();
    }
  }, Math.max(50, Math.min(30_000, inactividadMs / 4)));
  reloj.unref();

  return {
    servidor,
    /** Para el apagado general: ya no se levanta más y se cierra el puerto. */
    cerrar() {
      cerrado = true;
      clearInterval(reloj);
      servidor.close();
      for (const s of sockets) s.destroy();
    },
  };
}
