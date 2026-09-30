/*
 * Catálogo de muestra con forma de Stocker. Lo usan el Stocker simulado y el
 * generador de fotos de muestra. Precios en pesos (como los manda Stocker).
 */
const T_ADULTO = ["S", "M", "L", "XL", "XXL"];
const T_NINO = ["4", "6", "8", "10", "12", "14"];

const base = [
  ["ISU-1001", "Remera Oversize Algodón Peinado", "Remeras", "Unisex", "remera", 18990, ["Negro", "Blanco", "Verde Militar", "Gris Melange"], T_ADULTO],
  ["ISU-1002", "Remera Básica Cuello Redondo", "Remeras", "Hombre", "remera", 12990, ["Negro", "Blanco", "Azul Marino"], T_ADULTO],
  ["ISU-1003", "Top Deportivo Ribb", "Tops", "Mujer", "top", 14990, ["Negro", "Rosa Viejo", "Lila"], ["S", "M", "L"]],
  ["ISU-1004", "Musculosa Morley", "Remeras", "Mujer", "remera", 10990, ["Blanco", "Negro", "Beige"], ["S", "M", "L", "XL"]],
  ["ISU-2001", "Buzo Canguro Frisa Premium", "Buzos", "Unisex", "buzo", 39990, ["Negro", "Gris Melange", "Bordo"], T_ADULTO],
  ["ISU-2002", "Campera Rompevientos Liviana", "Camperas", "Hombre", "buzo", 45990, ["Negro", "Verde Oliva"], ["M", "L", "XL"]],
  ["ISU-2003", "Buzo Crop Friza", "Buzos", "Mujer", "buzo", 32990, ["Crudo", "Rosa", "Negro"], ["S", "M", "L"]],
  ["ISU-3001", "Jogger Rústico Puño", "Pantalones", "Hombre", "pantalon", 27990, ["Negro", "Gris Topo", "Azul Marino"], T_ADULTO],
  ["ISU-3002", "Calza Deportiva Tiro Alto", "Calzas", "Mujer", "pantalon", 21990, ["Negro", "Azul", "Bordo"], ["S", "M", "L", "XL"]],
  ["ISU-3003", "Pantalón Cargo Gabardina", "Pantalones", "Hombre", "pantalon", 34990, ["Beige", "Negro", "Verde Militar"], ["38", "40", "42", "44", "46"]],
  ["ISU-3004", "Palazzo Fibrana Estampado", "Pantalones", "Mujer", "pantalon", 25990, ["Negro", "Terracota"], ["S", "M", "L"]],
  ["ISU-4001", "Bermuda Rústica con Bolsillos", "Bermudas", "Hombre", "short", 17990, ["Negro", "Gris", "Arena"], T_ADULTO],
  ["ISU-4002", "Short Biker Lycra", "Shorts", "Mujer", "short", 11990, ["Negro", "Gris Oscuro"], ["S", "M", "L"]],
  ["ISU-5001", "Remera Estampada Niños", "Remeras", "Niños", "remera", 9990, ["Blanco", "Celeste", "Amarillo"], T_NINO],
  ["ISU-5002", "Jogger Frisa Niños", "Pantalones", "Niños", "pantalon", 15990, ["Gris Melange", "Azul Marino"], T_NINO],
  ["ISU-5003", "Campera Inflable Niños", "Camperas", "Niños", "buzo", 42990, ["Negro", "Rojo"], T_NINO],
];

// Stock pseudoaleatorio pero fijo (siempre igual, para que las pruebas sean repetibles).
function stockDe(i, j, k) {
  const x = (i * 31 + j * 17 + k * 7) % 13;
  return x < 3 ? 0 : x - 2; // ~1 de cada 4 agotado
}

export function catalogoDemo() {
  let vid = 1;
  return base.map(([sku, titulo, categoria, genero, forma, precio, colores, talles], i) => ({
    id: 5000 + i,
    sku,
    titulo,
    forma,
    descripcion: `${titulo}. Confección propia de Isuwaya. Talles ${talles[0]} al ${talles.at(-1)}.`,
    categoria,
    genero,
    modelo: null,
    precio,
    variantes: colores.flatMap((color, j) => talles.map((talle, k) => ({
      id: 90000 + vid++,
      sku: `${sku}-${color.slice(0, 3).toUpperCase()}${j}-${talle}`,
      color,
      talle,
      // El talle más grande sale un poco más caro (como pasa en la realidad).
      precio: k === talles.length - 1 && talles.length > 4 ? precio + 2000 : precio,
      cantidad: stockDe(i, j, k),
    }))),
  }));
}
