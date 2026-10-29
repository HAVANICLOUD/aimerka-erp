# Compras documentales, recepción y trazabilidad

## Alcance de la implementación

El flujo extiende la operación existente: una orden documental registra lo solicitado al proveedor; una recepción física registra lo que llegó al almacén. Guardar la orden o sus facturas no suma inventario ni registra pagos.

- Cada compra nueva obtiene un folio interno automático `OC000001`, `OC000002`, etc. El número original del proveedor se conserva en `supplierOrder`; SICAR es opcional y sólo se valida como único cuando está informado.
- Las partidas conservan cantidad ordenada y cantidad recibida. El estado físico se calcula como `Pendiente`, `Recibida parcialmente` o `Recibida completa`. El traslado `Pendiente` / `En tránsito` es un dato independiente.
- El costo unitario y el importe documental pueden permanecer en `null`: la interfaz muestra **Por confirmar**. Un importe desconocido no se transforma en una compra de cero pesos.
- Los productos pueden crearse sin UPC. El SKU se genera con nombre, marca, modelo, color y capacidad, con un máximo de 10 caracteres alfanuméricos ASCII (`A–Z`, `0–9`), sin espacios ni guiones y evitando colisiones. Tras la migración de los códigos generados anteriormente, el SKU es permanente; el UPC original puede agregarse después y se valida como GTIN de 8, 12, 13 o 14 dígitos.
- Cada recepción suma exclusivamente las unidades seleccionadas a inventario vendible, conserva su comprobante y genera movimientos por partida. Se valida todo el lote antes de modificar stock o asignar códigos.
- La ficha de producto reúne compras, recepciones, movimientos, ventas, devoluciones, reintegros y documentos asociados. Los registros históricos conservan su condición documental: un estado antiguo de “recibida” no acredita por sí solo una nueva entrada física.

La preparación de la prueba contempla únicamente el producto de ejemplo, con existencia cero. Las compras y recepciones descritas a continuación son pasos que ejecuta el usuario en **Práctica**; no son órdenes reales precargadas ni compras efectuadas por esta implementación.

## Prueba guiada en Práctica

### 1. Verificar el producto antes de cargar documentos

Seleccionar **Práctica** y abrir el artículo desde Productos o Inventario:

| Dato | Valor de la prueba |
| --- | --- |
| Producto | Dyson Aspiradora Inalámbrica V12 Digital Slim |
| Marca / modelo | Dyson / V12 Digital Slim |
| Color / capacidad | Morado / 0.3 L |
| UPC indicado por el usuario | `885609037998` |
| SKU esperado | `DYSV12M03L` |
| Existencia inicial | 0 física, 0 reservada y 0 disponible |
| Item del proveedor | `701577` |

El generador reserva espacio para un sufijo cuando existe una colisión de SKU, sin superar 10 caracteres. Los SKU generados anteriormente se acortan conservando el código anterior como alias y actualizando sus vínculos de historial; los identificadores externos y los SKU importados del catálogo histórico se conservan. Para esta prueba se utiliza la ficha ya preparada: no crear un segundo producto para el mismo UPC. Los PDF de ejemplo no contienen ese UPC; procede de la indicación del usuario y no debe inferirse del item, clave SAT, folio o UUID.

La fotografía se sirve desde `/erp/assets/products/dyson-v12-digital-slim.jpg`. Fuente: [ficha oficial del producto en Costco México](https://www.costco.com.mx/Electrodomesticos/Electrodomesticos-del-Hogar/Aspiradoras/Dyson-Aspiradora-Inalambrica-V12-Digital-Slim/p/701577). Una fotografía o precio promocional de esa página no determina el importe de una compra documental.

## Correspondencia permanente entre orden y facturas

- El número del proveedor se reconoce junto a «Número de orden», «Orden», «No. de pedido» y variantes de lectura. En el ejemplo es `599633002`, tanto en la orden como en las dos facturas. El folio fiscal y el folio adicional del proveedor conservan campos separados.
- Desde **Nueva compra → Cargar orden y facturas** pueden adjuntarse todos los archivos juntos, conservando el borrador del formulario. Desde una compra guardada se usa **Añadir o revisar documentos**.
- El panel valida todos los archivos guardados y los nuevos, muestra la referencia de cada documento y acumula unidades ordenadas, facturadas, pendientes y excedentes. Los cambios de proveedor, número, artículo o cantidad vuelven a comprobarse antes de guardar y en el servidor.
- Facturación parcial válida: dos unidades ordenadas, primera factura por una unidad y segunda factura posterior por otra unidad. Una tercera factura distinta que agregue unidades bloquea el guardado. Las copias del mismo archivo, UUID o proveedor/folio se alertan y no se vuelven a contar.
- Una factura de otra orden o proveedor, otro producto, cantidades excedentes, versiones contradictorias de la orden o importes incompatibles requieren corregir la selección o la lectura. Una referencia ilegible queda pendiente de revisión; no se declara coincidente automáticamente.
- Las referencias pueden corregirse expresamente desde la lectura, conservando el archivo original y la referencia inicial. Para archivos guardados esta corrección no modifica UUID, partidas ni importes.
- Si ya existe una compra con el mismo proveedor y número de orden, se muestra su folio y se bloquea crear otra. Se debe revisar la compra existente y sus productos antes de adjuntar documentos; no se fusionan operaciones diferentes por compartir una referencia.
- Las modificaciones por el formulario ordinario de una compra con documentos también validan la correspondencia. Adjuntar facturas conserva pagos, recepción, inventario y números originales.

El validador compartido es `lib/purchase-document-validation.mjs`, publicado también en los módulos del navegador mediante `scripts/sync-client.mjs`.

### 2. Registrar sólo la orden

En Compras, abrir la carga de documentos y seleccionar `ORDEN COSTCO 599633002.pdf`. Revisar la lectura, proveedor, fecha, referencia y asignación al producto anterior. El resultado esperado es:

- Orden del proveedor `599633002` y **2 unidades** del artículo `701577`.
- Importe y costo documental **Por confirmar**: la captura de la orden no muestra un total utilizable.
- Ninguna recepción física ni pago registrado. El estado “Entregado” que aparece en la página del proveedor se conserva como evidencia de origen y no confirma la recepción en AIMERKA.

Marcar la confirmación de revisión y pulsar **Registrar orden documental**. Se asigna el folio interno disponible. Comprobar que el inventario sigue en **0**.

### 3. Anexar las dos facturas a la misma compra

Abrir la ficha de esa compra y usar **Añadir documentos**. Adjuntar las facturas, revisar su lectura y confirmar la asignación al mismo artículo:

| Documento | Unidades respaldadas | Importe final |
| --- | ---: | ---: |
| BMG `37144420` | 1 | $4,099.00 MXN |
| BMG `37144423` | 1 | $4,099.00 MXN |
| Compra conciliada | **2** | **$8,198.00 MXN** |

Los importes finales incluyen los descuentos e IVA documentados. En el estado se representan como `unitCostCents: 409900` y `amountCents: 819800`. La orden define las 2 unidades solicitadas; las dos facturas respaldan esas mismas unidades. El resultado nunca debe convertirse en 4 unidades por sumar orden más facturas.

Revisar cantidades e importes, marcar la confirmación y pulsar **Guardar documentos y actualizar orden**. El inventario todavía debe ser **0**. Desde la ficha del producto, comprobar que las dos facturas y la orden se pueden abrir. También es posible cargar los tres documentos juntos al crear la orden, revisando la misma conciliación antes de guardar.

### 4. Recibir en dos entregas

En la compra, abrir **Recibir mercancía en almacén**, seleccionar la partida y capturar **1** unidad. Revisar la selección y confirmar la recepción. Luego repetir para la unidad restante:

| Momento | Ordenadas | Recibidas acumuladas | Pendientes | Estado | Físico vendible |
| --- | ---: | ---: | ---: | --- | ---: |
| Orden guardada | 2 | 0 | 2 | Pendiente | 0 |
| Primera recepción | 2 | 1 | 1 | Recibida parcialmente | 1 |
| Segunda recepción | 2 | 2 | 0 | Recibida completa | 2 |

Con reservas y seguridad en cero, el disponible pasa de 0 a 1 y finalmente a 2. Cada confirmación genera una recepción y su movimiento; no debe permitir recibir más de lo pendiente. Revisar ambos comprobantes desde Compras y desde la ficha del producto. La cola de publicación debe mostrar **Pendiente de conexión**.

Para probar un producto sin UPC, crear otro artículo sin código, comprobar su SKU y existencia cero, y asignar el UPC mediante el escáner al recibirlo o desde su ficha. La asignación del UPC por sí sola no suma stock.

## Lectura, revisión y límites

Se aceptan PDF, PNG y JPG de hasta **15 MB por archivo**, hasta **15 páginas por PDF** y **12 archivos nuevos por importación**. PDF.js extrae el texto disponible; las páginas sin texto suficiente y las imágenes pasan por OCR local con Tesseract, español e inglés. Los motores se sirven desde el propio sitio. La lectura ocurre en el navegador; los originales se cargan al servidor al guardar.

La extracción produce un borrador revisable. La interfaz permite inspeccionar el texto, cambiar la clasificación, volver a interpretar, forzar OCR, corregir partidas y relacionar productos. El reconocimiento usa UPC explícito, equivalencias confirmadas de proveedor e item, y coincidencias de nombre. Las sugerencias dudosas requieren asignación manual. Los documentos irreconocibles admiten captura manual de sus partidas y vínculos antes de confirmar.

### Número de orden frente a fecha y hora

El lector excluye las fechas y horas completas antes de buscar la referencia de la orden, conservando el texto original como evidencia. Esto incluye horas fragmentadas entre líneas y horas compactadas por OCR, como `021718 PM`, en encabezados donde los títulos de las columnas aparecen antes de sus valores. Los folios numéricos legítimos conservan sus ceros iniciales; una cadena de dígitos aislada no se rechaza sólo por parecer una hora.

El borrador distingue referencias automáticas, manuales y guardadas. Al volver a interpretar, actualiza la referencia automática con la nueva lectura; conserva las capturas manuales válidas y la identidad de una compra ya registrada. Una fecha u hora inequívoca no se conserva como referencia de un borrador nuevo. El validador compartido de interfaz y servidor también bloquea fechas u horas usadas como número de orden, incluso si se marcaron como revisadas manualmente.

Las regresiones cubren la exclusión de `021718 PM`, fragmentos como `02:17:\n18PM`, la actualización de una cabecera automática antigua y el rechazo de referencias temporales antes del guardado. En la orden de Costco de prueba, la fecha/hora es `19/10/2026 02:17:18 PM` y la referencia del proveedor es `599633002`.

El caso reportado en Safari/OCR el 29 de octubre también pierde el indicador PM junto a la hora: la evidencia queda como `Número de orden Forma de pago D Mis métodos de 19/10/2026 021718`. La búsqueda entre columnas ahora examina todos los candidatos, reconoce `021718` por su proximidad a la fecha y busca una referencia independiente. Si encuentra `599633002`, utiliza esa referencia y conserva el descarte con `reason: date_time_context`. Si sólo encuentra la hora o varias referencias posibles, deja el número pendiente y bloquea el guardado. No utiliza el nombre del archivo para inventar una referencia faltante.

El documento conserva `supplierOrderNeedsReview` y `supplierOrderRejectedCandidates` para explicar la decisión. Los candidatos con `ambiguous_columns` permiten confirmación manual explícita de uno de ellos; los identificados como hora junto a la fecha siguen bloqueados. El servidor vuelve a examinar el contexto de `evidence.supplierOrder`, por lo que también rechaza resultados anteriores como `021718` aunque el navegador todavía no envíe los nuevos indicadores. La prueba de importación verifica que ese rechazo no modifique compras, productos ni documentos.

Se detectan archivos repetidos por SHA-256 y facturas repetidas por UUID. Las incompatibilidades de proveedor, orden, moneda, partidas o cantidades requieren revisión. Una factura ya vinculada a otra compra no se reaplica silenciosamente.

**Límites operativos actuales:** no existe envío real a VentiApp o marketplaces; la cola sólo conserva el disponible pendiente de publicación. La mención fiscal `PUE` no crea un pago, una salida bancaria ni una liquidación de crédito. La lectura de un CFDI no implica validación de vigencia o autenticidad ante el SAT. El OCR puede equivocarse y siempre debe revisarse antes de guardar.

## API y persistencia

Los comandos de negocio se envían a `POST /api/action` con `id`, `workspace`, `revision`, `type` y `payload`. El identificador protege contra repetir la misma operación; la revisión evita sobrescribir cambios concurrentes.

| Operación | Función |
| --- | --- |
| `product.save` | Alta o actualización de ficha; SKU automático si se omite; alta sin existencias |
| `product.assignUpc` | Asignación del UPC original pendiente, sin movimiento de inventario |
| `purchase.create` / `purchase.update` | Orden documental y folio interno, sin recepción implícita |
| `purchase.importDocuments` | Confirmación de archivos verificados, partidas, equivalencias y vínculos |
| `inventory.receivePurchase` | Recepción de `items: [{lineId, sku, qty, upc?}]` para un `purchaseId` |
| `POST /api/documents?workspace=…` | Carga multipart con campo `file`; validación del contenido y huella SHA-256 |
| `GET /api/documents/{id}?workspace=…` | Lectura del original que está registrado en el espacio solicitado |

Los originales se guardan en R2 privado bajo `{workspace}/documents/{sha256}`. D1 conserva el estado y los metadatos: `documents` incluye identidad, nombre, tipo, tamaño, lectura, compra y `lineLinks`; las partidas conservan `documentIds`. Los enlaces se resuelven a través de la API y responden con caché privada desactivada. Los espacios `practice` y `v28` conservan estados y rutas documentales independientes; la prueba se realiza únicamente en `practice`.

El estado también conserva `purchaseReceipts`, `movements` y `stockSyncQueue`. Esta última agrupa el último disponible por SKU con estado `awaiting_connection`; no es evidencia de una publicación externa.

## Verificación y preparación del código

Ejecutar desde la raíz del repositorio:

```bash
node --test tests/purchase-receiving-v29.test.mjs tests/purchase-document-parser.test.mjs tests/purchase-document-commands.test.mjs
node --test tests/operations-v28.test.mjs tests/integration-v28.test.mjs tests/payment-alerts.test.mjs
node --check public/erp/product-trace-ui.js
node --check public/erp/purchase-documents-ui.js
node scripts/vendor-document-readers.mjs
node scripts/sync-client.mjs
npm run build
```

`vendor-document-readers.mjs` copia PDF.js, Tesseract, recursos WASM e idiomas instalados. `sync-client.mjs` actualiza los motores compartidos del navegador y la plantilla del sitio; ejecutarlo después de modificar esos motores o `public/erp/index.html`. El proyecto también dispone de `bash scripts/build-verified.sh` para una compilación acotada por tiempo en el entorno de Sites. Compilar o pasar pruebas no constituye por sí mismo una publicación.

Las pruebas de dominio cubren recepciones parciales, cierre completo, idempotencia, rechazo atómico de UPC conflictivos, SKU sin UPC, importes desconocidos, conciliación de orden con facturas y documentos duplicados. La prueba manual anterior verifica los controles visibles, apertura de originales y continuidad del flujo completo en Práctica.
