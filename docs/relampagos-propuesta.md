# Relámpagos propuestos

Precios y costos de `docs/margenes.csv` (base local: confirmar contra producción antes de cargar).
Cada relámpago queda en ~80% del descuento máximo que permite el piso mayorista, así el cupón o la transferencia
todavía pueden sumar un poco sin pasarse. Ninguno baja del mayorista (lo garantiza el sistema, no hay que cuidarlo a mano).

| Producto | Código Stocker | Precio | Relámpago | Precio relámpago | Mayorista (piso) | Sobre el piso | Costo | Margen sobre costo | Variantes |
|---|---|---|---|---|---|---|---|---|---|
| Sport Campera Hombre | ISUSPOCAM | $28.800 | 30% | **$20.160** | $18.000 | +$2.160 | $10.800 | 46% | 12 |
| Baggy Pantalón Hombre | ISUBAGPAN | $32.000 | 30% | **$22.400** | $20.000 | +$2.400 | $12.000 | 46% | 10 |
| Mirra Remera modal cuello v Mujer | ISUMIRREM | $8.000 | 30% | **$5.600** | $5.000 | +$600 | $3.000 | 46% | 75 |
| City Short Dama Rustico | ISUCITSHO | $13.000 | 18% | **$10.660** | $10.000 | +$660 | $6.000 | 44% | 80 |
| Mara Short Nena | ISUMARSHO | $8.000 | 30% | **$5.600** | $5.000 | +$600 | $2.000 | 64% | 70 |
| Soho Short de Lino Mujer | ISUSOHSHO | $11.000 | 22% | **$8.580** | $8.000 | +$580 | $5.000 | 42% | 48 |

## Cómo cargarlos (Promociones → Relámpagos, desde v1.62)

Los relámpagos ya no son descuentos normales que terminan pronto: tienen su propia pantalla (**Relámpagos**) y una marca
propia. Un descuento normal, aunque termine en una hora, **no** se muestra como relámpago. Un relámpago dura 48 h como
máximo (la API lo rechaza si no) y se puede programar a futuro: hasta el inicio no se ve en la tienda.

- **Nuevo relámpago:** nombre, %, productos, inicio, fin (botones de 24 h y 48 h). Cada producto muestra precio final,
  mayorista (piso) y margen sobre el piso; el mayorista es sólo del backoffice.
- **Sugerencias:** la pantalla propone productos visibles, con stock, fuera de otro descuento y con mayorista en todas sus
  variantes con stock, con el 80 % del descuento máximo que permite el piso (mínimo 10 %). Se marcan y «Programar
  seleccionados» crea un relámpago por cada % con el inicio y la duración elegidos. Nada se publica sin confirmar.
- Los 4 ya cargados quedaron marcados como relámpago por la migración 0031.

Equivalente de la tabla de abajo (3 relámpagos, mismos productos y %):

| Nombre | % | Productos |
|---|---|---|
| Relámpago 30% | 30 | Sport Campera, Baggy Pantalón, Mirra Remera, Mara Short Nena |
| Relámpago 22% | 22 | Soho Short de Lino |
| Relámpago 18% | 18 | City Short Dama |

Conviene lanzarlos un viernes a la mañana (24 a 48 h) y avisarlos en Meta/Google ese mismo día.
Requisito: el worker ya sincronizó el mayorista (si no, no rebajan nada).
