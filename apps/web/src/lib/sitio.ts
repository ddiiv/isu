/* Datos fijos del sitio. Lo que cambia seguido (WhatsApp, monto mínimo…) viene de la API. */
export const SITIO = {
  nombre: "Isuwaya",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
  descripcion:
    "Ropa urbana y casual para hombre, mujer y niños. Fabricamos nuestras prendas: talles reales, envíos a todo el país y retiro en nuestros locales.",
  lema: "Prenditas para todos tus días",
  // Pasa por /mayorista, que redirige a MAYORISTA_URL (se cambia en Railway sin publicar de nuevo).
  mayorista: "/mayorista",
  instagram: "https://www.instagram.com/isuwaya",
} as const;

export const RUTAS_RESERVADAS = new Set([
  "terminos", "devoluciones", "privacidad", "arrepentimiento", "locales", "buscar", "carrito",
  "checkout", "cuenta", "ingresar", "registro", "producto", "api", "admin", "ayuda", "envios",
  "nuevos", "destacados", "outfits", "mayorista", "venta-por-mayor", "contacto", "nosotros",
]);
