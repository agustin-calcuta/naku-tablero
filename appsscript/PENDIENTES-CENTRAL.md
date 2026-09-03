# Central de atención — estado de los tres campos

Los tres bloqueaban indicadores del tablero de dirección. **Los tres ya están
resueltos en el Apps Script** (Denise, septiembre 2026). Este documento queda
como registro de qué se cambió y de los dos pendientes que no son de código.

---

## 1. `Fecha de cierre` — RESUELTO

**Estaba:** vacía en los 849 casos, incluidos los 750 con estatus `Resuelto …`.
La columna existía en el esquema pero no estaba entre las etapas del embudo, así
que la app nunca la mostraba y `guardarCaso()` tampoco la sellaba.

**Quedó:** la sella el servidor cuando el estatus pasa a `Resuelto`, `Ganado` o
`Perdido`, y la borra si el caso se reabre. Los operadores no ven ningún cambio.
El criterio de "cerrado" vive en una sola constante que usan las dos funciones,
para que no se desincronicen si mañana agregan un estatus. El relleno de los
casos viejos escribe únicamente la columna de cierre en vez de reescribir la
planilla entera: con 849 filas, reescribir todo es lento y arriesga que una celda
con un valor viejo choque contra las validaciones.

### ⚠️ Los 750 cierres viejos son aproximados

El relleno usó la última actualización como fecha de cierre. **Sirve para ver
tendencias mes a mes, no para auditar un caso puntual.** Hay que decírselo a
quien mire el tablero, porque si no alguien va a abrir un caso y no le va a
cerrar la fecha.

El tablero ya los distingue: un cierre que cae al mismo instante que la última
actualización se marca como aproximado, y el indicador de **días hasta el
cierre** se calcula sólo con los cierres reales — mezclarlos daría una mediana
que no corresponde a ninguna gestión de verdad. La evolución de la cola mes a mes
sí los usa, porque ahí sólo hace falta saber en qué mes se cerró.

Ese indicador aparece cuando haya al menos diez cierres reales, o sea después de
un par de semanas de operación con el parche puesto.

---

## 2. `3· Contactado` — RESUELTO

**Estaba:** se marcaba junto con el alta. La mediana de ingreso→contactado daba
medio minuto y en varios casos la marca quedaba anterior al alta. No era un bug
de código: el operador tocaba "Marcar ahora" en todas las etapas al cargar el
caso.

**Quedó:** la misma redacción de pista que ya funciona en `ingreso`, más un aviso
ámbar que aparece sólo cuando la marca queda a menos de cinco minutos del alta
("Quedó a la misma hora que la carga del caso. Si le escribiste antes,
corregilo."). No bloquea nada: el software empuja sin trabar.

---

## 3. Estatus de preventa — RESUELTO en la app, pendiente de acuerdo

**Estaba:** 653 de 683 consultas de agosto quedaban en el inicial
`Pregunta Meli`. Una vez marcado el seguimiento, esos casos desaparecían de la
fila del día y quedaban abiertos para siempre.

**Quedó:** una caja ámbar clickeable en el tablero de la central — "653 ya se les
hizo seguimiento y siguen sin marcar Ganado o Perdido" — más una columna nueva en
el checklist de traspaso. Quedan fuera de la fila del día a propósito: 653 casos
ahí taparían los rojos de postventa y romperían el uso diario.

### ⚠️ Lo que falta no es código

Alguien tiene que decidir que cerrar el estatus es parte del trabajo. Con 653
acumulados, el plan propuesto es acordar con Ivi que **los de agosto se cierran
en tanda** (el filtro por estatus los agrupa) y **de septiembre en adelante se
cierra al día**.

Hasta que eso pase, el tablero de dirección muestra las etapas de arriba del
embudo (consultas recibidas → respondidas → con seguimiento, que sí se cargan) y
avisa que el resultado no está cargado. Informar "1,2% de conversión" sería
mentir: no es que pierdan, es que no se registra.

---

## Para que el tablero tome los cambios

Exportar el Sheet de la central a `../Naku Datos/Embudos_NAKU.xlsx` y correr:

```bash
node tools/build-direccion.mjs
```

Aparecen: días hasta el cierre (con cierres reales), la evolución de la cola de
casos abiertos mes a mes, y — cuando se cierren los estatus — la conversión del
embudo de preventa.
