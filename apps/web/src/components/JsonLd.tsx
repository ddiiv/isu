/*
 * Datos estructurados para Google. Es el único HTML crudo del sitio, así que
 * se escapa "<" para que ningún texto (que en el futuro viene del backoffice)
 * pueda cerrar el <script> e inyectar otro.
 */
export function JsonLd({ datos }: { datos: unknown }) {
  const json = JSON.stringify(datos).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, "");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
