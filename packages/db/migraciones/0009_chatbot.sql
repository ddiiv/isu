-- ─────────────────────────────────────────────────────────────────────
-- Etapa 5: asistente de la tienda (chatbot de preguntas frecuentes).
-- ─────────────────────────────────────────────────────────────────────

/*
 * Preguntas frecuentes: las edita el backoffice. `palabras` son las formas
 * en que la gente pregunta lo mismo ("mandan, correo, llega"): pesan más que
 * la pregunta al buscar. En la respuesta se pueden usar {descuento},
 * {cuotas}, {envioGratis}, {whatsapp}, {horaCorte} y {locales}: salen de Ajustes.
 * El enlace es siempre de la tienda (una ruta que empieza con /).
 */
CREATE TABLE tienda.faq (
  id             serial PRIMARY KEY,
  pregunta       varchar(200) NOT NULL CHECK (length(trim(pregunta)) >= 5),
  respuesta      varchar(1500) NOT NULL CHECK (length(trim(respuesta)) >= 5),
  palabras       varchar(300) NOT NULL DEFAULT '',
  tema           varchar(20) NOT NULL DEFAULT 'general'
                 CHECK (tema IN ('envios', 'pagos', 'talles', 'cambios', 'pedidos', 'locales', 'mayorista', 'general')),
  enlace_texto   varchar(60),
  -- Una ruta de la tienda: empieza con UNA barra ("//otro.sitio" llevaría a otro sitio).
  enlace_url     varchar(200) CHECK (enlace_url IS NULL OR enlace_url ~ '^/([A-Za-z0-9_#?=&.-][A-Za-z0-9/_#?=&.-]{0,198})?$'),
  orden          integer NOT NULL DEFAULT 0,
  activo         boolean NOT NULL DEFAULT true,
  -- Cuántas veces se respondió y cómo la votaron ("¿Te sirvió?").
  veces          integer NOT NULL DEFAULT 0,
  util           integer NOT NULL DEFAULT 0,
  no_util        integer NOT NULL DEFAULT 0,
  actualizado_por varchar(150),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CHECK ((enlace_texto IS NULL) = (enlace_url IS NULL))
);

/*
 * Lo que preguntaron y el asistente no supo contestar: sirve para sumar
 * preguntas frecuentes. Se guarda SIN datos personales (emails, teléfonos y
 * números largos se tachan antes) y se borra a los 90 días.
 */
CREATE TABLE tienda.chat_sin_respuesta (
  id        serial PRIMARY KEY,
  clave     varchar(200) NOT NULL UNIQUE,
  ejemplo   varchar(300) NOT NULL,
  veces     integer NOT NULL DEFAULT 1,
  resuelta  boolean NOT NULL DEFAULT false,
  primero   timestamptz NOT NULL DEFAULT now(),
  ultimo    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_sin_respuesta_pendientes ON tienda.chat_sin_respuesta (veces DESC) WHERE NOT resuelta;
CREATE INDEX chat_sin_respuesta_ultimo ON tienda.chat_sin_respuesta (ultimo);

/* Qué se consulta, por día (para el panel). Sin textos: sólo el tema. */
CREATE TABLE tienda.chat_temas (
  dia    date NOT NULL,
  tema   varchar(20) NOT NULL,
  veces  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, tema)
);

INSERT INTO tienda.ajustes (clave, valor, actualizado_por) VALUES
  ('chatbot', '{"activo": true, "saludo": "¡Hola! Soy el asistente de Isuwaya. Preguntame por envíos, talles, pagos, cambios o tu pedido."}'::jsonb, 'migracion'),
  -- Respuestas con IA (Claude) para lo que no está en las preguntas frecuentes. Además hace falta ANTHROPIC_API_KEY.
  ('chatbotIa', '{"activo": false, "topeDiario": 300}'::jsonb, 'migracion')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO tienda.faq (tema, orden, pregunta, palabras, respuesta, enlace_texto, enlace_url) VALUES
  ('envios', 10, '¿Hacen envíos a todo el país?', 'envio mandan correo interior provincia llegan envian',
   'Sí, enviamos a toda la Argentina con Correo Argentino, Andreani y OCA, a domicilio o a sucursal. En CABA también hay envíos en el día. Decime tu código postal y te digo cuánto sale.', NULL, NULL),
  ('envios', 11, '¿Cuánto sale el envío?', 'costo precio envio cuanto sale cobran gratis',
   'Depende del código postal y del transporte: lo ves en el checkout antes de pagar. Las compras desde {envioGratis} tienen envío gratis. Si me pasás tu código postal, te lo calculo ahora.', NULL, NULL),
  ('envios', 12, '¿Cuánto tarda en llegar?', 'demora tarda plazo dias llega cuando',
   'Depende del transporte y de la zona: el plazo de cada opción lo ves en el checkout, antes de pagar. Te avisamos cuando sale. En CABA, si pagás antes de las {horaCorte}, te puede llegar el mismo día.', NULL, NULL),
  ('envios', 13, '¿Puedo cambiar la dirección de envío?', 'cambiar direccion domicilio equivoque mal',
   'Si todavía no lo despachamos, sí: escribinos por WhatsApp al {whatsapp} con tu número de pedido y la dirección correcta.', NULL, NULL),
  ('pedidos', 20, '¿Cómo sigo mi pedido?', 'seguimiento rastrear donde esta pedido estado tracking numero',
   'Te mandamos el número de seguimiento por mail (y por WhatsApp si lo pediste) apenas sale. También podés ver el estado desde tu cuenta o decime el número de pedido y tu email y te digo cómo viene.', 'Mis pedidos', '/cuenta'),
  ('pagos', 30, '¿Qué medios de pago aceptan?', 'medios pago tarjeta credito debito mercadopago efectivo pagar',
   'Tarjeta de crédito o débito y dinero en cuenta con Mercado Pago (hasta {cuotas} cuotas sin interés), efectivo en Pago Fácil o Rapipago, transferencia bancaria con {descuento}% OFF, y pago en el local si retirás.', NULL, NULL),
  ('pagos', 31, '¿Tienen descuento por transferencia?', 'descuento transferencia off rebaja promo',
   'Sí: pagando por transferencia tenés {descuento}% OFF. Al confirmar la compra te damos los datos y te separamos las prendas mientras transferís.', NULL, NULL),
  ('pagos', 32, '¿Tienen cuotas sin interés?', 'cuotas interes financiacion tarjeta',
   'Sí, hasta {cuotas} cuotas sin interés con tarjeta de crédito a través de Mercado Pago.', NULL, NULL),
  ('pagos', 33, '¿Cuánto tiempo tengo para pagar?', 'tiempo pagar vence vencimiento reserva separada',
   'Las prendas quedan separadas mientras pagás: la transferencia y el pago en efectivo tienen unos días, y si no se acredita a tiempo el pedido vence y se liberan. Te avisamos por mail el vencimiento exacto.', NULL, NULL),
  ('talles', 40, '¿Cómo sé qué talle soy?', 'talle medida medidas queda tabla guia size',
   'En cada prenda tenés la "Guía de talles" con las medidas y "¿Cuál es mi talle?": cargás tus medidas y te recomienda el talle. Si quedás entre dos talles, te sugiere el más cómodo.', NULL, NULL),
  ('cambios', 50, '¿Cómo hago un cambio?', 'cambio cambiar talle color no me queda',
   'Tenés 30 días desde que la recibiste. La prenda tiene que estar sin uso y con etiquetas. Podés cambiarla gratis en el local, o por envío (el envío del cambio corre por tu cuenta, salvo falla).', 'Cambios y devoluciones', '/devoluciones'),
  ('cambios', 51, 'Me arrepentí de la compra, ¿qué hago?', 'arrepenti arrepentimiento devolver devolucion reembolso plata cancelar',
   'Tenés 10 días corridos desde que la recibiste para arrepentirte, sin costo. Lo pedís desde el Botón de arrepentimiento y te devolvemos el dinero por el mismo medio de pago.', 'Botón de arrepentimiento', '/arrepentimiento'),
  ('cambios', 52, 'Me llegó una prenda fallada, ¿qué hago?', 'fallada falla rota defecto mal equivocada otra prenda',
   'Escribinos por WhatsApp al {whatsapp} dentro de los 30 días con una foto y el número de pedido. El cambio o la devolución no te cuestan nada: nos hacemos cargo de los envíos.', 'Cambios y devoluciones', '/devoluciones'),
  ('locales', 60, '¿Dónde están los locales y en qué horario?', 'local locales direccion horario abren atienden donde estan retirar tienda fisica',
   '{locales}', 'Nuestros locales', '/locales'),
  ('locales', 61, '¿Puedo retirar la compra en el local?', 'retiro retirar buscar pasar local sin envio',
   'Sí, el retiro en el local es gratis. Elegilo en el checkout y te avisamos cuando esté listo. Llevá tu DNI y el número de pedido.', 'Nuestros locales', '/locales'),
  ('mayorista', 70, '¿Venden por mayor?', 'mayor mayorista revender reventa cantidad por mayor',
   'Sí, las compras por mayor van por nuestra tienda mayorista.', 'Tienda mayorista', '/mayorista'),
  ('general', 80, '¿Es seguro comprar en la tienda?', 'seguro confiable estafa datos tarjeta',
   'Sí. Los pagos con tarjeta los procesa Mercado Pago: nosotros nunca vemos ni guardamos los datos de tu tarjeta. La tienda funciona con conexión cifrada.', 'Política de privacidad', '/privacidad');
