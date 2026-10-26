# AIMERKA — Laboratorio de operación ecommerce

Prototipo privado, construido para Giovanni y HAVANI Technologies México. Interfaz en español, identidad visual suministrada por el usuario y registros ficticios. No es un ERP de producción ni una migración de V25 Estadísticas.

## Alcance funcional

- Resumen, pedidos, catálogo, inventario, compras y abonos ficticios, estadísticas por periodo, calculadora, conciliación simple, incidencias, integraciones propuestas y ruta de construcción.
- Búsqueda por pedido original, referencia interna, referencia VentiApp, folio SICAR y SKU.
- Reservas, envío, cancelación, reembolso, recepción a inspección y decisión de reventa.
- Identificación de eventos repetidos sin aplicar otra vez sus movimientos.
- Calculadora comercial editable con separación de contribución y depósito estimado.
- Escenarios de cálculo guardados para comparación, sin aplicación automática a pedidos.
- Cambios en localStorage del navegador; no hay datos compartidos entre usuarios o dispositivos.

## Límites explícitos

No hay backend, autenticación de negocio, base de datos compartida, APIs de VentiApp/SICAR/marketplaces, importación de Excel, facturación, bancos ni datos de clientes reales. Las compras y los abonos son ejemplos locales; la recepción de mercancía todavía no afecta el stock. Un almacén y una línea por pedido. Las devoluciones y cancelaciones parciales quedan fuera de esta demostración. Los ajustes de liquidación derivados de reembolsos todavía no están modelados. Las cantidades, precios y comisiones son ficticios. El motor y las validaciones del navegador no acreditan aislamiento multiempresa ni concurrencia de un sistema comercial.

El usuario adjuntó **ERP_V25_ESTADISTICAS_SICAR_PRUEBA.xlsm** como referencia principal. Se revisaron sus 51 hojas, 12 tablas, fórmulas y 77 componentes VBA de forma estática, sin ejecutar macros ni recalcular. La copia contiene ventas y partidas, compras y abonos, estadísticas, cotejo SICAR, comisiones de Elektra y conciliación. El código de ventas declara modo SIMULADO y no modifica el stock del catálogo con esos movimientos. La demostración no incorpora datos reales del libro ni garantiza paridad con sus cálculos. La revisión de V25 reemplaza las conclusiones de la calculadora antigua.

## Estructura

- `dist/index.html`: entrada.
- `dist/styles.css`: interfaz adaptable.
- `dist/app.js`: vistas y acciones de demostración.
- `dist/domain.js`: dominio independiente, UMD sin dependencias.
- `dist/statistics.js`: filtros por fecha y canal sobre pedidos ficticios.
- `dist/purchases.js`: compras, vencimientos y abonos de ejemplo.
- `dist/assets/aimerka-logo-original.jpeg`: identidad suministrada; el navegador encuadra el logotipo sin modificar el original.
- `check-domain.cjs`: comprobaciones de integridad de los movimientos.

## Verificación

`node check-domain.cjs` comprueba nueve escenarios de dominio, incluyendo cancelación previa/posterior al envío, reembolso independiente del stock, inspección, rechazo, eventos repetidos, disponibilidad y consistencia después de eventos tardíos. También se revisó la sintaxis con `node --check dist/app.js` y se recorrió la operación en navegador.

## Dirección para el producto comercial

TypeScript, React/Next.js, NestJS y PostgreSQL; aplicación modular con conectores sustituibles, tareas en segundo plano, auditoría y un único responsable de cada escritura de inventario. Primera conexión propuesta: lectura de VentiApp, conciliación con operación real y posterior habilitación controlada de escrituras.

## Fuentes oficiales de integración

- https://ayuda.ventiapp.mx/es/guides/desarrolladores/api/ventas
- https://ayuda.ventiapp.mx/es/guides/desarrolladores/api/webhooks
- https://ayuda.ventiapp.mx/es/guides/desarrolladores/api/stock-y-precios
- https://ayuda.ventiapp.mx/es/guides/desarrolladores/consideraciones
- https://ayuda.ventiapp.mx/es/guides/desarrolladores/limite-de-uso
- https://manual.sicarx.com/web-escritorio/web/generar-reportes/

La disponibilidad pública de esos recursos no prueba la cobertura financiera de todos los canales ni los derechos comerciales para un servicio SaaS. Debe validarse el contrato y el alcance por cuenta antes del piloto real.
