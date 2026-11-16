# Medición: Analytics, Clarity, Pixel de Meta y enlaces con origen

## Qué se mide hoy
La tienda manda a Google Analytics 4 los eventos de una tienda online: `view_item_list`, `select_item`, `view_item`, `add_to_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase`, `search`, `generate_lead` y `contact` (clic en WhatsApp).

Todo respeta el aviso de cookies: **sin «Aceptar» no se carga ningún medidor**. Clarity y el Pixel de Meta además no se piden a sus sitios hasta que la persona acepta.

## 1. Microsoft Clarity (gratis: grabaciones y mapas de calor)
1. Entrá a [clarity.microsoft.com](https://clarity.microsoft.com) y creá un proyecto con `https://www.isuwaya.com`.
2. En *Configuración → Resumen* copiá el **ID del proyecto** (10 letras y números).
3. En Railway, servicio **web**: variable `NEXT_PUBLIC_CLARITY_ID` con ese ID, y **redeploy** (se graba al compilar).
4. En *Configuración → Enmascaramiento*, dejá el modo **estricto** o **balanceado**: así no se graban los datos que escriben en el checkout.

## 2. Pixel de Meta
1. En [Administrador de eventos](https://business.facebook.com/events_manager) → *Conectar orígenes de datos → Web → Pixel de Meta*. Ponele «Isuwaya».
2. Copiá el **ID del Pixel** (sólo números).
3. En Railway, servicio **web**: `NEXT_PUBLIC_META_PIXEL_ID` con ese ID, y **redeploy**.
4. Verificá con la extensión *Meta Pixel Helper* de Chrome: aceptá las cookies y mirá un producto, agregalo al carrito y empezá el pago. Tienen que aparecer `ViewContent`, `AddToCart` e `InitiateCheckout`. `Purchase` sale al ver el pedido ya pagado.
5. Qué manda: `PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout`, `Purchase` y `Search`, con el valor en pesos y los códigos de producto.

**Todavía no está** la API de conversiones (el envío desde el servidor): sin ella Meta pierde las compras de quien rechaza cookies o usa bloqueador. Es el siguiente paso.

**Códigos de producto:** en las fichas el Pixel manda el identificador del producto y en el carrito y la compra el SKU de la variante. Para los anuncios de catálogo hay que unificarlos con los códigos del catálogo de Meta.

## 3. Enlaces con origen (UTM)
Poné estos enlaces donde corresponda, así Analytics sabe qué red trae cada visita (*Adquisición → Tráfico*):

| Dónde | Enlace |
|---|---|
| Bio de Instagram | `https://www.isuwaya.com/?utm_source=instagram&utm_medium=bio` |
| Reels (en el texto) | no clicable: «link en la bio» |
| Historias con sticker de enlace | `https://www.isuwaya.com/?utm_source=instagram&utm_medium=story` |
| Anuncios de Meta | `?utm_source=meta&utm_medium=paid&utm_campaign=<nombre>` |
| WhatsApp (difusión, estado) | `?utm_source=whatsapp&utm_medium=mensaje` |
| Firma de mail | `?utm_source=mail&utm_medium=firma` |

## 4. En Google Analytics (lo hacés en su pantalla)
1. *Administrar → Eventos*: tildá como **evento clave** `purchase`, `begin_checkout` y `add_to_cart`.
2. *Administrar → Vinculación de productos*: vinculá **Search Console** y **Merchant Center** (y Google Ads cuando lo uses).
3. *Administrar → Definiciones personalizadas*: dimensiones de evento `results` (de `search`), `creative_name` (de las promociones), `shipping_tier` y `payment_type`.
