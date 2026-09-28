/*
 * Next en modo standalone arma un server.js mínimo, pero NO copia los
 * archivos estáticos ni /public: sin esto la tienda levanta sin CSS ni
 * imágenes. Se corre después de `next build` (postbuild de web y admin).
 */
import { cp, access } from "node:fs/promises";
import path from "node:path";

const app = process.cwd();
const nombre = path.basename(app);
const destino = path.join(app, ".next/standalone/apps", nombre);
const existe = (p) => access(p).then(() => true, () => false);

if (!(await existe(destino))) {
  console.error(`No existe ${destino}: ¿output "standalone" en next.config?`);
  process.exit(1);
}
await cp(path.join(app, ".next/static"), path.join(destino, ".next/static"), { recursive: true });
if (await existe(path.join(app, "public"))) await cp(path.join(app, "public"), path.join(destino, "public"), { recursive: true });
console.warn(`estáticos copiados a ${path.relative(app, destino)}`);
