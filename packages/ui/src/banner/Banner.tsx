import Link from "next/link";

/*
 * Un banner del inicio (etapa 12). Lo usan la tienda (el carrusel) y el
 * backoffice (la vista previa de Portada): el mismo dibujo en los dos.
 *
 *   · Sólo foto: la foto entera, con link si tiene.
 *   · Con título: el texto sobre la foto (con un velo para que se lea) o sobre
 *     un fondo de color; etiqueta, hasta 2 botones y, si hay, la tarjeta de un
 *     producto con su foto y su precio.
 *
 * Se acomoda al ancho de su caja (consultas de contenedor), no al de la
 * pantalla: así la vista previa del backoffice puede mostrar cómo queda en un
 * celular aunque se esté en la compu.
 *
 * Los links son sólo de la tienda (la API ya lo exige): se dibujan con
 * next/link. En la vista previa (`vista`) no llevan a ningún lado.
 */
/** Lo que va adentro de un link (sin depender de los tipos de React desde este paquete). */
type Hijos = Parameters<typeof Link>[0]["children"];

export interface FotoBannerVista { clave: string; ancho: number | null; alto: number | null }
export interface BannerVista {
  alt: string; enlace: string | null; foto: FotoBannerVista | null; fotoMovil: FotoBannerVista | null;
  titulo: string | null; texto: string | null; etiqueta: string | null;
  botones: Array<{ texto: string; enlace: string; estilo: "lleno" | "borde" }>;
  fondo: "marca" | "tinta" | "ahorro" | "oferta" | "crema" | "rosa" | "arena"; alineacion: "izquierda" | "centro";
  producto: { slug: string; nombre: string; precio: number; precioLista: number | null; foto: { clave: string; alt: string | null } | null } | null;
}

const FONDO: Record<BannerVista["fondo"], string> = {
  marca: "bg-marca text-white", tinta: "bg-tinta text-white", ahorro: "bg-ahorro text-white", oferta: "bg-oferta text-white",
  crema: "bg-[#f6eee3] text-tinta", rosa: "bg-[#fbe9ec] text-tinta", arena: "bg-[#ebe2d2] text-tinta",
};
const OSCURO: Record<BannerVista["fondo"], boolean> = { marca: true, tinta: true, ahorro: true, oferta: true, crema: false, rosa: false, arena: false };
/** Sólo una ruta de esta tienda (tercera llave: la base y la API ya lo exigen). */
const propio = (e: string | null | undefined) => (e && /^\/(?![/\\])\S*$/.test(e) ? e : null);

export function Banner({ b, srcBanner, srcSetBanner, srcProducto, pesos, vista = false, movil = false, prioridad = false }: {
  b: BannerVista;
  srcBanner: (clave: string) => string;
  srcSetBanner: (clave: string) => string;
  srcProducto: (clave: string) => string;
  pesos: (centavos: number) => string;
  /** vista previa: los links no navegan */
  vista?: boolean;
  /** vista previa de celular: usa la foto vertical */
  movil?: boolean;
  prioridad?: boolean;
}) {
  const ir = (href: string | null, clase: string, hijos: Hijos, etiqueta?: string) => {
    const destino = propio(href);
    if (!destino || vista) return <span className={clase} aria-label={etiqueta}>{hijos}</span>;
    return <Link href={destino} className={clase} aria-label={etiqueta}>{hijos}</Link>;
  };
  const fotoDe = b.foto && (movil && b.fotoMovil ? b.fotoMovil : b.foto);
  const foto = fotoDe && (
    <picture>
      {!movil && b.fotoMovil && <source media="(max-width: 767px)" srcSet={srcSetBanner(b.fotoMovil.clave)} sizes="100vw" />}
      <img src={srcBanner(fotoDe.clave)} srcSet={srcSetBanner(fotoDe.clave)} sizes="100vw" alt={b.titulo ? "" : b.alt}
        width={fotoDe.ancho ?? 2400} height={fotoDe.alto ?? 900}
        loading={prioridad ? "eager" : "lazy"} fetchPriority={prioridad ? "high" : "auto"} decoding="async"
        className={b.titulo ? "absolute inset-0 size-full object-cover" : "block h-auto max-h-[78vh] w-full object-cover"} />
    </picture>
  );

  // Sólo foto: como siempre.
  if (!b.titulo) return b.enlace && !vista ? ir(b.enlace, "block", foto, b.alt) : <>{foto}</>;

  const sobreFoto = !!b.foto;
  const claro = sobreFoto || OSCURO[b.fondo];
  const centro = b.alineacion === "centro" && !b.producto;
  const boton = (estilo: "lleno" | "borde") =>
    `inline-flex min-h-12 items-center justify-center rounded-full px-6 py-3 text-[15px] font-bold transition ${
      estilo === "lleno"
        ? claro ? "bg-white text-tinta hover:bg-white/90" : "bg-tinta text-white hover:bg-tinta/85"
        : claro ? "border-2 border-white text-white hover:bg-white/10" : "border-2 border-tinta text-tinta hover:bg-tinta/5"
    }`;

  return (
    <div className={`@container relative isolate flex h-full min-h-[460px] items-center overflow-hidden ${sobreFoto ? "bg-tinta text-white" : FONDO[b.fondo]}`}>
      {sobreFoto ? (
        <>
          {foto}
          {/* Un velo para que el texto se lea sobre cualquier foto. */}
          {/* En el celular el texto ocupa todo el ancho: velo parejo. En la compu, más oscuro del lado del texto. */}
          <span aria-hidden="true" className={`absolute inset-0 ${centro ? "bg-black/45" : "bg-black/50 @3xl:bg-transparent @3xl:bg-gradient-to-r @3xl:from-black/70 @3xl:via-black/40 @3xl:to-black/5"}`} />
        </>
      ) : (
        <>
          <span aria-hidden="true" className={`absolute -right-24 -top-28 size-[26rem] rounded-full ${claro ? "bg-white/10" : "bg-white/55"}`} />
          <span aria-hidden="true" className={`absolute -bottom-32 left-1/3 size-72 rounded-full ${claro ? "bg-black/10" : "bg-tinta/[0.04]"}`} />
        </>
      )}
      <div className={`relative mx-auto grid w-full max-w-6xl gap-8 px-6 pb-14 pt-12 @3xl:px-16 @3xl:py-16 ${b.producto ? "@3xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] @3xl:items-center" : ""}`}>
        <div className={centro ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
          {b.etiqueta && (
            <p className={`mb-4 inline-block rounded-full px-3.5 py-1 text-sm font-bold ${claro ? "bg-white/15 text-white ring-1 ring-white/30" : "bg-tinta text-white"}`}>{b.etiqueta}</p>
          )}
          <h2 className="font-display text-[clamp(2.1rem,7cqi,4.2rem)] leading-[0.95] tracking-tight">{b.titulo}</h2>
          {b.texto && <p className={`mt-4 text-[clamp(1rem,2.2cqi,1.25rem)] leading-relaxed ${claro ? "text-white/90" : "text-tinta-suave"} ${centro ? "mx-auto" : ""} max-w-xl`}>{b.texto}</p>}
          {b.botones.length > 0 && (
            <div className={`mt-7 flex flex-wrap gap-3 ${centro ? "justify-center" : ""}`}>
              {b.botones.map((x) => <span key={`${x.enlace}-${x.texto}`}>{ir(x.enlace, boton(x.estilo), x.texto)}</span>)}
            </div>
          )}
        </div>
        {b.producto && (
          <div className="flex justify-start @3xl:justify-end">
            {ir(`/producto/${b.producto.slug}`,
              "group flex w-full max-w-[19rem] gap-3 rounded-2xl bg-white p-3 text-tinta shadow-2xl ring-1 ring-black/5 transition hover:-translate-y-0.5 @3xl:max-w-[17rem] @3xl:flex-col",
              <>
                <span className="block aspect-[4/5] w-24 shrink-0 overflow-hidden rounded-xl bg-fondo-suave @3xl:w-full">
                  {b.producto.foto && <img src={srcProducto(b.producto.foto.clave)} alt={b.producto.foto.alt ?? b.producto.nombre} loading="lazy" decoding="async" className="size-full object-cover transition duration-300 group-hover:scale-[1.03]" />}
                </span>
                <span className="flex min-w-0 flex-col justify-center gap-1 @3xl:px-1 @3xl:pb-1">
                  <span className="line-clamp-2 text-[15px] font-bold leading-snug">{b.producto.nombre}</span>
                  <span className="text-sm">
                    {b.producto.precioLista && b.producto.precioLista > b.producto.precio && <s className="mr-1.5 text-tinta-tenue">{pesos(b.producto.precioLista)}</s>}
                    <b className="text-marca">{pesos(b.producto.precio)}</b>
                  </span>
                  <span className="mt-1 text-sm font-bold text-marca underline underline-offset-4">Ver producto <span aria-hidden="true">→</span></span>
                </span>
              </>,
              `Ver ${b.producto.nombre}`)}
          </div>
        )}
      </div>
    </div>
  );
}
