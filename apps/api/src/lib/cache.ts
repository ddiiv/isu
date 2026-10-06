/*
 * Caché en memoria, corta y por réplica.
 *
 * Lo público (config, categorías, catálogo) lo cachea Cloudflare. Esto es la
 * segunda capa: en un pico, mil pedidos iguales que igual llegan a la API
 * hacen UNA consulta a la base compartida con Stocker, no mil. Si hay una
 * consulta en vuelo, los demás esperan esa misma promesa.
 *
 * Tiene techo: las claves salen de la dirección (categorías, colecciones), y
 * pedir slugs inventados no puede llenar la memoria. Pasado el tope se
 * borran las vencidas y, si no alcanza, las más viejas.
 */
export class CacheCorta {
  private datos = new Map<string, { hasta: number; valor: Promise<unknown> }>();
  constructor(private segundos: number, private tope = 5000) {}

  obtener<T>(clave: string, cargar: () => Promise<T>): Promise<T> {
    if (this.segundos === 0) return cargar();
    const ahora = Date.now();
    const hit = this.datos.get(clave);
    if (hit && hit.hasta > ahora) return hit.valor as Promise<T>;
    const valor = cargar();
    this.datos.delete(clave);
    if (this.datos.size >= this.tope) this.podar(ahora);
    this.datos.set(clave, { hasta: ahora + this.segundos * 1000, valor });
    // Un error no se cachea: el próximo pedido vuelve a intentar.
    valor.catch(() => this.datos.delete(clave));
    return valor;
  }

  limpiar() { this.datos.clear(); }

  get tamano() { return this.datos.size; }

  private podar(ahora: number) {
    for (const [k, v] of this.datos) if (v.hasta <= ahora) this.datos.delete(k);
    // El Map recorre en orden de llegada: las primeras son las más viejas.
    for (const k of this.datos.keys()) {
      if (this.datos.size < this.tope) break;
      this.datos.delete(k);
    }
  }
}
