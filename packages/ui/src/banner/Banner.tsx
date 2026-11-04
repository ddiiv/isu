import Link from "next/link";
import { Etiquetas, type EtiquetaVista } from "./Etiquetas";

/*
 * Un banner del inicio (etapa 12). Lo usan la tienda (el carrusel) y el
 * backoffice (la vista previa de Portada): el mismo dibujo en los dos.
 *
 *   · Sólo foto: la foto entera, con link si tiene (a la tienda o a otro sitio,
 *     en otra pestaña) y, si tiene, etiquetas de producto sobre la foto.
 *   · Con título: el texto sobre la foto (con un velo para que se lea) o sobre
 *     un fondo de color; etiqueta, hasta 2 botones y, si hay, la tarjeta de un
 *     producto con su foto y su precio.
 *
 * Se acomoda al ancho de su caja (consultas de contenedor), no al de la
 * pantalla: así la vista previa del backoffice puede mostrar cómo queda en un
 * celular aunque se esté en la compu.
 *
 * Los botones y la tarjeta llevan sólo a la tienda (la API ya lo exige): se
 * dibujan con next/link. El banner entero puede llevar a otro sitio (https).
 * En la vista previa (`vista`) no llevan a ningún lado.
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
  /** sólo en los banners de imagen (sin título) */
  etiquetas?: EtiquetaVista[];
}

const FONDO: Record<BannerVista["fondo"], string> = {
  marca: "bg-marca text-white", tinta: "bg-tinta text-white", ahorro: "bg-ahorro text-white", oferta: "bg-oferta text-white",
  crema: "bg-[#f6eee3] text-tinta", rosa: "bg-[#fbe9ec] text-tinta", arena: "bg-[#ebe2d2] text-tinta",
};
const OSCURO: Record<BannerVista["fondo"], boolean> = { marca: true, tinta: true, ahorro: true, oferta: true, crema: false, rosa: false, arena: false };
/** Sólo una ruta de esta tienda (tercera llave: la base y la API ya lo exigen). */
const propio = (e: string | null | undefined) => (e && /^\/(?![/\\])\S*$/.test(e) ? e : null);
/** Otro sitio: sólo https y sin usuario@ (la API ya lo exige; tercera llave, como `propio`). */
const externo = (e: string | null | undefined) => {
  if (!e || !/^https:\/\/[^\s/\\][^\s\\]*$/.test(e)) return null;
  try { const u = new URL(e); return u.protocol === "https:" && !u.username && !u.password ? e : null; } catch { return null; }
};

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
  /**
   * El banner entero: a una página de la tienda o a otro sitio (en otra pestaña).
   * Sólo foto: el nombre del link es el `alt`. Con título, el texto que se ve.
   */
  const irBanner = (clase: string, hijos: Hijos) => {
    const afuera = externo(b.enlace);
    const nombre = b.titulo ? undefined : b.alt;
    if (afuera && !vista) {
      return (
        <a href={afuera} target="_blank" rel="noopener noreferrer" className={clase} aria-label={nombre && `${nombre} (se abre en otra pestaña)`}>
          {hijos}{!nombre && <span className="sr-only"> (se abre en otra pestaña)</span>}
        </a>
      );
    }
    return ir(b.enlace, clase, hijos, nombre);
  };
  const etiquetas = !b.titulo ? b.etiquetas ?? [] : [];
  const fotoDe = b.foto && (movil && b.fotoMovil ? b.fotoMovil : b.foto);
  // El <picture> es el marco que recorta la foto: al entrar se acomoda con un zoom suave y no tiene
  // que asomar (ni hacer que el banner «desborde») mientras está agrandada.
  const foto = fotoDe && (
    <picture className={b.titulo ? "absolute inset-0 block overflow-hidden" : "block overflow-hidden"}>
      {!movil && b.fotoMovil && <source media="(max-width: 767px)" srcSet={srcSetBanner(b.fotoMovil.clave)} sizes="100vw" />}
      <img src={srcBanner(fotoDe.clave)} srcSet={srcSetBanner(fotoDe.clave)} sizes="100vw" alt={b.titulo ? "" : b.alt}
        width={fotoDe.ancho ?? 2400} height={fotoDe.alto ?? 900}
        loading={prioridad ? "eager" : "lazy"} fetchPriority={prioridad ? "high" : "auto"} decoding="async"
        // Con etiquetas, la foto entera y sin recortar: los puntos van en % de la foto.
        className={`banner-foto ${b.titulo ? "block size-full object-cover" : etiquetas.length ? "block h-auto w-full" : "block h-auto max-h-[78vh] w-full object-cover"}`} />
    </picture>
  );

  // Sólo foto: con su link y sus etiquetas, si tiene. Las etiquetas van al lado del link, no adentro (no se anidan).
  if (!b.titulo) {
    const conLink = b.enlace && !vista ? irBanner("block", foto) : <>{foto}</>;
    if (!etiquetas.length) return conLink;
    return <Etiquetas etiquetas={etiquetas} fotoMovil={!!b.fotoMovil} vista={vista} movil={movil} srcProducto={srcProducto} pesos={pesos}>{conLink}</Etiquetas>;
  }

  const sobreFoto = !!b.foto;
  const claro = sobreFoto || OSCURO[b.fondo];
  const centro = b.alineacion === "centro" && !b.producto;
  const boton = (estilo: "lleno" | "borde") =>
    `inline-flex min-h-12 items-center justify-center rounded-full px-6 py-3 text-[15px] font-bold transition ${
      estilo === "lleno"
        ? claro ? "bg-white text-tinta hover:bg-white/90" : "bg-tinta text-white hover:bg-tinta/85"
        : claro ? "border-2 border-white text-white hover:bg-white/10" : "border-2 border-tinta text-tinta hover:bg-tinta/5"
    }`;

  const contenido = (
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
        {/* banner-texto / banner-producto / banner-foto: la entrada al llegar al banner (globals.css de la tienda). */}
        <div className={`banner-texto ${centro ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}`}>
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
          <div className="banner-producto flex justify-start @3xl:justify-end">
            {ir(`/producto/${b.producto.slug}`,
              "group flex w-full max-w-[19rem] gap-3 rounded-2xl bg-white p-3 text-tinta shadow-2xl ring-1 ring-black/5 transition hover:-translate-y-0.5 @3xl:max-w-[17rem] @3xl:flex-col",
              <>
                <span className="block aspect-[4/5] w-24 shrink-0 overflow-hidden rounded-xl bg-fondo-suave @3xl:w-full">
                  {b.producto.foto && <img src={srcProducto(b.producto.foto.clave)} alt={b.producto.foto.alt ?? b.producto.nombre} loading="lazy" decoding="async" className="size-full object-cover transition duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04]" />}
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
  // Sin botones ni producto, tocar cualquier parte lleva al link del banner (la API sólo lo manda en ese caso).
  return b.enlace && !b.botones.length && !b.producto && !vista ? irBanner("block h-full", contenido) : contenido;
}
