# NAKU · Tablero de compradores

Tablero que reparte las ventas de NAKU (MercadoLibre + Mercado Shops + TiendaNube)
entre 5 buyer personas. El navegador parsea los exports con un motor propio y un
backend en Google Apps Script guarda el histórico en un Google Sheet.

> **Fase 1 (esta):** semi-integración por exports (sin API de MeLi/TN). Ver el plan
> completo por fases en `../Tablero Buyer Naku/PLAN-Integracion-Dashboard-Naku.md`.

## Estructura

```
src/engine.mjs        Motor puro: normaliza, matchea SKU→comprador, agrega, cross-sell.
web/tablero-v2.html   SOURCE del tablero v2 (incluye el importer; placeholders de motor + maestro).
web/api.js            Cliente del backend (guardar/leer) — opcional, Fase 2.
docs/                 ← lo que publica GitHub Pages
  index.html          Switcher entre las 2 versiones (?v=leo / ?v=nueva)
  leo.html            Deck original de Leonardo
  nueva.html          BUILD self-contained de tablero-v2 (lo genera tools/build-tablero.mjs)
appsscript/           Backend Google Apps Script (Code.gs + README de setup)
tools/                build-tablero.mjs (arma nueva.html) + validación (reconcile/snapshot/baskets)
```

## Deploy del tablero → URL con GitHub Pages

1. Crear un repo en GitHub (privado está bien) y subir **este** folder (`naku-tablero/`)
   como raíz del repo:
   ```bash
   git remote add origin git@github.com:<usuario>/naku-tablero.git
   git push -u origin main
   ```
2. En GitHub: **Settings → Pages**.
   - **Source:** *Deploy from a branch*.
   - **Branch:** `main` · **Folder:** `/docs` → **Save**.
3. En ~1 min aparece la URL:
   ```
   https://<usuario>.github.io/naku-tablero/
   ```
   - Versión de Leo: `…/naku-tablero/?v=leo`
   - Versión nueva: `…/naku-tablero/?v=nueva`
   Ese link se lo pasás a Leonardo para que compare y elija.

> ⚠️ **Ojo con los datos:** una URL de GitHub Pages es **pública** (aunque el repo sea
> privado). Hoy `nueva.html` trae los números reales embebidos (facturación por persona).
> Para la comparación de diseño con Leo va bien; pero para producción conviene que los
> números salgan del backend con token (`getRollup()`), y dejar el HTML público sin cifras.
> Si querés, lo dejo con números redondeados/relativos para el demo.

## Actualizar el tablero de dirección — la rutina

```bash
npm run actualizar
```

Eso hace todo: trae las planillas, procesa los exports que haya, regenera el
tablero, lo commitea y lo publica. GitHub Pages lo sirve un minuto después.

| Fuente | Cómo llega |
|---|---|
| **Costos** (planilla de compras) | **sola**, por el puente de Apps Script |
| **Postventa** (central de atención) | **sola**, por el puente |
| **Maestro** de SKU | archivo local |
| **Exports de MercadoLibre / TiendaNube** | **a mano**: dejarlos en el directorio de datos |

Los exports son lo único manual, y no hay forma de evitarlo hasta la API de
MercadoLibre: no se pueden bajar sin entrar a la cuenta. Cuando Leo los pase, van
a `../Naku Datos/` y se corre el comando.

El puente se instala una sola vez siguiendo **[`appsscript/fuentes/README.md`](appsscript/fuentes/README.md)**.
Sin él, el build usa los archivos que estén en el directorio de datos y avisa.

### Otros comandos

```bash
npm run tablero          # sólo regenera el JSON, no toca git
npm test                 # 65 controles sobre el JSON generado
npm run actualizar -- --sin-publicar
```

`npm test` verifica que el estado de resultados cierre, que las quincenas sumen
el mes, que los canales sumen el total, que las listas no tengan huecos y que las
cifras sean plausibles. Conviene correrlo antes de publicar algo raro.

## Tablero de dirección (`docs/direccion.html`)

Segundo tablero, para los socios: ventas, estado de resultados y central de
atención en una pantalla. **Todo sale de `docs/data/direccion.json`**, que se
genera con:

```bash
node tools/build-direccion.mjs            # datos en ../Naku Datos
NAKU_DATA="/otra/ruta" node tools/build-direccion.mjs
```

En ese directorio (fuera del repo, no versionado) tienen que estar:

| archivo | de dónde sale | qué alimenta |
|---|---|---|
| `*Ventas_AR*.xlsx` | export de MercadoLibre / Mercado Shops | ventas, órdenes, productos, familias, provincias, envíos, día por día **y todos los cargos de plataforma** |
| `*TiendaNube*.csv` | export de TiendaNube (cp1252, `;`) | lo mismo del canal propio |
| `PLANILLA_MADRE.xlsx` | planilla de compras | costo unitario **sin IVA** por SKU (hoja del mes, columna `COSTO SIN IVA`) |
| `Naku - SKU+Buyer+Cat.csv` | maestro de la agencia | nombre y familia de cada SKU |
| `Embudos_NAKU.xlsx` | export del Sheet de la central de atención | postventa y preventa |

### Decisiones que hay que tener presentes

- **Un mes por vez, del export crudo.** El histórico del motor
  (`docs/data/lines.json`) *no* se usa acá: guarda `Total (ARS)`, que es el neto
  que el canal liquida, sin los cargos desglosados, y su último mes viene cortado
  a mitad. Mezclar las dos fuentes daba variaciones falsas (junio 2026 aparentaba
  una caída del 30% porque el export cortó el día 16). Dejando más exports en el
  directorio, cada mes entra solo en la serie y aparece el comparativo.
- **Todo sin IVA.** Las ventas y los cargos de los canales vienen con IVA; el
  costo de la planilla es sin IVA. Comparar los dos sin corregir infla el margen
  unos 8 puntos (62,8% en vez de 55,4%).
- **El estado de resultados corta en el resultado de contribución.** Ventas
  netas → costo de la mercadería → margen bruto → comisiones, envíos e impuestos
  del canal. Marketing, estructura y sueldos, impuestos propios, amortizaciones y
  resultados financieros no salen de ningún export: el tablero los lista como
  pendientes en vez de dibujar cero.
- **Lo que no tiene fuente no se dibuja.** La posición financiera, el EBITDA, el
  margen mes a mes (necesita tres meses) y la preventa por volumen (sin casos
  cargados) están ocultos hasta que haya datos.
- **Control de integridad.** El build verifica que los componentes del export de
  MeLi sumen su propio `Total (ARS)`. Si MeLi renombra una columna, el build
  falla en vez de publicar un margen mal calculado.

### Tres campos que la central de atención no está cargando

El tablero los informa como pendientes porque sin ellos no se puede medir:

1. **`Fecha de cierre`** — vacía en los 849 casos, incluidos los 750 marcados
   `Resuelto …`. Sin eso no hay tiempo de resolución ni evolución de la cola.
2. **`3· Contactado`** — se marca junto con el alta (mediana ingreso→contactado:
   medio minuto, a veces *anterior* al alta). Mide cuándo se cargó el caso, no
   cuándo se le respondió al cliente.
3. **`Estatus` de preventa** — 653 de 683 consultas quedan en el inicial
   `Pregunta Meli`, así que no hay conversión del embudo.

Los tres se arreglan del lado de `appsscript/` de la central: sellar
`Fecha de cierre` cuando el estatus pasa a `Resuelto …` es una línea.

> ⚠️ **El JSON tiene el estado de resultados real.** Publicado en `/docs`, queda
> en una URL de GitHub Pages **pública** (el repo privado no la protege). Antes de
> mergear a `main`, decidir si el tablero de dirección va a Pages o a un host con
> contraseña.

## Backend (Google Drive + Sheet + Apps Script) → su propia URL

Es "lo de Drive". Pasos completos en **`appsscript/README.md`**. Resumen:
1. Crear un Google Sheet (pestañas `Ventas`, `Maestro`, `Meta`) y pegar el maestro.
2. Crear un proyecto en [script.google.com](https://script.google.com), pegar `Code.gs`,
   completar `CONFIG` (ID del Sheet + un TOKEN inventado).
3. **Deploy → Aplicación web** (acceso: *cualquiera*) → te da una **URL `…/exec`**.
4. En `web/api.js` poner esa URL en `NakuApi.base` y el mismo TOKEN.

Quedan **dos URLs**: la de **GitHub Pages** (el tablero que ve Leo) y la de **Apps Script
`/exec`** (el backend que guarda/lee los datos). El tablero le pega a la segunda.

## Actualizar los datos — el botón "Actualizar datos" (Fase 1, client-side)

El tablero v2 (`?v=nueva`) trae un botón **Actualizar datos** que abre un box donde Leo
**arrastra los 3 `.xlsx` de MercadoLibre + el `.csv` de TiendaNube**. Todo se procesa
**en el navegador** (SheetJS + el motor inline + el maestro embebido): recalcula, re-renderiza
las mismas tarjetas, muestra una **reconciliación por comprador** y deja descargar
`snapshot.json` + `unmapped_skus.csv`. **Nada se sube a internet** — los archivos no salen de
la máquina de Leo, y la versión pública del tablero no cambia con lo que él cargue.

- No necesita hosting extra, ni Drive, ni credenciales. Leo solo abre la URL y dropea.
- El maestro va **embebido** en `docs/nueva.html` (lo inyecta el build). Ojo: la URL de Pages
  es pública → ver la nota de arriba sobre no exponer cifras en producción (Fase 2).
- **Histórico:** las líneas normalizadas se guardan en **IndexedDB** (en la compu de quien
  carga). Cada mes que sube se **acumula**; al reabrir la URL el tablero arranca con todo lo
  cargado. Es **por navegador/máquina** (no compartido — eso es Fase 2 con backend).
- **Dedup:** al subir se dedup por `canal|orden|sku|unidades|facturación` (misma clave que el
  motor). Re-subir el mismo archivo/mes → **0 nuevas, no duplica**; solo entran órdenes nuevas.
- **Filtros:** rango de meses (desde/hasta) + presets (Último mes / 3 / 6 / Este año / Todo) que
  re-agregan en vivo, y el toggle de canal (Ambos / ML / TiendaNube). El filtro de fecha aparece
  cuando hay datos cargados (el ejemplo base no se puede filtrar por mes).
- **Borrar histórico:** botón en el badge / panel → limpia IndexedDB y vuelve al ejemplo.

### Rebuild (cuando cambie el motor o el maestro)

```bash
node tools/build-tablero.mjs   # lee src/engine.mjs + el maestro CSV → escribe docs/nueva.html
```

El source es `web/tablero-v2.html` (con placeholders `/*__ENGINE_JS__*/` y `__MAESTRO_CSV__`).
El maestro se lee de `../Tablero Buyer Naku/Naku - SKU+Buyer+Cat.csv` (no versionado). Después
del build: `git add docs/nueva.html && git commit && git push` → Pages actualiza en ~1 min.

### Validar el schema antes de publicar

`npm install` y `node tools/reconcile.mjs` → confirma que el esquema de MeLi no cambió y
reconcilia la facturación (los tools esperan los exports en `../Tablero Buyer Naku/`).

## Dev

- `npm install` (trae `xlsx` para los tools).
- Los `tools/*.mjs` leen los exports reales desde `../Tablero Buyer Naku/` (no versionado).
- El motor (`src/engine.mjs`) es puro y testeable; correr los tools para reconciliar.
