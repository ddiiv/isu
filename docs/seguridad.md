# Seguridad

Cada etapa cierra con el chequeo "hacker" (`tests/seguridad/`) y no pasa a la siguiente con fallas.

## Defensas vigentes (etapa 0)

| Riesgo (OWASP) | Defensa | Prueba |
|---|---|---|
| Inyección SQL | Consultas parametrizadas (Drizzle/pg); parámetros validados con Zod antes de llegar a la base; usuario de base sin acceso a Stocker | `auditoria.mjs` (12 cargas), `api.test.ts`, `aislamiento-db.mjs` |
| XSS | React escapa todo; el único HTML crudo (JSON-LD) escapa `<`; CSP sin `unsafe-eval`, sin objetos ni iframes de terceros | e2e cabeceras, `auditoria.mjs` |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` en las tres superficies | `auditoria.mjs` |
| CORS abierto | Lista cerrada de orígenes; subdominios parecidos y `null` rechazados | `api.test.ts`, `auditoria.mjs` |
| Fuerza bruta / abuso | Límite por IP contado en Redis (vale entre réplicas); la IP real sale de N proxies de confianza, un `X-Forwarded-For` inventado no la cambia | `api.test.ts`, `auditoria.mjs` |
| DoS de aplicación | Cuerpo máx. 64 KB, cabeceras máx. 16 KB, JSON sólo, timeouts, freno por presión del event loop (503 rápido), Cloudflare adelante | `auditoria.mjs` |
| Prototype pollution | `__proto__` y `constructor.prototype` rechazados en el parser | `api.test.ts`, `auditoria.mjs` |
| Filtración de errores | 500 genérico con `idPedido`; mensaje real, SQL y stack sólo al log | `api.test.ts` |
| Datos sensibles en logs | `redact` de authorization, cookies, tokens, contraseñas y tarjeta | revisión |
| Exposición de archivos | `.env`, `.git`, `package.json`, fuentes y source maps no se sirven | `auditoria.mjs` (28 rutas) |
| Dependencias | `pnpm audit --prod` en CI; scripts de instalación bloqueados salvo lista | CI |
| Base compartida | Esquema y usuario propios, techo de conexiones, `statement_timeout` | `aislamiento-db.mjs` |

## Pendiente por etapa

- **Etapa 2:** sesión en cookie `httpOnly; Secure; SameSite=Lax` + token anti-CSRF; contraseñas con argon2id; bloqueo por intentos; verificación de firma de webhooks de Mercado Pago e idempotencia de pagos; comprobantes de transferencia validados (tipo/tamaño) y guardados fuera del sitio público.
- **Etapa 3:** backoffice detrás de Cloudflare Access + login propio con 2FA (TOTP), permisos por rol, auditoría inmutable de cada cambio (tabla `tienda.auditoria`, ya creada con trigger que impide editarla).
- **Etapa 4:** firmas de webhooks de correos y de WhatsApp.
