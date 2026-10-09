/* Lo que se repite en el pie, Contacto y Quiénes somos. */
export const telefonoLegible = (n: string) => n.replace(/^549(\d{2})(\d{4})(\d{4})$/, "+54 9 $1 $2-$3");
/** Lo que dice Cambios y devoluciones: el horario en que se contesta el WhatsApp. */
export const HORARIO_ATENCION = "de lunes a viernes de 8 a 14 h";
export const localidades = (locales: ReadonlyArray<{ localidad: string }>) => {
  const l = [...new Set(locales.map((x) => x.localidad))];
  return l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} y ${l.at(-1)}`;
};
