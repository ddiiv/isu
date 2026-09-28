/*
 * Datos del vendedor que la ley pide mostrar en una tienda online
 * (Ley 24.240 y Res. SCI 270/2020: razón social, CUIT y domicilio).
 * COMPLETAR razonSocial y cuit antes de salir a producción: mientras estén
 * vacíos no se muestran (mejor nada que un dato inventado).
 */
export const VENDEDOR = {
  nombreComercial: "Isuwaya",
  razonSocial: process.env.NEXT_PUBLIC_RAZON_SOCIAL ?? "",
  cuit: process.env.NEXT_PUBLIC_CUIT ?? "",
  domicilio: "Bacacay 3231, Galería Vía Flores, Local 21, CABA (C1406)",
  actualizado: "28 de septiembre de 2026",
};
