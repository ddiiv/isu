/*
 * Caché en memoria, corta y por réplica.
 *
 * Lo público (config, categorías, catálogo) lo cachea Cloudflare. Esto es la
 * segunda capa: en un pico, mil pedidos iguales que igual llegan a la API
 * hacen UNA consulta a la base compartida con Stocker, no mil. Si hay una
 * consulta en vuelo, los demás esperan esa misma promesa.
 */
export class CacheCorta {
  private datos = new Map<string, { hasta: number; valor: Promise<unknown> }>();
  constructor(private segundos: number) {}

  obtener<T>(clave: string, cargar: () => Promise<T>): Promise<T> {
    if (this.segundos === 0) return cargar();
    const ahora = Date.now();
    const hit = this.datos.get(clave);
    if (hit && hit.hasta > ahora) return hit.valor as Promise<T>;
    const valor = cargar();
    this.datos.set(clave, { hasta: ahora + this.segundos * 1000, valor });
    // Un error no se cachea: el próximo pedido vuelve a intentar.
    valor.catch(() => this.datos.delete(clave));
    return valor;
  }

  limpiar() { this.datos.clear(); }
}
