# AIMERKA V28 — ERP para piloto privado

AIMERKA es un prototipo funcional para HAVANI Technologies México, con interfaz de ERP en español, datos importados del archivo **ERP_AIMERKA_V28_CONCILIACION_LOTES_PRUEBA.xlsm** y guardado persistente en el servidor. Conserva la operación del prototipo anterior —reservas, envíos, cancelaciones, reembolsos, inspección y reintegros— y la complementa con compras, gastos, crédito, precios, conciliación por lotes y estadísticas de V28.

Esta entrega permite trabajar y probar la lógica en una instancia privada de **una empresa y un almacén**. Las APIs de VentiApp, SICAR, marketplaces, bancos y facturación todavía no están conectadas. No es aún un servicio SaaS multiempresa.

## Espacios de trabajo y datos de origen

| Espacio | Contenido inicial | Comportamiento |
| --- | --- | --- |
| `v28` — HAVANI · datos V28 | Copia de los registros y referencias del Excel | Los cambios se guardan en su propio estado. No hay un botón para restablecer este espacio. |
| `practice` — Práctica · datos ficticios | Productos y doce pedidos del escenario anterior, con módulos V28 habilitados | Permite ensayar altas, movimientos, compras, gastos y conciliación. Puede restablecerse desde la aplicación sin modificar V28. |

El seed V28 incluye **326 productos, 492 ventas, 440 partidas de venta, 49 compras, 42 gastos y 518 movimientos del reporte SICAR**. Estas cifras describen la importación inicial; cambian cuando se registra operación nueva.

La importación conserva números originales de pedido, folios SICAR, UPC/SKU, procedencia, estados y observaciones de revisión. Las ventas históricas se identifican como `stockMode: historical` y **no vuelven a descontar existencias al importarse**. Los saldos, importes o fechas desconocidos permanecen como datos por confirmar. Los productos conservan la existencia del archivo en `sourceStock`, incluso cuando es negativa o desconocida; la disponibilidad operativa se administra por separado.

La base se inicializa una sola vez por espacio a partir de `data/seed-v28.json` y `data/pricing-config.json`. Sustituir esos archivos o volver a desplegar no sobrescribe automáticamente un espacio que ya tiene datos guardados.

## Funciones disponibles

| Módulo | Operaciones implementadas |
| --- | --- |
| Resumen y pedidos | Indicadores, búsqueda por pedido/SICAR/SKU/UPC, ventas con varias partidas, seguimiento, prioridad, notas e historial. |
| Inventario | Reservas, salida por envío, cancelación, recepción de devoluciones a inspección, reintegro aprobado, clasificación no vendible, ajustes y movimientos trazables. |
| Productos | Alta y actualización de identificadores, marca, costo, precio de mercado, categorías, mapeos y excepciones de envío por producto. |
| Compras y mercancía | Documento, proveedor, financiamiento, partidas, recepción documental, entrada física explícita al almacén, consultas y abonos. |
| Gastos y abonos | Alta, edición, categorías, facturas y referencias, filtros, saldos, pagos y resumen mensual. |
| Crédito y calendario | Relaciones entre dador e instrumento, corte y día de pago, fecha inicial manual, vencimientos y parcialidades recalculadas según los pagos registrados. |
| Precios y comisiones | Calculadora, cotizador y recomendador por producto/UPC; reglas por canal, categoría, MSI y envío; comparación y escenarios con sus entradas y configuración guardadas. |
| Conciliación y lotes | Condiciones por venta, estimación sobre partidas, depósito confirmado, borradores, selección, estimación y guardado por lotes con resultado por venta. |
| Estadísticas | Día, semana, mes, año y rango; fecha documental o creación/despacho; cancelaciones, reembolsos, más vendidos y cotejo mensual SICAR. |
| Configuración y catálogos | Comisiones, retenciones, envíos, MSI, categorías equivalentes, Tienda Nube, reglas de conciliación, dadores, instrumentos, proveedores y conceptos de gasto. |
| Control | Historial de operación, bitácora del servidor, exportaciones CSV y descarga de respaldo JSON del espacio actual. |

La recepción documental de una compra y su entrada física al almacén son acciones distintas. Un reembolso financiero tampoco crea existencias: la devolución debe recibirse e inspeccionarse antes de autorizar su reintegro.

La fecha manual de primer pago fija únicamente la primera cuota. Para programar las siguientes se necesita el día de pago configurado para ese crédito; mientras falte, permanecen «Por configurar», conforme a la lógica del archivo. Los importes de las cuotas sí se recalculan sobre el saldo y las parcialidades restantes.

La conciliación conserva un **importe total de depósito confirmado por venta**, como V28; compras y gastos sí acumulan varios abonos. Los movimientos negativos del reporte SICAR se muestran como tales y no se interpretan por sí solos como confirmación de una devolución bancaria.

## Arquitectura actual

El proyecto utiliza **Vinext sobre Vite**, rutas de servidor compatibles con App Router y **Cloudflare Workers**. La persistencia utiliza **Cloudflare D1**, con esquema y migraciones SQL mantenidos mediante Drizzle.

La interfaz ERP conserva HTML, CSS y JavaScript del prototipo, ampliados con módulos de vistas. Los motores de negocio son módulos JavaScript ESM compartidos entre servidor y navegador. Los cálculos pueden mostrarse en el navegador; las escrituras se validan nuevamente en el servidor mediante `applyCommand`.

| Ruta | Responsabilidad |
| --- | --- |
| `public/erp/index.html`, `app.js`, `styles.css`, `v28.css` | Estructura e interfaz base. |
| `public/erp/runtime-v28.js`, `boot-v28.mjs` | Carga de estado, envío de comandos, cambio de espacio e instalación de motores. |
| `public/erp/commerce-v28.js`, `operations-ui.js`, `pricing-ui.js`, `reconciliation-ui.js` | Vistas y formularios actuales del ERP. |
| `lib/inventory-v28.mjs`, `operations-v28.mjs`, `pricing-v28.mjs`, `reconciliation-v28.mjs` | Reglas de inventario, operación administrativa, cálculo comercial y conciliación. |
| `lib/commands.mjs` | Despacho y validación de comandos del servidor. |
| `lib/store.ts`, `state-codec.mjs` | Inicialización, lectura, revisión de estado y persistencia por fragmentos. |
| `app/api/state/route.ts`, `action/route.ts`, `audit/route.ts` | Endpoints de estado, operaciones y bitácora. |
| `db/schema.ts`, `drizzle/` | Tablas y migración de D1. |
| `worker/index.ts`, `vite.config.ts` | Entrada del Worker y configuración de Vinext/Vite. |
| `data/seed-v28.json`, `pricing-config.json` | Datos y configuración iniciales extraídos/revisados de V28. |
| `lib/legacy-domain.cjs` | Motor anterior conservado y verificado por sus pruebas originales. |
| `scripts/sync-client.mjs` | Sincronización de motores para el navegador, adaptador ESM heredado y shell HTML servido por `/`. |

`public/erp/modules/`, `lib/legacy-domain.mjs` y `lib/shell.ts` son salidas de sincronización. Los cambios de negocio se realizan en `lib/`; después se ejecuta el script de sincronización. `dist/` es salida de compilación, no la fuente de la aplicación.

### Persistencia, revisión e idempotencia

- `GET /api/state?workspace=v28` carga el estado, su revisión y la fecha de actualización. La variante `practice` carga el otro espacio.
- `POST /api/action` recibe `{ id, type, payload, workspace, revision }`. El servidor trabaja sobre una copia, valida el comando y persiste solo un resultado aceptado.
- Cada espacio tiene una revisión creciente. Si otra ventana guardó antes, la solicitud obsoleta recibe `409` y el estado actual para revisar y reintentar; no se sobrescribe silenciosamente la otra edición.
- Cada comando tiene un identificador estable. Repetir el mismo identificador y contenido devuelve el resultado anterior sin volver a mover inventario ni duplicar abonos. Reutilizarlo con otro contenido se rechaza. Una intención nueva utiliza otro identificador.
- D1 almacena el estado en `erp_fragments`, dividido por campo y fragmentos de hasta 90.000 bytes que respetan UTF-8. La revisión, los fragmentos cambiados y la entrada en `erp_actions` se escriben en un lote con condición sobre la revisión previa.
- `GET /api/audit?workspace=v28` devuelve hasta 500 operaciones confirmadas, con identificador, revisión, resultado, fecha y operador informado por el entorno privado.

El navegador conserva la selección de espacio en `localStorage`; **la fuente de verdad operativa es D1**. Los dos espacios separan datos de trabajo y práctica, pero no constituyen un sistema de permisos entre empresas.

### Importes y fechas

Los documentos y movimientos guardan dinero en centavos enteros de MXN. El costo promedio importado mantiene además su precisión original en `averageCostMxn`, para los cálculos que la utilizan. Las tasas y reglas comerciales se conservan en la configuración correspondiente.

Las fechas civiles y horas del Excel sin zona horaria mantienen el día escrito en el archivo. Los timestamps nuevos con `Z` u offset explícito se convierten a la fecha de `America/Mexico_City` al mostrarse o agruparse en estadísticas. El timestamp completo se conserva para la trazabilidad.

## Desarrollo y verificación

### Requisitos

- Node.js **22.13.0 o posterior** y npm.
- Entorno de ejecución con el binding D1 **`DB`** y las tablas de `drizzle/` aplicadas.
- Python con `openpyxl` solamente si se necesita regenerar el seed desde el archivo XLSM.

Desde la raíz del repositorio:

```bash
npm run install:ci
node scripts/sync-client.mjs
npm run dev
```

El comando de desarrollo utiliza el perfil configurado para el entorno; la consola indica la dirección disponible. La conexión D1 y su esquema deben estar preparados en ese entorno. No es suficiente abrir `public/erp/index.html` como un archivo local: la aplicación necesita sus endpoints.

### Pruebas

```bash
node check-domain.cjs
node --test tests/*.test.mjs
```

`check-domain.cjs` ejecuta los nueve escenarios originales del motor conservado. Las suites V28 cubren cálculo comercial y sus referencias del libro, operaciones y pagos, fechas, conciliación, comandos usados por la interfaz, flujos integrados de inventario y serialización del estado. Trabajan con copias independientes de los datos y no modifican la base del piloto.

Para ejecutar una suite concreta:

```bash
node tests/operations-v28.test.mjs
node tests/integration-v28.test.mjs
```

### Sincronización y compilación

Después de modificar los motores de `lib/`, el motor heredado o el HTML de entrada:

```bash
node scripts/sync-client.mjs
npm run build
```

El build genera el Worker y los activos en `dist/`. **El build no ejecuta automáticamente la sincronización anterior.** El perfil administrado utiliza `scripts/build-verified.sh`; los comandos disponibles se definen en `package.json` y `scripts/run-framework.mjs`.

Para ejecutar localmente el Worker compilado:

```bash
npm start
```

En una base local nueva, después del build y antes del primer uso, la migración inicial puede aplicarse con:

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB \
  --local --config dist/server/wrangler.json \
  --persist-to .wrangler/state --file drizzle/0000_blushing_bloodscream.sql
```

Este comando corresponde al almacenamiento local utilizado por `npm start`; no aplica cambios a la base alojada. La migración inicial crea tablas y se ejecuta una sola vez sobre una base vacía. Para cambios posteriores de esquema, `npm run db:generate` genera migraciones que deben revisarse y aplicarse al entorno correspondiente; no sustituye una migración de datos existentes. Compilar o arrancar localmente no publica el sitio.

## Regenerar la importación de V28

La importación estática se puede reproducir con una ruta explícita al libro:

```bash
python scripts/import-v28.py /ruta/ERP_AIMERKA_V28_CONCILIACION_LOTES_PRUEBA.xlsm
```

El script lee el libro y escribe `data/seed-v28.json`. **No ejecuta VBA, no recalcula fórmulas y no escribe en el XLSM.** Utiliza los valores almacenados en el archivo. La configuración comercial se conserva por separado en `data/pricing-config.json`; regenerar el seed no reemplaza las tarifas editadas de una base ya inicializada.

Antes de incorporar un nuevo seed deben revisarse conteos, identificadores, valores desconocidos y cotejo SICAR mediante las pruebas correspondientes. No hay todavía una pantalla de importación incremental ni una migración automática que mezcle otro Excel con las operaciones guardadas. `scripts/migrate-v28.py` es un script de la conversión inicial del proyecto; no forma parte del arranque, sincronización ni actualización habitual.

## Alcance y límites de esta entrega

- **Piloto privado de un negocio.** El acceso depende de la configuración privada del alojamiento. No hay altas de clientes SaaS, roles empresariales, permisos por sucursal ni aislamiento multiempresa implementado dentro de las rutas del ERP.
- **APIs pendientes.** Los pedidos nuevos se capturan manualmente. No hay consumo de webhooks, publicación de precios, sincronización de existencias, lectura de liquidaciones ni automatización contra VentiApp, SICAR o los marketplaces. La reserva interna no evita por sí sola una sobreventa en una plataforma externa.
- **Reglas traducidas del archivo.** Se estudiaron las hojas y el código VBA de forma estática. Las funciones de negocio se representaron en formularios, comandos y cálculos; no se ejecutan macros de Excel dentro del servidor. La validación se apoya en referencias y casos verificables del libro, no en ejecutar automáticamente cada macro original.
- **Datos incompletos visibles.** Las ventas sin partidas verificadas, importes o fechas desconocidos y reglas comerciales por confirmar siguen requiriendo revisión. El cotejo SICAR inicial es una fotografía de la consulta del 24/10/2026; una edición posterior en AIMERKA no modifica ese reporte histórico.
- **Finanzas y operación externa.** Las estimaciones comerciales requieren contrastarse con liquidaciones y acuerdos reales. Registrar un abono, depósito o reembolso no inicia transferencias ni cargos bancarios. No hay emisión de CFDI ni validación de facturas ante SAT.
- **Modelo inicial de almacenamiento.** D1 guarda un estado por espacio, serializado en fragmentos; aún no es un modelo relacional de todas las entidades preparado para muchos clientes o gran volumen. La revisión optimista protege guardados concurrentes, pero no aporta sincronización en vivo entre ventanas.
- **Respaldo y recuperación.** La interfaz permite descargar el estado completo del espacio en JSON y exportar consultas en CSV. No hay todavía un flujo de restauración desde la interfaz ni un programa propio de respaldos automáticos y pruebas de recuperación.

El siguiente trabajo de integración debe partir de estos módulos y de sus contratos, conservando la procedencia histórica y un responsable definido para cada movimiento de inventario.
