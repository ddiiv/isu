"use client";
import { useEffect, useMemo, useState } from "react";
import { conDescuento, centavos, descripcionAutomatica, esClaro, formatearPesos, maxPorcentajePack, normalizarTalle, rutaPack, type ConfigPublica, type ProductoDetalle } from "@isu/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResumenEstrellas } from "./Estrellas";
import { BotonGuiaTalles, useRecomendado } from "./GuiaTalles";
import { Foto, SinFoto } from "./Foto";
import { Precio } from "./Precio";
import { IconoBanco, IconoCamion, IconoLocal, IconoWhatsapp } from "./iconos";
import { evento, item } from "@/lib/ga";
import { useCarrito } from "./carrito/Carrito";
import { SITIO } from "@/lib/sitio";
import { BarraEnvioGratis } from "./BarraEnvioGratis";

/*
 * Ficha de producto: galería, color (con la foto de la prenda sola), talle,
 * precio y cómo llega. Todo lo que cambia con la elección del cliente vive
 * acá; el resto de la página es estático.
 *
 * Con stock: "Agregar al carrito" y "Comprar ahora" (agrega y va directo
 * al checkout). Sin stock en el color elegido: "Consultar por WhatsApp", con
 * el producto, el color y el talle ya escritos en el mensaje.
 */
export function FichaProducto({ p, config }: { p: ProductoDetalle; config: ConfigPublica }) {
  const hay = (c: string | null) => p.variantes.some((v) => v.color === c && v.stock > 0);
  // Abre en el color de la foto principal (la primera de exhibición), si hay stock; si no, en el primero que tenga.
  const dePrincipal = p.exhibicion[0]?.color ?? null;
  const primerConStock = (dePrincipal && hay(dePrincipal) ? dePrincipal : null)
    ?? p.colores.find((c) => hay(c.clave))?.clave ?? p.colores[0]?.clave ?? null;
  const [color, setColor] = useState<string | null>(primerConStock);
  const [talle, setTalle] = useState<string | null>(null);
  const carrito = useCarrito();
  const router = useRouter();
  // Si el cliente ya cargó sus medidas (acá o en "Armá tu outfit"), se marca su talle.
  const recomendado = useRecomendado(p.guiaTalles);
  const [avisoTalle, setAvisoTalle] = useState(false);

  // ?color=… desde la tarjeta de la grilla (la página es estática: se lee al hidratar).
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("color");
    if (c && p.colores.some((x) => x.clave === c)) setColor(c);
    evento("view_item", { currency: "ARS", value: p.precio / 100, items: [item(p)] });
  }, [p]);

  const delColor = useMemo(() => p.variantes.filter((v) => v.color === color), [p.variantes, color]);
  const conTalle = delColor.some((v) => v.talle);
  const variante = conTalle ? delColor.find((v) => v.talle === talle) : delColor[0];
  const colorActual = p.colores.find((c) => c.clave === color);

  const fotos = useMemo(() => {
    const delColorElegido = [
      ...p.exhibicion.filter((f) => f.color === color),
      ...(colorActual?.fotos ?? []),
      ...p.exhibicion.filter((f) => f.color === null),
    ];
    if (delColorElegido.length) return delColorElegido;
    // Un color sin ninguna foto: mejor las del producto (la principal primero) que "foto próximamente".
    return [...p.exhibicion, ...(p.colores.find((c) => c.fotos.length)?.fotos ?? [])];
  }, [p.exhibicion, p.colores, colorActual, color]);

  const base = delColor.length ? delColor : p.variantes;
  const precio = variante?.precio ?? Math.min(...base.map((v) => v.precio));
  const precioLista = variante ? variante.precioLista : p.descuento ? Math.min(...base.map((v) => v.precioLista ?? v.precio)) : null;
  const hayDelColor = delColor.some((v) => v.stock > 0);
  const listo = !!variante && variante.stock > 0;

  const mensaje = [
    `Hola Isuwaya! Busco esta prenda que figura sin stock: ${p.nombre}`,
    colorActual && colorActual.nombre !== "Único" ? `Color: ${colorActual.nombre}` : null,
    variante?.talle ? `Talle: ${variante.talle}` : null,
    `${SITIO.url}/producto/${p.slug}`,
  ].filter(Boolean).join("\n");
  const whatsapp = `https://wa.me/${config.whatsapp}?text=${encodeURIComponent(mensaje)}`;
  /** Agrega la prenda elegida; "Comprar ahora" la agrega y va directo al checkout. */
  function agregar(comprarYa: boolean) {
    if (conTalle && !talle) { setAvisoTalle(true); return; }
    if (!listo || !variante) return;
    const foto = colorActual?.fotos[0] ?? p.exhibicion[0] ?? null;
    // Si las que quedan ya están en el carrito (por ejemplo, dentro de un pack), no agrega y lo explica.
    const agregada = carrito.agregar({
      sku: variante.sku, nombre: p.nombre, slug: p.slug,
      color: colorActual && colorActual.nombre !== "Único" ? colorActual.nombre : null,
      talle: variante.talle, precio: variante.precio, foto: foto?.clave ?? null,
    }, 1, { abrir: !comprarYa, stock: variante.stock });
    if (agregada && comprarYa) router.push("/checkout");
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-14">
      {/* Galería: carrusel con scroll en el celular, grilla en la compu. */}
      <section aria-label="Fotos" className="-mx-4 sm:mx-0">
        <ul className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 sm:px-0 lg:grid lg:grid-cols-2 lg:gap-3 lg:overflow-visible">
          {fotos.length ? fotos.map((f, i) => (
            <li key={f.clave} className={`aspect-[4/5] w-[85%] shrink-0 snap-center overflow-hidden rounded-[var(--radius-foto)] bg-fondo-suave sm:w-[60%] lg:w-auto ${i === 0 ? "lg:col-span-2" : ""}`}>
              <Foto foto={f} alt={`${p.nombre}${colorActual ? ` ${colorActual.nombre}` : ""}`} sizes={i === 0 ? "(min-width:1024px) 55vw, 85vw" : "(min-width:1024px) 28vw, 85vw"} prioridad={i === 0} />
            </li>
          )) : (
            <li className="aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-foto)]"><SinFoto alt={p.nombre} tono={colorActual?.hex} /></li>
          )}
        </ul>
      </section>

      <section aria-label="Comprar" className="lg:sticky lg:top-28 lg:self-start">
        {p.liquidacion && (
          <Link href="/liquidacion" className="mb-2 inline-block rounded-full bg-tinta px-3 py-1 text-xs font-bold uppercase tracking-wider text-white hover:bg-marca-fuerte">Liquidación</Link>
        )}
        <h1 className="text-[clamp(1.9rem,4vw,2.8rem)] leading-[1.05]">{p.nombre}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-sm text-tinta-tenue">Art. {p.sku}</p>
          {p.resenas.cantidad > 0 && (
            <a href="#opiniones" className="hover:underline" aria-label={`Ver las ${p.resenas.cantidad} opiniones`}>
              <ResumenEstrellas promedio={p.resenas.promedio} cantidad={p.resenas.cantidad} />
            </a>
          )}
        </div>
        <div className="mt-5"><Precio precio={precio} precioLista={precioLista} rebaja={p.descuento} descuento={config.descuentoTransferencia} cuotas={config.cuotasSinInteres} grande /></div>

        {p.pack && (
          <Link href={rutaPack(p.slug, config.packs.minimo)} className="mt-5 flex items-center justify-between gap-3 rounded-2xl border-2 border-ahorro bg-ahorro-claro p-4 hover:bg-white">
            <span>
              <span className="block font-bold text-ahorro">📦 Llevá más, pagá menos</span>
              <span className="block text-sm">
                Armá un pack de {config.packs.minimo} a {config.packs.maximo} con tus talles y colores: desde {formatearPesos(conDescuento(centavos(precio), maxPorcentajePack(config.packs)))} c/u ({maxPorcentajePack(config.packs)}% OFF).
              </span>
            </span>
            <span className="shrink-0 text-sm font-bold text-ahorro">Armar pack →</span>
          </Link>
        )}

        {p.colores.length > 0 && !(p.colores.length === 1 && p.colores[0]!.nombre === "Único") && (
          <fieldset className="mt-7">
            <legend className="text-sm"><span className="font-bold">Color:</span> {colorActual?.nombre}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {p.colores.map((c) => {
                const hay = p.variantes.some((v) => v.color === c.clave && v.stock > 0);
                const activo = c.clave === color;
                return (
                  <button key={c.clave} type="button" aria-pressed={activo} aria-label={`${c.nombre}${hay ? "" : " (agotado)"}`} title={c.nombre}
                    onClick={() => { setColor(c.clave); setTalle(null); }}
                    className={`relative size-16 overflow-hidden rounded-xl border-2 transition ${activo ? "border-tinta" : "border-transparent hover:border-linea"} ${hay ? "" : "opacity-45"}`}>
                    {c.fotos[0]
                      ? <Foto foto={c.fotos[0]} alt="" sizes="64px" />
                      : <span className={`block size-full ${c.hex && esClaro(c.hex) ? "border border-linea" : ""}`} style={{ background: c.hex ?? "#ccc" }} />}
                    {!hay && <span aria-hidden="true" className="absolute inset-0 grid place-items-center"><span className="h-0.5 w-[130%] rotate-45 bg-tinta/60" /></span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {conTalle && (
          <div className="relative mt-6">
          {/* El botón queda fuera del <fieldset> (que es sólo de los talles), a la altura del título. */}
          {p.guiaTalles && (
            <div className="absolute right-0 top-0 z-10">
              <BotonGuiaTalles guia={p.guiaTalles} disponibles={delColor.filter((v) => v.stock > 0 && v.talle).map((v) => v.talle!)}
                coloresCon={(t) => p.colores.filter((c) => c.clave !== color && p.variantes.some((v) => v.color === c.clave && v.stock > 0 && !!v.talle && normalizarTalle(v.talle) === t)).map((c) => c.nombre)}
                onElegir={(t) => { setTalle(t); setAvisoTalle(false); }} />
            </div>
          )}
          <fieldset>
            <legend className="text-sm font-bold">Talle{talle ? `: ${talle}` : ""}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {delColor.map((v) => {
                const suyo = !!recomendado && !!v.talle && normalizarTalle(v.talle) === recomendado;
                return (
                  <button key={v.sku} type="button" disabled={v.stock === 0} aria-pressed={v.talle === talle} onClick={() => { setTalle(v.talle); setAvisoTalle(false); }}
                    aria-label={suyo ? `${v.talle} (tu talle recomendado)` : undefined}
                    className={`relative min-w-14 rounded-full border px-4 py-2.5 text-[15px] font-bold transition disabled:cursor-not-allowed disabled:border-linea disabled:text-tinta-tenue disabled:line-through ${v.talle === talle ? "border-tinta bg-tinta text-white" : suyo ? "border-marca text-marca hover:border-tinta" : "border-linea hover:border-tinta"}`}>
                    {v.talle}
                    {suyo && <span aria-hidden="true" className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-white bg-marca" />}
                  </button>
                );
              })}
            </div>
            {recomendado && <p className="mt-2 text-xs text-tinta-suave">Con tus medidas te recomendamos talle <span className="font-bold text-marca">{recomendado}</span>.</p>}
          </fieldset>
          </div>
        )}

        <p className="mt-4 min-h-6 text-sm font-bold" aria-live="polite">
          {!hayDelColor ? <span className="text-oferta">Sin stock en este color</span>
            : variante && variante.stock > 0 && variante.stock <= config.avisoUltimas ? <span className="text-oferta">¡{variante.stock === 1 ? "Última unidad" : `Últimas ${variante.stock} unidades`}!</span>
            : conTalle && !talle ? <span className="font-normal text-tinta-tenue">Elegí tu talle</span>
            : null}
        </p>

        {/* Con stock: agregar o comprar ya. Sin stock en este color: consultar por WhatsApp. */}
        <div className="mt-3 space-y-2">
          {hayDelColor ? (
            <>
              <button type="button" onClick={() => agregar(false)} className="boton w-full bg-tinta py-4 text-base text-white hover:bg-marca-fuerte">
                Agregar al carrito
              </button>
              <button type="button" onClick={() => agregar(true)} className="boton w-full border-2 border-tinta py-3.5 text-base hover:bg-tinta hover:text-white">
                Comprar ahora
              </button>
              {avisoTalle && conTalle && !talle && <p className="text-center text-sm font-bold text-oferta" role="alert">Elegí un talle para agregarlo.</p>}
            </>
          ) : (
            <>
              <button type="button" disabled className="boton w-full cursor-not-allowed bg-linea py-4 text-base text-tinta-tenue">Sin stock</button>
              <a href={whatsapp} target="_blank" rel="noopener noreferrer"
                onClick={() => evento("generate_lead", { currency: "ARS", value: precio / 100, items: [item(p, { item_variant: variante?.sku })] })}
                className="boton w-full border border-linea py-3 text-[15px] hover:border-tinta">
                <IconoWhatsapp /> Consultar por WhatsApp
              </a>
            </>
          )}
        </div>
        <BarraEnvioGratis desde={config.envioGratisDesde} className="mt-4" />

        <ul className="mt-7 divide-y divide-linea rounded-[var(--radius-foto)] border border-linea text-sm">
          <li className="flex gap-3 p-4"><IconoCamion className="size-5 shrink-0 text-marca" />
            <p><span className="font-bold">Envíos a todo el país.</span> En CABA y GBA te llega hoy o mañana.
              {config.envioGratisDesde ? <> <span className="font-bold text-ahorro">Gratis</span> desde {formatearPesos(config.envioGratisDesde)}.</> : null}</p></li>
          <li className="flex gap-3 p-4"><IconoLocal className="size-5 shrink-0 text-marca" />
            <p><span className="font-bold">Retirá gratis</span> en {config.locales.length > 1
              ? <Link href="/locales" className="underline underline-offset-2 hover:text-marca">nuestros locales</Link>
              : <>nuestro local{config.locales[0] ? <> ({config.locales[0].mapa
                ? <a href={config.locales[0].mapa} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-marca">{config.locales[0].nombre}</a>
                : config.locales[0].nombre})</> : null}</>}.</p></li>
          <li className="flex gap-3 p-4"><IconoBanco className="size-5 shrink-0 text-ahorro" />
            <p><span className="font-bold text-ahorro">{config.descuentoTransferencia}% OFF</span> pagando con transferencia · {config.cuotasSinInteres} cuotas sin interés con tarjeta.</p></li>
        </ul>

        {/* La descripción siempre se ve: la propia (backoffice) o, si no hay, una armada con lo que se sabe de la prenda. */}
        <div className="mt-8 divide-y divide-linea border-y border-linea">
          <Acordeon titulo="Descripción" abierto>
            <p className="whitespace-pre-line">{p.descripcion?.trim() || descripcionAutomatica(p, "Isuwaya")}</p>
          </Acordeon>
          {(p.composicion || config.cuidados) && (
            <Acordeon titulo={p.composicion ? "Composición y cuidados" : "Cuidados"}>
              {p.composicion && <p><b className="text-tinta">Composición:</b> {p.composicion}</p>}
              {config.cuidados && <p className={p.composicion ? "mt-2" : ""}>{config.cuidados}</p>}
            </Acordeon>
          )}
          <Acordeon titulo="Cambios y devoluciones">
            <p>Tenés <b className="text-tinta">30 días</b> desde que la recibís para cambiarla por otro talle o color. Si llegó con una falla, el cambio no te cuesta nada.</p>
            <p className="mt-2"><Link href="/devoluciones" className="font-bold text-marca underline underline-offset-2">Cómo hacer un cambio</Link> · <Link href="/arrepentimiento" className="font-bold text-marca underline underline-offset-2">Botón de arrepentimiento</Link></p>
          </Acordeon>
        </div>
      </section>
    </div>
  );
}

/* Un desplegable nativo (<details>): funciona sin JavaScript y lo leen bien los lectores de pantalla. */
function Acordeon({ titulo, abierto = false, children }: { titulo: string; abierto?: boolean; children: React.ReactNode }) {
  return (
    <details open={abierto} className="group py-1">
      <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-lg font-bold [&::-webkit-details-marker]:hidden">
        {titulo}
        <span aria-hidden="true" className="text-2xl leading-none text-tinta-tenue transition group-open:rotate-45">+</span>
      </summary>
      <div className="pb-4 leading-relaxed text-tinta-suave">{children}</div>
    </details>
  );
}
