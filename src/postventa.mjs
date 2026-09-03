// postventa.mjs — indicadores de la central de atención al cliente.
//
// Fuente: el Google Sheet que maneja la app de Apps Script (hojas 'Postventa',
// 'Preventa Minorista', 'Preventa Volumen'). Se lee por NOMBRE de columna: la
// app agrega columnas con sincronizarEstructura(), así que los índices se mueven.
//
// QUÉ SE PUEDE MEDIR Y QUÉ NO
// Tres campos que el tablero necesitaría no se están cargando, así que en vez de
// mostrar un número inventado se informan como pendientes (ver `calidad`):
//
//   'Fecha de cierre'   la sella el servidor desde septiembre 2026. Los casos
//                       cerrados antes se rellenaron con la última actualización:
//                       son APROXIMADOS, sirven para la tendencia de la cola pero
//                       no para medir cuánto tardó un caso puntual. Se detectan
//                       porque cierre y 'Última actualización' coinciden exacto.
//   '3· Contactado'     se marca junto con el alta (mediana ingreso→contactado:
//                       medio minuto, y a veces anterior al alta). Mide cuándo
//                       se cargó el caso, no cuándo se le respondió al cliente.
//   'Estatus' preventa  queda en el inicial 'Pregunta Meli' casi siempre, así
//                       que no hay resultado del embudo (ganado/perdido).
//
// Lo que sí es sólido: urgencia, tipo de reclamo, área, canal, estatus de
// postventa (abierto/resuelto) y las etapas de arriba del embudo de preventa.
//
// La fecha de referencia es el último movimiento cargado, no la fecha de hoy:
// así el snapshot da lo mismo cada vez que se regenera.

const ABIERTO = 'En gestión';
const OK = 'Resuelto satisfactoriamente';
const MAL = 'Resuelto insatisfactoriamente';
const URGENCIAS = ['Alta', 'Media', 'Baja'];
const SIN_CLASIF = 'Sin clasificar';
const CLASE = { Alta: 'alta', Media: 'media', Baja: 'baja', [SIN_CLASIF]: 'nula' };
const ORDEN_URG = [...URGENCIAS, SIN_CLASIF];
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesLegible = (mes) => `${MES_LARGO[+mes.slice(5, 7) - 1]} ${mes.slice(0, 4)}`;

const txt = (v) => (v == null ? '' : String(v).trim());
const vacia = (v) => { const s = txt(v); return s === '' || s === 'None'; };

/** Fecha de una celda: ISO del backend, Date de la lib de Excel, o nada. */
export function fecha(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = txt(v);
  if (!s || s === 'None' || s === 'NaT') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
const mesDe = (d) => (d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : '');
const dias = (a, b) => (a && b ? (b - a) / 86400000 : null);

/**
 * Mes de referencia: el último mes cerrado respecto del corte. Si el corte cae
 * en los primeros días de un mes, ese mes recién empieza y sus totales no se
 * pueden comparar contra nada — se usa el anterior.
 */
export function mesReferencia(corte) {
  const d = new Date(corte);
  if (d.getUTCDate() < 28) d.setUTCDate(0); // último día del mes anterior
  return mesDe(d);
}

/** aoa (con encabezados en la fila 0) → array de objetos por nombre de columna. */
export function filasPorNombre(aoa) {
  if (!aoa || !aoa.length) return [];
  const header = (aoa[0] || []).map(txt);
  return aoa.slice(1)
    .filter((r) => r && r.some((c) => !vacia(c)))
    .map((r) => {
      const o = {};
      header.forEach((h, j) => { if (h) o[h] = r[j]; });
      return o;
    });
}

const cuenta = (arr, fn) => {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!k || k === 'None') continue; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].map(([n, v]) => ({ n, v })).sort((a, b) => b.v - a.v);
};

/**
 * @param aoaPostventa   hoja 'Postventa'
 * @param aoaMinorista   hoja 'Preventa Minorista'
 * @param aoaVolumen     hoja 'Preventa Volumen'
 * @param ordenesPorMes  { '2026-08': 11385, … } para reclamos cada 100 órdenes
 */
export function buildPostventa(aoaPostventa, aoaMinorista, aoaVolumen, ordenesPorMes = {}) {
  const pv = filasPorNombre(aoaPostventa).map((r) => ({
    id: txt(r['Caso']),
    ingreso: fecha(r['Ingreso del mensaje']),
    alta: fecha(r['Alta del caso']),
    contactado: fecha(r['3· Contactado']),
    cierre: fecha(r['Fecha de cierre']),
    actualizado: fecha(r['Última actualización']),
    urgencia: URGENCIAS.includes(txt(r['Urgencia'])) ? txt(r['Urgencia']) : SIN_CLASIF,
    tipo: txt(r['Tipo de reclamo']) || 'Sin tipificar',
    canalVenta: txt(r['Canal de venta']),
    sku: txt(r['SKU']),
    area: txt(r['Área derivada']),
    estatus: txt(r['7· Estatus']),
    responsable: txt(r['Último responsable']),
  })).filter((r) => r.id);

  if (!pv.length) return null;

  const corte = new Date(Math.max(...pv.flatMap((r) =>
    [r.actualizado, r.alta, r.cierre, r.ingreso].filter(Boolean).map((d) => d.getTime()))));
  const mesRef = mesReferencia(corte);

  // ¿Se están cargando los campos que hacen falta para medir tiempos?
  const conCierre = pv.filter((r) => r.cierre).length;
  const resueltos = pv.filter((r) => r.estatus === OK || r.estatus === MAL);
  // Un cierre que cae al mismo instante que la última actualización viene del
  // relleno de los casos viejos, no de un cierre real: aproxima el mes, no el caso.
  const aproximado = (r) => r.cierre && r.actualizado
    && Math.abs(r.cierre - r.actualizado) < 1000;
  // Si contactado ≈ alta, la marca es del momento de la carga, no de la respuesta.
  const respuestaPropia = pv.filter((r) => r.contactado && r.alta
    && Math.abs(r.contactado - r.alta) > 30 * 60 * 1000).length;

  const cierresReales = resueltos.filter((r) => r.cierre && !aproximado(r));
  const calidad = {
    cierreCargado: resueltos.length ? +(100 * conCierre / resueltos.length).toFixed(0) : 0,
    cierreReal: resueltos.length ? +(100 * cierresReales.length / resueltos.length).toFixed(0) : 0,
    respuestaCargada: pv.length ? +(100 * respuestaPropia / pv.length).toFixed(0) : 0,
    faltantes: [],
  };
  if (calidad.cierreCargado < 20) {
    calidad.faltantes.push('Fecha de cierre: no se está cargando, así que no hay tiempo de resolución ni evolución de la cola mes a mes.');
  } else if (cierresReales.length < 30) {
    calidad.faltantes.push(`Los ${conCierre - cierresReales.length} casos cerrados antes de septiembre 2026 `
      + 'tienen una fecha de cierre aproximada (se rellenó con la última actualización). '
      + 'Sirve para la tendencia mes a mes, no para medir cuánto tardó un caso puntual.');
  }
  if (calidad.respuestaCargada < 30) {
    calidad.faltantes.push('«3· Contactado» se marca junto con el alta del caso: mide cuándo se registró, no cuándo se le respondió al cliente.');
  }

  const abiertos = pv.filter((r) => r.estatus === ABIERTO);
  const conDias = abiertos.map((r) => ({
    ...r, dias: Math.max(0, Math.floor(dias(r.ingreso || r.alta, corte) ?? 0)),
  }));
  const vencidos = conDias.filter((r) => r.urgencia === 'Alta' && r.dias >= 2).length;

  const delMes = pv.filter((r) => mesDe(r.alta || r.ingreso) === mesRef);
  const base = delMes.length ? delMes : pv;
  const resueltosBase = base.filter((r) => r.estatus === OK || r.estatus === MAL);
  const okBase = base.filter((r) => r.estatus === OK).length;

  const detalle = (u) => {
    const g = conDias.filter((r) => r.urgencia === u);
    if (!g.length) return 'Ninguno abierto';
    const viejo = Math.max(...g.map((r) => r.dias));
    if (u === SIN_CLASIF) return 'Sin urgencia cargada';
    if (u === 'Alta') {
      const v = g.filter((r) => r.dias >= 2).length;
      return v ? `${v} hace más de 48 h` : 'Ninguno pasó las 48 h';
    }
    return viejo >= 7 ? `El más viejo, ${viejo} días` : 'Todos de esta semana';
  };

  // El tiempo hasta el cierre se mide sólo con cierres reales: mezclarlos con los
  // rellenados daría una mediana que no corresponde a ninguna gestión de verdad.
  const tiempos = cierresReales
    .map((r) => dias(r.ingreso || r.alta, r.cierre))
    .filter((d) => Number.isFinite(d) && d >= 0 && d < 365)
    .sort((a, b) => a - b);
  const medianaCierre = tiempos.length >= 10
    ? (tiempos.length % 2 ? tiempos[tiempos.length >> 1]
      : (tiempos[(tiempos.length >> 1) - 1] + tiempos[tiempos.length >> 1]) / 2)
    : null;

  const ordenesRef = ordenesPorMes[mesRef] || 0;
  const kpis = [
    { n: `Ingresados en ${mesLegible(mesRef).replace(/ \d{4}$/, '')}`, v: String(base.length) },
    { n: 'Resueltos', v: String(resueltosBase.length) },
    {
      n: 'Resueltos satisfactoriamente',
      v: resueltosBase.length ? `${Math.round(100 * okBase / resueltosBase.length)}%` : '—',
    },
    { n: 'Siguen abiertos', v: String(base.filter((r) => r.estatus === ABIERTO).length) },
  ];
  if (medianaCierre != null) {
    kpis.push({ n: 'Días hasta el cierre', v: medianaCierre.toFixed(1).replace('.', ',') });
  }
  if (ordenesRef) {
    kpis.push({
      n: 'Reclamos cada 100 órdenes',
      v: (100 * base.length / ordenesRef).toFixed(1).replace('.', ','),
    });
  }

  // ---------------- preventa ----------------
  const min = filasPorNombre(aoaMinorista).map((r) => ({
    id: txt(r['Caso']),
    alta: fecha(r['Alta del caso']),
    respondido: fecha(r['2· Respondido']),
    seguimiento: fecha(r['3· Seguimiento']),
    estatus: txt(r['Estatus']),
    canal: txt(r['Canal de comunicación']),
  })).filter((r) => r.id);

  const minMes = min.filter((r) => mesDe(r.alta) === mesRef);
  const minBase = minMes.length ? minMes : min;
  const ganados = minBase.filter((r) => r.estatus === 'Ganado').length;
  const perdidos = minBase.filter((r) => r.estatus === 'Perdido').length;
  const enSeguimiento = minBase.filter((r) => r.estatus === 'En seguimiento').length;
  const sinResolver = minBase.filter((r) => !r.estatus || r.estatus === 'None' || r.estatus === 'Pregunta Meli').length;
  const resultadoConfiable = minBase.length > 0 && sinResolver / minBase.length < 0.5;

  const vol = filasPorNombre(aoaVolumen).filter((r) => txt(r['Caso']));

  return {
    corte: corte.toISOString().slice(0, 10),
    mesRef,
    mesRefLargo: mesLegible(mesRef),
    cierresAproximados: conCierre - cierresReales.length,
    calidad,
    postventa: {
      total: pv.length,
      abiertos: abiertos.length,
      vencidos,
      // Las cuatro categorías tienen que sumar los abiertos: si hay casos sin
      // urgencia cargada, aparecen como su propia luz en vez de desaparecer.
      urgencias: [...URGENCIAS, SIN_CLASIF]
        .map((u) => ({ u, n: conDias.filter((r) => r.urgencia === u).length, d: detalle(u), clase: CLASE[u] }))
        .filter((x) => x.n > 0 || x.u !== SIN_CLASIF),
      kpis,
      // Los urgentes primero y, dentro de cada urgencia, el que lleva más días.
      // 'Sin clasificar' no está en URGENCIAS: sin este orden explícito su -1 lo
      // ponía arriba de los de urgencia alta.
      casos: conDias
        .sort((a, b) => (ORDEN_URG.indexOf(a.urgencia) - ORDEN_URG.indexOf(b.urgencia)) || b.dias - a.dias)
        .slice(0, 40)
        .map((r) => ({ id: r.id, u: r.urgencia, t: r.tipo, p: r.sku || 'NO-APLICA', r: r.responsable, d: r.dias })),
      reclamos: cuenta(base, (r) => r.tipo),
      areas: cuenta(base.filter((r) => r.area), (r) => r.area),
      canales: cuenta(base, (r) => r.canalVenta),
      responsables: cuenta(base, (r) => r.responsable),
      // Sólo tiene sentido con 'Fecha de cierre' cargada; si no, el tablero la oculta.
      // Para la cola alcanza con saber en qué mes se cerró: los aproximados entran.
      cola: calidad.cierreCargado >= 20
        ? [...new Set(pv.map((r) => mesDe(r.alta || r.ingreso)).filter(Boolean))].sort().map((mes) => {
          const fin = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0, 23, 59, 59));
          return {
            mes,
            v: pv.filter((r) => {
              const ini = r.alta || r.ingreso;
              return ini && ini <= fin && (!r.cierre || r.cierre > fin);
            }).length,
          };
        })
        : null,
    },
    preventa: {
      minorista: {
        total: minBase.length,
        resultadoConfiable,
        etapas: [
          { e: 'Consultas recibidas', v: minBase.length, clase: '' },
          { e: 'Respondidas', v: minBase.filter((r) => r.respondido).length, clase: '' },
          { e: 'Con seguimiento', v: minBase.filter((r) => r.seguimiento).length, clase: '' },
          ...(resultadoConfiable ? [
            { e: '→ Ganadas', v: ganados, clase: 'gana' },
            { e: '→ En seguimiento', v: enSeguimiento, clase: '' },
            { e: '→ Perdidas', v: perdidos, clase: 'pierde' },
          ] : []),
        ],
        sinResolver,
        ganados,
        perdidos,
        canales: cuenta(minBase, (r) => r.canal),
      },
      volumen: { casos: vol.length },
    },
  };
}
