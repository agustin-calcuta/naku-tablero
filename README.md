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
