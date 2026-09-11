# Dirección: cierre mensual desde tres planillas

Integración de septiembre de 2026. Las fuentes se leen con permisos privados de
Google y se guardan en la base compartida de los dos tableros.

## Fuente de cada indicador

| Fuente | Uso | Alcance |
|---|---|---|
| Gestión: Ventas - Gastos fijos | Mayoristas A/B, costo de mercadería mensual, gastos fijos/variables, resultado provisional | Empresa; costos separados entre mayoristas y online |
| Gestión: Ventas Meli y Tienda | Venta comercial y neto después de cargos | ML/TN; no sumar a los exports |
| Gestión: ROTACION DE STOCK | Ranking de unidades por SKU | Canal no identificado; sólo meses con cantidades |
| Gestión: Ventas por tipo artículo | Importes y cantidades por categoría/canal | Cobertura propia; no sustituye un año completo |
| Gestión: Saldos | Último saldo informado de cada mes | NAK, separando bancos, plataformas, pendiente de liquidar e inversiones |
| Gestión: pestañas fechadas | Última versión de la proyección de pagos | Corte propio; nunca sumar versiones históricas |
| Gestión: COMPRAS 2025 / Prestamo BAPRO | Contexto histórico de importaciones y cuotas | No se vuelven a sumar a gastos ni al cash flow |
| Costos de productos | Costo unitario por SKU y vigencia mensual | Para análisis comercial; distinto del costo mensual real del cierre |
| Central | Altas y cierres de postventa por mes/canal | Cierres antiguos aproximados identificados; sin fabricar tasas por orden |
| Exports ML/TN | Productos, familias, provincias, órdenes, ticket y compradores | Complemento opcional; no bloquea el cierre mensual |

Se inspeccionó el libro completo: seis hojas de gestión, una de préstamo y 85
versiones/escenarios de cash flow. Se conserva un inventario de todas las hojas,
incluidas las ocultas y las celdas con errores.

## Dos vistas con poblaciones explícitas

Dirección abre **Cierre mensual**, con empresa, online, mayoristas y cuatro canales.
Sólo ofrece meses anteriores al mes actual. Un mes calendario terminado puede tener
gastos pendientes: el resultado se identifica como provisional. No hay una señal de
aprobación contable en el archivo y no se inventa una.

**Detalle de ventas** conserva los mismos importes, órdenes y períodos que
Compradores. La vista mensual muestra la conciliación entre planilla y órdenes.
No se altera el valor de productos para forzar que los resúmenes coincidan.

Mayoristas conserva la base monetaria informada. No se divide A/B automáticamente
por una tasa de IVA. En ML/TN se parte de productos, descuentos y devoluciones para
obtener la venta comercial sin IVA. El neto de administración se conserva con su
referencia. La diferencia entre venta y neto entra una sola vez como cargos netos.

Los costos combinados de ML/TN o mayoristas no se prorratean a un canal individual.
Los gastos de empresa tampoco se reparten sin una fuente. Los blancos no son ceros.
Se comparan totales de gastos con sus componentes y se muestran las fórmulas del
neto que omiten conceptos con importes. Scrap se descuenta sólo si está informado.

Pendientes detectados en la copia revisada: logística e IIBB de agosto incompletos;
referencias de septiembre desplazadas; suscripciones fuera de fórmulas del neto ML;
rotación de agosto sin cantidades; categorías con meses limitados; una suma de pagos
que corta antes de filas posteriores con importes. No se modificó el archivo fuente.

## Gastos legibles para Dirección

El resumen agrupa los gastos fijos y variables por su finalidad: Personal,
Servicios, Instalaciones y mantenimiento, Tecnología y sistemas, Marketing y
ventas, Logística e importación, Administración y asesoría e Impuestos. Se añade
**Sin mapear** cuando falta confirmar qué representa un concepto. No se
infiere el rubro a partir del nombre de una persona o de un proveedor.

Se muestran importe cargado, porcentaje de ventas y variación contra el mismo
número de meses inmediatamente anteriores. Las celdas vacías se señalan; no se
calcula una variación con datos incompletos. La suma de categorías coincide con
fijos más variables; mercadería y cargos de los canales no se vuelven a sumar.
Los nombres y los cargos detallados quedan en consultas desplegables.

Las equivalencias confirmadas se guardan en `fuentes.gastosCategorias`, sólo en
la base financiera. Una operación `/finanzas` puede agregar/corregir asignaciones
con `gastosCategorias: {concepto: idCategoria}`. Se validan las categorías, se
normalizan tildes, espacios y mayúsculas, y la sincronización de Google conserva
las asignaciones. Para devolver un concepto a revisión se usa `pendiente`.
Compradores no recibe este mapa ni puede modificarlo. Los nombres particulares
no se guardan en el repositorio público.

## Flujo y permisos

1. El Apps Script lee las tres fuentes con el acceso de su dueño. Detecta el MIME en
   Drive: una hoja nativa se lee como hoja; un XLSX se descarga sólo si está permitido.
2. `src/fuentes-sync.mjs` normaliza los formatos, recorta central a campos necesarios
   y calcula una revisión de contenido. Credenciales sólo en servidor. Cada lectura
   inicia una solicitud nueva y sigue la URL temporal de ContentService sin reenviar
   el token; una respuesta temporal vencida se reintenta una vez.
3. `/sincronizar` requiere clave financiera. Lee las fuentes, las valida y usa
   `buildShared` / `buyer_guardar` para guardar fuentes y ambos tableros atómicamente.
4. Un cambio de mes o de contenido recalcula el resultado. Sin cambios no se escribe.
   Un fallo de cualquier fuente conserva la última publicación. El botón muestra el
   error y los fallos automáticos quedan en Apps Script.
5. La clave Buyer puede cargar exports/maestro. No puede cargar gestión, costos,
   central, sincronizar fuentes ni recibir información financiera.

Activación verificada el 11/09/2026: lectura real de las tres fuentes, guardado
compartido, ejecución manual de `sincronizarProgramado`, un único disparador cada
hora y actualización desde el navegador. Una segunda lectura sin cambios conserva
la revisión y las clasificaciones privadas.

La actualización programada es horaria. Las pestañas abiertas
consultan publicaciones cada 30 segundos. No requiere nuevos deploys para cada mes.

## Preparar y comprobar sin publicar

```sh
npm run actualizar -- --gestion '/ruta/Saldos - Cash flow.xlsx' --sin-publicar
# Opcionales: --costos /ruta/costos.xlsx --central /ruta/central.xlsx
# Para incorporar el histórico a una prueba local: --estado /ruta/snapshot.json
node tools/build-importer.mjs
node tools/build-tablero.mjs
npm test
# Auditoría opcional de la copia real, siempre fuera del repositorio:
NAKU_GESTION_TEST='/ruta/Saldos - Cash flow.xlsx' node tools/test-gestion.mjs
```

Salida privada: `datos/direccion.json` y `datos/operacion.json`, ignorados por git.
La rutina nueva prepara en local por defecto. Para publicar datos se requiere
`--publicar` y `NAKU_CLAVE`; siempre usa `/finanzas` de la API compartida, nunca
el endpoint financiero antiguo. `--sin-publicar` prevalece sobre `--publicar`.

## Activación posterior a la autorización de publicación

1. Iniciar sesión Google con la cuenta lectora. En esta activación se verificó
   lectura real de las tres fuentes, conservando sus permisos privados.
2. Revisar IDs de costos/central y gestión. Instalar/actualizar el Apps Script con
   `tools/instalar-puente.mjs`; ejecutar `probar` para autorizar Drive/Sheets de lectura.
   No cambiar los permisos de las planillas a público.
3. Configurar `NAKU_FUENTES_URL` y `NAKU_FUENTES_TOKEN` como secretos de la función
   Buyer. Desplegar esa función, que ahora empaqueta también el lector XLSX.
4. Guardar en Propiedades del script `API_URL` (la función Buyer, sin barra final)
   y `API_CLAVE` (clave financiera). Ejecutar `instalarSincronizacion` una vez.
   Reinstalar reemplaza solamente el disparador propio, no otros disparadores.
5. Ejecutar una sincronización, verificar fuentes/cortes y comparar la conciliación.
   La prueba con archivos locales no confirma permisos ni ejecución remota.
6. Publicar los HTML/JS generados. Comprobar los dos accesos, el botón de sincronización,
   el disparador horario y la ejecución de `sincronizarProgramado`. Los cambios
   retroactivos se reemplazan por mes; no se acumulan sobre la lectura anterior.

Las versiones anteriores se mantienen en el historial compartido y financiero.
No borrar archivos originales ni reemplazar datos actuales con un snapshot viejo.

Referencias de implementación: [Drive: descargas y permisos](https://developers.google.com/workspace/drive/api/guides/manage-downloads),
[Apps Script: disparadores por tiempo](https://developers.google.com/apps-script/guides/triggers/installable).
