# Isuwaya · tienda minorista

Tienda online de ISUWAYA. El stock y los precios salen de **Stocker**; la tienda
vive en el mismo proyecto de Railway y en la misma base de datos (esquema
`tienda`), sin tocar las tablas de Stocker.

```
apps/
  web/      tienda (Next.js 16, páginas estáticas con revalidación)
  admin/    backoffice (Next.js, subdominio aparte, fuera de buscadores)
  api/      API (Fastify 5): la única que habla con la base y con Stocker
  worker/   trabajos en segundo plano (BullMQ): stock, pagos, envíos, avisos
packages/
  shared/   reglas y esquemas compartidos (fotos, plata, config)
  db/       migraciones SQL + esquema tipado (Drizzle)
  ui/       sistema de diseño: colores del logo, tipografías, íconos
infra/      Railway, Cloudflare, SQL del usuario de base, docker-compose local
tests/      e2e (Playwright), seguridad, carga
docs/       arquitectura, etapas, seguridad, despliegue, contrato con Stocker
```

## Arrancar en local

Requisitos: Node 22.12+ y pnpm (`corepack enable`), Docker.

```bash
docker compose -f infra/docker-compose.yml up -d      # Postgres, Redis, Mailpit
cp .env.example .env                                   # ya apunta al docker local
pnpm install                                           # compila también los paquetes internos
pnpm db:migrar
pnpm dev                                               # web :3000, admin :3001, api :4000
```

### Con el catálogo de muestra (sin Stocker)

```bash
pnpm demo:stocker     # Stocker simulado en :3900 (16 productos), en otra terminal
pnpm dev              # el worker sincroniza el catálogo al arrancar
pnpm demo:fotos       # genera fotos de muestra y las importa
```

Backoffice (http://localhost:3001): `pnpm admin:crear vos@mail.com "Tu Nombre"`
imprime una contraseña provisoria; al entrar pide el doble factor (QR). Guías de
talles, Destacados/Nuevos, un descuento y dos cupones de muestra (`BIENVENIDA10`,
`ENVIOGRATIS`): `pnpm demo:backoffice`.

Para probar compras sin credenciales: `pnpm demo:mercadopago` (Mercado Pago
simulado en :3910, con botones Aprobar / Rechazar / Pendiente). Los mails se
ven en Mailpit (http://localhost:8025). Para confirmar una transferencia:

```bash
curl -XPOST localhost:4000/v1/pagos/registrar -H 'content-type: application/json' \
  -H 'authorization: Bearer solo-desarrollo-pagos-cambiar-en-produccion' \
  -d '{"pedido":"ISU-1001","medio":"transferencia","monto":1519200,"referencia":"OP-1","quien":"Caja"}'
```

Envíos (etapa 4): `pnpm demo:transportes` simula Correo Argentino, Andreani,
OCA, Mercado Envíos, Cabify y WhatsApp en :3920 (ahí se avanzan los envíos y se
ven los WhatsApp); el Stocker simulado tiene su "Envíos del día" con
**Despachar** en http://127.0.0.1:3900. El asistente (etapa 5) funciona sin nada
más; con `ANTHROPIC_API_KEY` y el ajuste prendido, también responde con IA.

Catálogo del sitio mayorista (etapa 6): `pnpm mayorista:importar` muestra qué
traería (fotos por color, foto principal, categorías) y `pnpm mayorista:importar
--aplicar` lo hace; engancha por SKU con lo que ya sincronizó de Stocker. Para
probarlo en local con los 71 productos del mayorista: guardar su
`/api/catalogo` en un archivo y levantar el Stocker simulado con
`DEMO_MAYORISTA=<archivo>` (mejor en una base aparte).

Para simular una venta en el local (la tienda la ve al instante):
`curl -XPOST localhost:3900/__vender -d '{"sku":"ISU-4002-NEG0-M"}'`.

Contra el Stocker real: `STOCKER_API_URL` = el backend de Stocker (sin `/api`) y
`STOCKER_TOKEN` = una credencial con origen «Tienda online minorista».

El `.env` va en la raíz; la API, el worker y las migraciones lo leen de ahí.
Si `pnpm install` avisa "Ignored build scripts: msgpackr-extract", no hace
falta hacer nada: es un acelerador opcional de BullMQ.

## Verificar (lo mismo que corre CI)

```bash
pnpm verificar                       # lint + tipos + tests + build
bash scripts/ci/levantar-e2e.sh      # todo levantado con simuladores y datos de muestra (lo que usa CI)
pnpm e2e                             # navegador real, escritorio y celular
pnpm seguridad                       # auditoría "hacker" contra los servicios levantados
node tests/seguridad/aislamiento-db.mjs   # la tienda no puede tocar tablas de Stocker
node tests/carga/carga.mjs           # carga básica
```

Detalle en [`docs/`](docs/): arquitectura, etapas y resultados, seguridad,
despliegue en Railway + Cloudflare, el contrato con Stocker y la guía de
[salida a producción](docs/salida-produccion.md).
