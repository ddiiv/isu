# Etapas

Cada etapa cierra con dos chequeos obligatorios: **QA** (pantallas, flujos, casos borde) y **Hacker** (seguridad, estrés, permisos). No se pasa a la siguiente con fallas.

| Etapa | Contenido | Estado |
|---|---|---|
| 0 | Monorepo, base (esquema `tienda`), API endurecida, tienda (diseño, legales, SEO, GA4, WhatsApp), backoffice y worker base, CI, infraestructura | **Cerrada** (abajo) |
| 1 | Patch en Stocker (plataforma `tienda`, catálogo, stock, NOTIFY), sincronización, categorías ↔ productos, listado y ficha con selector de color por foto, fotos (5 por color), búsqueda, eventos GA4 de e-commerce | Siguiente |
| 2 | Registro/login, carrito lateral (envío gratis, mínimo de compra), checkout, Mercado Pago (tarjeta, cuotas, Pago Fácil), transferencia con API de registro de pago, pago en el local, pedidos a la cola de Stocker, botón de arrepentimiento con código de trámite | |
| 3 | Backoffice: login con 2FA, productos y fotos en vista masiva, categorías, descuentos masivos, clientes sincronizados con Stocker, monto mínimo y ajustes | |
| 4 | Envíos: Correo Argentino, Andreani, Mercado Envíos, envíos del día, seguimiento con avisos por email y WhatsApp | |
| 5 | Chatbot de preguntas frecuentes, ajustes finales, prueba de carga final, salida a producción | |

## Etapa 0 · resultados del cierre (28/09/2026)

**QA**
- Tests de base: 14/14 — migraciones idempotentes, no tocan las tablas de Stocker, dos réplicas migrando a la vez, edición de migraciones detectada, 5 fotos por color, tope del padre con exhibición, color ajeno rechazado, 12 subidas simultáneas → entran exactamente 5, categorías de 2 niveles, auditoría inmutable.
- Tests de API: 25/25 — salud, config con ajuste roto, categorías, errores, CORS, cuerpos, validación, límite de pedidos con y sin proxies.
- Worker: 2/2. Reglas compartidas: 7/7.
- E2E en navegador real (escritorio 1440 y celular Pixel 7): 26/26 — sin errores de consola ni scroll horizontal, menú escritorio y cajón celular, WhatsApp, arrepentimiento visible desde el inicio, legales sin restos de la plantilla de Jumpseller, 404, robots/sitemap, JSON-LD, cabeceras.
- Lighthouse celular: rendimiento 95–97, accesibilidad 100, buenas prácticas 100, SEO 100 (inicio, subcategoría, página legal). CLS 0.
- Hallazgos corregidos durante el QA: el cajón del menú del celular quedaba atrapado dentro del header (backdrop-filter crea un bloque contenedor) → portal a `body`; dos navegaciones con el mismo nombre accesible; contraste del texto tenue 3,2:1 → 4,9:1; áreas táctiles chicas.

**Hacker**
- Auditoría contra los tres servicios: 74/74 — cabeceras, 28 rutas sensibles sin exponer, sin source maps, métodos, 12 cargas de inyección, JSON de 20.000 niveles, prototype pollution, 1 MB, XML con entidad externa, cabecera de 64 KB, 4 orígenes CORS hostiles, ráfaga con IP falsificada → 429.
- Aislamiento de la base: 19/19 — `tienda_app` no puede leer ni borrar tablas de Stocker, crear tablas en `public`, crear roles, leer `pg_authid` ni archivos, ni ejecutar comandos; una consulta colgada se corta a los 10 s.
- Hallazgo corregido: `CREATE SCHEMA IF NOT EXISTS` exigía permiso sobre la base aunque el esquema existiera → con el usuario restringido la API no habría arrancado en producción. El migrador ahora pregunta antes de crear.
- `pnpm audit --prod`: sin vulnerabilidades conocidas.
- Carga (4 núcleos, sin Cloudflare, todo al origen): API ~8.500 pedidos/s con p99 25 ms; HTML de la tienda ~800 páginas/s con p99 115 ms; 0 errores; máximo 3 conexiones a la base de Stocker.
