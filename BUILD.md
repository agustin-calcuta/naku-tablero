# NAKU Tablero — Build (Fase 1: solución intermedia, sin API)

## Qué es lo ideal (decisión de arquitectura)

**El parseo pesado se hace en el navegador; Google Sheets es el histórico; el HTML solo lee agregados.**

```
Leonardo abre el tablero (web app)
        │  arrastra: 3 xlsx MeLi + 1 csv TN  (+ maestro se lee de un Sheet)
        ▼
[ BROWSER ]  SheetJS (xlsx) + PapaParse (csv) + TextDecoder('windows-1252')
   engine.mjs → normaliza, resuelve schema-drift/headers-dup, matchea SKU→buyer,
                excluye cancel/devol, dedup, agrega
        │  (1) render inmediato del tablero      (2) manda LÍNEAS al backend
        ▼                                              ▼
   tablero actualizado                        [ APPS SCRIPT ]  doPost
   (solo agregados, liviano)                   ├─ append a Google Sheet "Ventas" (DB/histórico, dedup por clave)
                                               ├─ recomputa Sheet "Rollup" (mes×canal×persona)
                                               └─ archiva el xlsx crudo en carpeta Drive (auditoría)
        ▲                                              │
        └──────── getRollup(mes, canal) ◄──────────────┘   ← el filtro por mes lee de acá
```

### Por qué así (y por qué NO las otras variantes)
- **Parsear en el browser, no en Apps Script.** Apps Script tiene límite de 6 min y memoria acotada; parsear xlsx de 15 MB / ~96k filas ahí es frágil. El browser (SheetJS) lo hace sin límites y da feedback instantáneo. → descarta la variante "Leonardo deja el archivo en Drive y Apps Script lo procesa solo".
- **El HTML nunca embebe las ~100k filas crudas** (sería pesadísimo, tal cual dijiste). Solo pide el **rollup agregado** (mes × canal × persona = unos cientos de filas). Por eso el filtro por mes es instantáneo.
- **El "Excel en Drive" = un Google Sheet "Ventas"**, no un .xlsx. Es consultable, versionado y filtrable. Los .xlsx crudos se archivan aparte para auditoría.
- **El maestro SKU→buyer vive en un Sheet** que la agencia edita; actualizar el mapeo NO requiere redeploy.
- **Hosting:** Google Apps Script Web App (todo en Google, un solo login para Leonardo, cero infra). Alternativa equivalente en costo: host estático (Netlify/GitHub Pages) + Apps Script solo de backend — el frontend es portable, solo cambian las llamadas al backend. **← confirmar antes de escribir la capa Apps Script.**
- La **API de MeLi/TN queda para Fase 2** (ver `../Tablero Buyer Naku/PLAN-Integracion-Dashboard-Naku.md`). Esta Fase 1 sigue siendo necesaria igual porque la API de MeLi solo retiene 12 meses.

## Modelo de datos

**Línea de venta** (grano fino, va al Sheet "Ventas"): `canal, order_id, fecha, mes, sku_raw, sku, buyer, match_method, unidades, facturacion, cuotas, provincia, estado_orden, billable, source_file`.
Clave de dedup: `canal|order_id|sku|unidades|facturacion`.

**Rollup** (lo que consume el tablero): por persona → facturacion, unidades, ordenes, ticket, cuotas, share%; + `topByPersona[]` (familias ordenadas por $, cada una con sus productos para expandir); + `porMesCanalPersona[]`; + `unmapped[]` (ordenado por $) + totales/cobertura.

### Display de productos (pedido del cliente)
- **Nombre, no SKU.** Cada línea carga `nombre` (del maestro; fallback al título del canal, último recurso el SKU). El tablero muestra nombre grande + SKU chiquito.
- **Agrupación por familia + drill-down.** El "Top productos" por persona se agrupa por `familia`; al hacer clic se expanden los SKU de esa familia (`topByPersona[p][i].productos`).
- **`Familia` es una columna editable del maestro** (decisión editorial de la agencia). Default automático si está vacía: último nodo limpio de `Categorías` → prefijo alfabético del SKU → `Otros`. Ej: los SM-C*/SS-* de soporte caen en "Monitor"; los 22D-BEL* en "Escritorios ergonómicos".
- Regla fina: si un SKU aparece en el maestro dentro de un combo Y suelto, la fila **suelta** gana el nombre/familia (mejor para mostrar), sin cambiar el buyer.

### Maestro (Sheet editable por la agencia) — columnas
`SKU · Buyer Persona · Nombre · Categorías · Familia (opcional) · [otras]`. La agencia completa `Buyer Persona` de los "Sin asignar" y, si quiere, ajusta `Familia` para agrupar a gusto.

## Estado

- [x] **`src/engine.mjs`** — motor puro (normalización + matching + agregación + nombre/familia + `topByPersona` con drill-down). Host-independiente.
- [x] **Validado contra datos reales** (17/17 tests): reconcilia MeLi vs targets con Δ<1% (Juan/Martin/Mariana/Lucho/Mario), cobertura 91% facturación; TN e2e cobertura 97,6%; schema-drift 67/64 col resuelto por nombre; cancel/devol excluido; dedup OK.
- [ ] Sanitizador del maestro → `sku_buyer_map` (colapsa `Buyer Persona` duplicada, splitea 26 combos). *La lógica ya vive en `buildMaestro()`; falta el export one-time al Sheet.*
- [ ] Capa Apps Script (`appsscript/`): `doGet` sirve HTML, `doPost` guarda líneas + archiva, `getRollup`, `getMaestro`. **Bloqueado por confirmación de hosting.**
- [ ] Refactor del dashboard (`web/Index.html`) desde `naku-buyer-personas.html`: `data-attributes` + `render.js` + panel de carga (dropdown/upload) + filtro mes/canal + charts. Diseño intacto.
- [ ] Reporte `unmapped_skus` visible para que la agencia complete el maestro (loop de cobertura).

## Hallazgos del test que alimentan el producto
- **MeLi manda Juan; TiendaNube manda Martin (52%, ticket ~$214K).** El tablero debe mostrar breakdown por canal.
- Aliases a normalizar en el maestro: `EARTH 4S` vs `EARTH-4S`, `MP-01` vs `MP-001`. Candidatos directos para el loop de cobertura.

## Métricas de relevancia (volumen vs valor vs impacto)
Para que el "top" no lo domine un producto de mucho volumen y poca plata (el caso escarbadientes-vs-escritorio), cada producto/familia trae las **tres lentes**:
- `unidades` = volumen · `precioProm` = densidad de valor (fact/unid) · `facturacion` = **impacto** (manda el ranking).
- La cola larga se colapsa; el toggle Facturación/Unidades hace visible la divergencia.
- Ejemplo real (Mariana): Zapatero ZAP-003 = 255 u pero $53 M ($208K c/u) → #2 en plata; si ordenás por unidades, desaparece.

## Hosting: DECIDIDO
Host estático (Netlify/GitHub Pages) para el HTML + **Apps Script solo de backend** (Sheets/Drive). El parseo va en el browser en ambas fases.

## Maqueta v2 (alternativa desde cero para Leonardo)
`web/tablero-v2.html` — segundo tablero, diseñado de cero, para mostrarle a Leo como opción B. Publicado como Artifact: https://claude.ai/code/artifact/df13998b-0974-47be-80e5-f5f472b9cef1
- **Subdivide** lo que hoy está junto: pestaña **Contexto** (macro, voz serif editorial) vs **El negocio** (instrumento, voz grotesca+mono). Estética "hoja técnica".
- Datos **reales** (snapshot del motor). Interacciones reales: toggle de canal (TN pone a Martin #1), selección de persona, drill-down familia→productos, sort Facturación/Unidades.
- Aplica lo de "Monitor = pantalla": ya renombré la familia a **"Soportes de monitor"** ahí, mostrando que es editable.
- Self-contained, UTF-8, sin CDNs (CSP de Artifacts). Fuentes: system stack (Inter no carga en Artifacts).

## Herramientas de validación (repo)
- `tools/reconcile.mjs` — corre el motor sobre los 4 exports reales, reconcilia MeLi vs targets (Δ<1% e2e) y consolida MeLi+TN. Requiere `npm i` (xlsx).
- `tools/snapshot.mjs` — genera `web/data/snapshot.json` (personas→familias→productos) que alimenta la maqueta.

## Backend Apps Script (LISTO, a deployar)
`appsscript/Code.gs` + `appsscript/appsscript.json` + `appsscript/README.md` (setup paso a paso) + `web/api.js` (cliente).
- El browser parsea con el motor y manda **líneas** vía `NakuApi.saveLines()` (chunked, POST text/plain para evitar preflight CORS). Backend: dedup por clave, append a Sheet `Ventas`, recomputa rollup a `Meta!A1`, lo sirve con `getRollup()`. `getMaestro()` baja el maestro editable.
- `aggregateInto()` en Code.gs es un **port de `engine.aggregate`** — mantener en sync.
- Falta: crear el Sheet/proyecto, completar `CONFIG` (SPREADSHEET_ID, TOKEN), deployar como Web App y setear `NakuApi.base/token`. Se hace cuando lleguen los exports de Leo.

## Complementarios / cross-sell (LISTO en motor + v2)
Señal de co-compra baja (0,4% órdenes multi-ítem) → la feature usa 3 señales honestas:
1. **Combos naturales** (`engine.bundlesByPersona`): pares co-comprados reales (Martin: soporte monitor→escritorio 9×; Mariana: organizador→perchas 8×).
2. **Familias flojas del perfil**: las de bajo share dentro de la persona (ya visible en el top).
3. **"Deberías ofrecerle"**: lista EDITABLE de la agencia (mouse/teclado/sillas para Martin, etc.) — no sale de los datos, es sugerencia de marketing.
En la v2, panel "Complementarios" por persona.

## Deploy: switch de 2 versiones (LISTO)
`docs/` = fuente para **GitHub Pages** (Pages → serve from `/docs`).
- `docs/index.html` — switcher: barra + iframe, alterna por URL `?v=leo` / `?v=nueva`, para que Leo compare y elija.
- `docs/leo.html` (deck original de Leo) · `docs/nueva.html` (la v2). Copias; re-copiar al actualizar.

## Próximo paso (plan del usuario)
1. **Esperar los exports frescos de Leo** → correr `tools/reconcile.mjs` para confirmar que el esquema no cambió.
2. **Deployar** `docs/` en GitHub Pages y el `Code.gs` como Web App; conectar `api.js`.
3. Leo compara versiones en la URL → elegimos la ganadora y la dejamos activa.
4. Instrumentar la versión elegida con `getRollup()` (datos en vivo) — hoy la v2 usa snapshot embebido; pasa a `fetch`.
