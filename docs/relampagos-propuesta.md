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

## Cómo cargarlos (Descuentos → Nuevo, 3 descuentos)

Elegir «Productos» como alcance, marcar los productos y poner **«Desde» = ahora y «Hasta» = ahora + 48 h (o menos)**.
Sólo lo que termina en 48 h o menos se muestra como relámpago (rojo, cuenta regresiva, cartel y `/relampago`).

| Nombre | % | Productos |
|---|---|---|
| Relámpago 30% | 30 | Sport Campera, Baggy Pantalón, Mirra Remera, Mara Short Nena |
| Relámpago 22% | 22 | Soho Short de Lino |
| Relámpago 18% | 18 | City Short Dama |

Conviene lanzarlos un viernes a la mañana (24 a 48 h) y avisarlos en Meta/Google ese mismo día.
Requisito: el worker ya sincronizó el mayorista (si no, no rebajan nada).
