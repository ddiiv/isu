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

El `.env` va en la raíz; la API, el worker y las migraciones lo leen de ahí.
Si `pnpm install` avisa "Ignored build scripts: msgpackr-extract", no hace
falta hacer nada: es un acelerador opcional de BullMQ.

## Verificar (lo mismo que corre CI)

```bash
pnpm verificar                       # lint + tipos + tests + build
pnpm e2e                             # navegador real, escritorio y celular
pnpm seguridad                       # auditoría "hacker" contra los servicios levantados
node tests/seguridad/aislamiento-db.mjs   # la tienda no puede tocar tablas de Stocker
node tests/carga/carga.mjs           # carga básica
```

Detalle en [`docs/`](docs/): arquitectura, etapas y resultados, seguridad,
despliegue en Railway + Cloudflare y el contrato con Stocker.
