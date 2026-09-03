# Central de atención — tres campos que faltan cargar

Sobre los 849 casos de postventa y 731 de preventa minorista al 03/09/2026. Los
tres bloquean indicadores del tablero de dirección, así que hoy el tablero los
muestra como pendientes en vez de un número inventado.

Ordenados por lo que arreglan vs. lo que cuestan.

---

## 1. `Fecha de cierre` — nunca se llena (0 de 849)

**El problema.** La columna existe en el esquema (`['cierre', 'Fecha de cierre']`)
pero **no está entre las etapas del embudo**, así que la app nunca la muestra ni la
marca, y `guardarCaso()` tampoco la sella. Quedan 750 casos con estatus
`Resuelto …` y la fecha de cierre vacía.

**Qué se pierde:** tiempo de resolución, y la evolución mes a mes de la cola de
casos abiertos (el gráfico de tendencia del tablero).

**El arreglo.** En `Codigo.gs`, dentro de `guardarCaso()`, después de la línea:

```js
    if (!caso.id) caso.alta = ahora.toISOString();
```

agregar:

```js
    // La fecha de cierre la sella el servidor cuando el caso sale de "abierto",
    // y se borra si vuelve a abrirse. Así no depende de que nadie se acuerde.
    const CERRADO = {
      postventa: /^Resuelto/,
      minorista: /^(Ganado|Perdido)$/,
      volumen:   /^(Ganado|Perdido)$/
    };
    if (CERRADO[clave] && CERRADO[clave].test(String(caso.estatus || ''))) {
      if (!caso.cierre) caso.cierre = ahora.toISOString();
    } else {
      caso.cierre = '';
    }
```

Sirve para los tres embudos, no sólo postventa. No cambia nada de lo que ve el
operador: se llena solo al guardar.

### Y los 750 que ya están cerrados

El parche de arriba sólo actúa de acá en adelante. Para no perder el historial,
esta función completa una vez los que ya están cerrados usando la última
actualización como aproximación. Se pega al final de `Codigo.gs` y se ejecuta
**una sola vez** desde el editor:

```js
/**
 * Una sola vez: completa la fecha de cierre de los casos ya cerrados, usando la
 * última actualización como aproximación. No toca los que ya la tienen ni los
 * que siguen abiertos, así que correrla dos veces no hace daño.
 */
function completarCierresViejos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const CERRADO = {
    postventa: /^Resuelto/,
    minorista: /^(Ganado|Perdido)$/,
    volumen:   /^(Ganado|Perdido)$/
  };
  const informe = [];

  Object.keys(ESQUEMAS).forEach(function (clave) {
    const esquema = ESQUEMAS[clave];
    const hoja = ss.getSheetByName(esquema.hoja);
    if (!hoja || hoja.getLastRow() < 2) { informe.push('· ' + esquema.hoja + ': vacía.'); return; }

    const iEst = indiceDe_(esquema, 'estatus');
    const iCie = indiceDe_(esquema, 'cierre');
    const iAct = indiceDe_(esquema, 'actualizado');
    if (iEst < 0 || iCie < 0 || iAct < 0) {
      informe.push('· ' + esquema.hoja + ': faltan columnas, correr sincronizarEstructura() primero.');
      return;
    }

    const rango = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn());
    const datos = rango.getValues();
    let n = 0;
    datos.forEach(function (f) {
      if (!f[0]) return;                                          // fila vacía
      if (!CERRADO[clave].test(String(f[iEst] || ''))) return;    // sigue abierto
      if (String(f[iCie] || '').trim() !== '') return;            // ya la tiene
      if (!f[iAct]) return;                                       // sin referencia
      f[iCie] = f[iAct];
      n++;
    });
    if (n) rango.setValues(datos);
    informe.push('· ' + esquema.hoja + ': ' + n + ' cierre(s) completado(s).');
  });

  avisar_('Listo.\n\n' + informe.join('\n') +
    '\n\nSe usó la última actualización como fecha de cierre aproximada.');
}
```

---

## 2. `3· Contactado` — se marca junto con el alta

**El problema.** Esto **no es un bug del código**: es de uso. La app estampa la
hora del click (`Marcar ahora`) y el operador toca todas las etapas de una cuando
carga el caso. La mediana de ingreso→contactado da **medio minuto**, y en varios
casos la marca queda *anterior* al alta.

Datos: 644 de 837 casos tienen menos de 1 hora entre ingreso y contactado.

**Qué se pierde:** el tiempo de primera respuesta, que es el indicador de
servicio más importante que tendría el tablero.

**El arreglo.** Una vez marcada, la etapa **ya es un campo editable**
(`<input type="datetime-local">`); el tema es que nadie lo corrige. Dos cambios
chicos en `Index.html`, en la definición de `EMBUDOS.postventa.etapas`:

```js
// antes
{campo:'contactado', tipo:'fecha', nombre:'Contactado', pista:'Le mandamos el primer mensaje'},

// después — la misma redacción que ya usa 'ingreso', que sí se corrige
{campo:'contactado', tipo:'fecha', nombre:'Contactado',
 pista:'Cuándo le escribimos por primera vez. Si le respondimos antes de cargar el caso, corregí la hora acá.'},
```

Y lo mismo en los otros dos embudos para `respondido`.

Si querés algo más firme que una pista: un aviso cuando `contactado` cae dentro
de los 5 minutos del alta, en el mismo lugar donde ya se validan los campos
obligatorios.

---

## 3. Estatus de preventa — queda en el inicial (653 de 683)

**El problema.** `estatusPreventa` es
`['Pregunta Meli', 'En seguimiento', 'Ganado', 'Perdido']` y 653 de las 683
consultas de agosto siguen en `Pregunta Meli`. Como `abiertos` es
`c.estatus !== 'Ganado' && c.estatus !== 'Perdido'`, esas consultas figuran
abiertas para siempre. Sólo 9 quedaron en `Ganado` y **ninguna** en `Perdido`.

**Qué se pierde:** la conversión del embudo. Hoy el tablero muestra las etapas de
arriba (consultas recibidas → respondidas → con seguimiento, que sí se cargan) y
avisa que el resultado no está cargado. Informar "1,2% de conversión" sería
mentir: no es que pierdan, es que no se registra.

**El arreglo.** No hace falta código nuevo: la app ya tiene la regla de
seguimiento a 48 h (`SLA = { seguimiento: 48 }`) y una lista de pendientes.
Alcanza con que una consulta que pasó el seguimiento y sigue en `Pregunta Meli`
aparezca en esa lista de pendientes hasta que alguien la marque
`Ganado` o `Perdido`.

Es más un acuerdo de trabajo que un cambio técnico: alguien tiene que cerrar el
estatus. Con eso el embudo se completa solo.

---

## Después de aplicar los parches

Regenerar el tablero con el export nuevo del Sheet:

```bash
node tools/build-direccion.mjs
```

El tablero deja de mostrar los avisos de "falta cargar" y aparecen: tiempo de
primera respuesta, días hasta el cierre, la evolución de la cola de casos
abiertos mes a mes y la conversión del embudo de preventa.
