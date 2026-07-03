# Backend Apps Script — setup y contrato

Backend de la Fase 1: el navegador parsea los exports con `engine.mjs` y manda las
**líneas normalizadas** acá; esto las guarda en un Google Sheet (histórico), deduplica,
recomputa el rollup y se lo sirve al tablero. **No parsea Excel** (eso va en el browser).

## Setup (una vez)

1. **Crear el Google Sheet** (a nombre de NAKU). Copiar su ID de la URL
   (`docs.google.com/spreadsheets/d/`**`ESTE_ID`**`/edit`). Crear 3 pestañas:
   - `Ventas` — DB de líneas (se llena sola; dejar vacía).
   - `Maestro` — SKU → comprador. Pegar el CSV maestro saneado. Header sugerido:
     `SKU · Buyer Persona · Nombre · Categorías · Familia`. La agencia edita acá
     (completa los "Sin asignar" y ajusta `Familia`).
   - `Meta` — deja A1 libre (guarda el rollup JSON).
2. *(Opcional)* Crear una carpeta en Drive para archivar los xlsx crudos y copiar su ID.
3. **Crear el proyecto Apps Script**: [script.google.com](https://script.google.com) → Nuevo proyecto.
   - Pegar `Code.gs`. En el manifiesto (`appsscript.json`, activar "Mostrar manifiesto" en
     Configuración) pegar el de este repo.
   - Completar `CONFIG`: `SPREADSHEET_ID`, `RAW_FOLDER_ID` (o dejar ''), y un `TOKEN`
     inventado (string largo al azar).
4. **Deploy** → Nueva implementación → tipo **Aplicación web**:
   - Ejecutar como: **yo** · Con acceso: **Cualquier persona**.
   - Copiar la **URL** que termina en `/exec`.
   - (La 1ª vez pide autorizar permisos de Sheets/Drive: aceptar.)
5. **Conectar el frontend**: en `web/api.js` setear `NakuApi.base = '<URL /exec>'` y
   `NakuApi.token = '<el mismo TOKEN>'`.

> El `TOKEN` no es auth fuerte (es un secreto compartido). Combinado con la URL
> no-indexable alcanza para una herramienta interna. No exponer facturación pública.

## Contrato (lo que consume el frontend)

**GET** `?action=rollup&token=…` → `{ ok, rollup }`
`rollup = { updated, totales, byPersona, porMesCanalPersona, topByPersona, unmapped }`
(mismo shape que `engine.aggregate`, para que el tablero lo pinte sin transformar).

**GET** `?action=maestro&token=…` → `{ ok, maestro:[{SKU, "Buyer Persona", Familia, …}] }`

**GET** `?action=ping&token=…` → `{ ok, ping:'pong' }` (health check)

**POST** body JSON `{ token, action:'save', lines:[…], final:bool }` → `{ ok, added, skipped, total, rollup? }`
- `lines` = líneas normalizadas del motor (canal, order_id, mes, sku, buyer, familia,
  nombre, unidades, facturacion, cuotas, provincia, estado_orden, source_file).
- Dedup por `canal|order_id|sku|unidades|facturacion`. Reenviar el mismo archivo no duplica.
- `final:true` en el último chunk → recomputa y devuelve el `rollup`.
- `NakuApi.saveLines()` ya chunkea y marca `final` solo.

## Flujo end-to-end (cuando lleguen los archivos de Leo)

1. Leo abre el tablero (GitHub Pages) → arrastra los 3 xlsx MeLi + csv TN.
2. El browser (SheetJS + PapaParse + `engine.mjs`) normaliza y matchea contra el maestro
   (que baja con `getMaestro()`), y renderiza al instante.
3. `NakuApi.saveLines(lines)` manda las líneas → se guardan en `Ventas`, se recomputa `Meta`.
4. En próximas visitas, el tablero arranca con `getRollup()` (chico) y filtra por mes/canal.

## ⚠️ Mantener en sync
`recomputeRollup()`/`aggregateInto()` en `Code.gs` son un **port** de `src/engine.mjs`
`aggregate()`. Si cambiás el motor (métricas, familias, etc.), replicá el cambio acá o
los números del histórico no van a coincidir con los del parseo en vivo.
