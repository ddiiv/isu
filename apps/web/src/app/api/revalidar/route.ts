import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { vencerRedirecciones } from "@/lib/redirecciones";

/*
 * POST /api/revalidar — lo llama el worker (por la red privada) cuando cambia
 * el catálogo o el stock, para regenerar las páginas afectadas.
 *
 * Con el token equivocado (o sin token configurado) contesta 404, igual que
 * una ruta que no existe: no le confirma a nadie que está acá.
 */
const Cuerpo = z.object({
  // Cada repetición arranca con "-": lineal, sin ReDoS.
  // eslint-disable-next-line security/detect-unsafe-regex
  etiquetas: z.array(z.string().regex(/^(catalogo|producto:[a-z0-9]+(?:-[a-z0-9]+)*)$/).max(100)).min(1).max(501),
}).strict();

const noExiste = () => Response.json({ error: "no_encontrado" }, { status: 404 });

export async function POST(req: Request) {
  const token = process.env.REVALIDAR_TOKEN ?? "";
  const h = req.headers.get("authorization") ?? "";
  const a = Buffer.from(h), b = Buffer.from(`Bearer ${token}`);
  if (token.length < 32 || a.length !== b.length || !timingSafeEqual(a, b)) return noExiste();

  const texto = await req.text();
  if (texto.length > 64_000) return Response.json({ error: "demasiado_grande" }, { status: 413 });
  let datos: unknown;
  try { datos = JSON.parse(texto); } catch { return Response.json({ error: "pedido_invalido" }, { status: 400 }); }
  const r = Cuerpo.safeParse(datos);
  if (!r.success) return Response.json({ error: "pedido_invalido" }, { status: 400 });

  // Vence ya: el próximo que entra ve el stock nuevo (una prenda agotada no puede seguir a la venta).
  for (const e of new Set(r.data.etiquetas)) revalidateTag(e, { expire: 0 });
  // Un producto que se publica u oculta cambia a dónde va su dirección vieja; y el backoffice de redirecciones avisa por acá.
  if (r.data.etiquetas.includes("catalogo")) vencerRedirecciones();
  return Response.json({ ok: true, etiquetas: r.data.etiquetas.length });
}

export function GET() { return noExiste(); }
