#!/usr/bin/env bash
# Levanta TODO para las pruebas e2e y la auditoría, con los simuladores y los
# datos de muestra: lo usa CI y sirve en una compu limpia (Postgres y Redis
# levantados). Los registros de cada servicio quedan en ./registros/.
#
#   DATABASE_URL_E2E=… REDIS_URL_E2E=… bash scripts/ci/levantar-e2e.sh
#   pnpm e2e && pnpm seguridad
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p registros

# .env de prueba (los valores de desarrollo de .env.example + la base de CI).
if [ ! -f .env ]; then
  cp .env.example .env
  {
    echo ""
    echo "# ── scripts/ci/levantar-e2e.sh ──"
    echo "DATABASE_URL=${DATABASE_URL_E2E:-postgres://postgres@127.0.0.1:5433/stocker_test}"
    echo "REDIS_URL=${REDIS_URL_E2E:-redis://127.0.0.1:6380/1}"
    echo "ADMIN_CLAVE_CIFRADO=$(openssl rand -base64 32)"
    echo "HOST=127.0.0.1"
    echo "SMTP_URL="
  } >> .env
fi
set -a; . ./.env; set +a

esperar() { # esperar <url> <segundos>
  for _ in $(seq 1 "$2"); do curl -fs -o /dev/null "$1" && return 0; sleep 1; done
  echo "No responde $1"; tail -30 registros/*.log; exit 1
}

pnpm paquetes
pnpm --filter @isu/api --filter @isu/worker build

nohup node --env-file=.env scripts/demo/stocker-simulado.mjs > registros/stocker.log 2>&1 &
nohup node --env-file=.env scripts/demo/mercadopago-simulado.mjs > registros/mercadopago.log 2>&1 &
nohup node --env-file=.env scripts/demo/talo-simulado.mjs > registros/talo.log 2>&1 &
nohup node --env-file=.env scripts/demo/transportes-simulado.mjs > registros/transportes.log 2>&1 &
nohup node --env-file=.env scripts/demo/direcciones-simulado.mjs > registros/direcciones.log 2>&1 &
(cd apps/api && nohup node --env-file=../../.env dist/servidor.js > ../../registros/api.log 2>&1 &)
esperar "http://127.0.0.1:${PORT:-4000}/readyz" 60
(cd apps/worker && nohup node --env-file=../../.env dist/index.js > ../../registros/worker.log 2>&1 &)

# La tienda y el backoffice se compilan con las variables del .env (NEXT_PUBLIC_…).
pnpm --filter @isu/web --filter @isu/admin build
(cd apps/web && PORT=3000 HOSTNAME=127.0.0.1 nohup node .next/standalone/apps/web/server.js > ../../registros/web.log 2>&1 &)
(cd apps/admin && PORT=3001 HOSTNAME=127.0.0.1 nohup node .next/standalone/apps/admin/server.js > ../../registros/admin.log 2>&1 &)
esperar http://127.0.0.1:3000/ 60
esperar http://127.0.0.1:3001/ingresar 60

# El worker trae el catálogo del Stocker simulado; después, fotos, ajustes y datos de muestra.
for _ in $(seq 1 60); do
  n=$(curl -fs -H "x-isu-interno: ${INTERNO_TOKEN}" "http://127.0.0.1:${PORT:-4000}/v1/productos-slugs" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log(0)}})')
  [ "${n:-0}" -gt 0 ] && break; sleep 1
done
pnpm demo:fotos
pnpm demo:backoffice
(cd apps/api && node --env-file=../../.env scripts/limpiar-frenos.mjs)
echo "listo: tienda http://localhost:3000 · backoffice http://127.0.0.1:3001 · api :${PORT:-4000}"
