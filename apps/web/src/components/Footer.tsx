import Link from "next/link";
import type { CategoriaNodo, ConfigPublica } from "@isu/shared";
import { SITIO } from "@/lib/sitio";
import { telefonoLegible } from "@/lib/contacto";

export function Footer({ config, categorias }: { config: ConfigPublica; categorias: CategoriaNodo[] }) {
  return (
    <footer className="mt-24 border-t border-linea bg-fondo-suave">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4 lg:px-10">
        <div className="space-y-3">
          <p className="font-display text-3xl text-marca">Isuwaya</p>
          <p className="text-sm text-tinta-suave">{SITIO.lema}. Diseñamos y fabricamos nuestra ropa, con talles reales.</p>
          <Link href="/nosotros" className="block text-sm font-bold text-tinta hover:text-marca">Quiénes somos</Link>
          <a href={SITIO.instagram} target="_blank" rel="noopener noreferrer" className="block text-sm text-tinta-suave hover:text-marca">Instagram</a>
        </div>
        <nav aria-label="Comprar por categoría" className="space-y-2 text-sm">
          <p className="font-bold">Comprar</p>
          {categorias.map((c) => <Link key={c.id} href={`/${c.slug}`} className="block text-tinta-suave hover:text-marca">{c.nombre}</Link>)}
          <Link href="/venta-por-mayor" className="block text-tinta-suave hover:text-marca">Venta por mayor</Link>
        </nav>
        <nav aria-label="Información legal" className="space-y-2 text-sm">
          <p className="font-bold">Ayuda</p>
          <Link href="/contacto" className="block text-tinta-suave hover:text-marca">Contacto</Link>
          <Link href="/devoluciones" className="block text-tinta-suave hover:text-marca">Cambios y devoluciones</Link>
          <Link href="/terminos" className="block text-tinta-suave hover:text-marca">Términos y condiciones</Link>
          <Link href="/privacidad" className="block text-tinta-suave hover:text-marca">Política de privacidad</Link>
          <Link href="/arrepentimiento" className="block font-bold text-tinta hover:text-marca">Botón de arrepentimiento</Link>
          <a href="https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario" target="_blank" rel="noopener noreferrer" className="block text-tinta-suave hover:text-marca">Defensa del consumidor</a>
        </nav>
        <div className="space-y-2 text-sm">
          <p className="font-bold"><Link href="/contacto" className="hover:text-marca">Contacto</Link></p>
          <a href={`https://wa.me/${config.whatsapp}`} className="block text-tinta-suave hover:text-marca">WhatsApp {telefonoLegible(config.whatsapp)}</a>
          {config.email && <a href={`mailto:${config.email}`} className="block text-tinta-suave hover:text-marca">{config.email}</a>}
          <Link href="/locales" className="block text-tinta-suave hover:text-marca">Nuestros locales</Link>
        </div>
      </div>
      <p className="border-t border-linea py-5 text-center text-xs text-tinta-tenue">© {new Date().getFullYear()} Isuwaya · Todos los derechos reservados</p>
    </footer>
  );
}
