/* ============================================================
   Actualizar datos desde el navegador.

   Cuatro zonas, una por fuente. Se procesa acá mismo: los archivos no salen de
   esta computadora. Lo que se calcula es exactamente lo mismo que calcula el
   build —es el mismo motor, ver tools/build-importer.mjs—, así que los números
   coinciden con los publicados.

   Los archivos no salen de esta computadora: se leen acá y lo único que sale
   es el resultado, cuando se toca "Publicar para todos". Eso lo guarda en la
   base (ver neon/api/) y a partir de ahí lo ve cualquiera que abra el tablero.
   Publicar pide una clave; leer, no.
   ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);
  const M = window.NakuMotor;
  if (!M) return;                       // sin motor, el botón no aparece

  const ZONAS = [
    {
      id: 'meli', titulo: 'Mercado Libre', acepta: '.xlsx',
      pista: 'Ventas AR — uno o varios meses', varios: true, tipo: 'ventas',
    },
    {
      id: 'tn', titulo: 'Tienda Nube', acepta: '.csv',
      pista: 'Export de órdenes', varios: true, tipo: 'ventas',
    },
    {
      id: 'costos', titulo: 'Costos', acepta: '.xlsx',
      pista: 'Planilla madre de compras', varios: false, tipo: 'apoyo',
    },
    {
      id: 'central', titulo: 'Atención al cliente', acepta: '.xlsx',
      pista: 'Export del sheet de la central', varios: false, tipo: 'apoyo',
    },
  ];

  const elegidos = {};                  // id de zona -> File[]
  let ultimoJson = null;

  /* ---------------------------------------------------------------- panel */
  function abrir() {
    $('impFondo').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function cerrar() {
    $('impFondo').hidden = true;
    document.body.style.overflow = '';
  }

  function pintarZonas() {
    $('impZonas').innerHTML = ZONAS.map((z) => `
      <div class="imp-zona${z.tipo === 'apoyo' ? ' apoyo' : ''}" data-zona="${z.id}">
        <div class="imp-cab">
          <b>${z.titulo}</b>
          <span>${z.pista}</span>
        </div>
        <label class="imp-drop" data-drop="${z.id}">
          <input type="file" accept="${z.acepta}" ${z.varios ? 'multiple' : ''} hidden>
          <span class="imp-vacio">Arrastrá el archivo o tocá acá</span>
          <span class="imp-lleno" hidden></span>
        </label>
      </div>`).join('');

    ZONAS.forEach((z) => {
      const drop = $('impZonas').querySelector(`[data-drop="${z.id}"]`);
      const input = drop.querySelector('input');
      input.addEventListener('change', () => tomar(z, [...input.files]));
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault(); drop.classList.add('encima');
      }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault(); drop.classList.remove('encima');
      }));
      drop.addEventListener('drop', (e) => tomar(z, [...e.dataTransfer.files]));
    });
  }

  function tomar(zona, archivos) {
    const validos = archivos.filter((f) => f.name.toLowerCase().endsWith(zona.acepta));
    if (!validos.length) {
      estado(`En "${zona.titulo}" va un archivo ${zona.acepta}, no ${archivos[0] ? archivos[0].name : 'eso'}.`, 'mal');
      return;
    }
    elegidos[zona.id] = zona.varios ? validos : [validos[0]];
    const drop = $('impZonas').querySelector(`[data-drop="${zona.id}"]`);
    drop.classList.add('cargado');
    drop.querySelector('.imp-vacio').hidden = true;
    const lleno = drop.querySelector('.imp-lleno');
    lleno.hidden = false;
    lleno.textContent = elegidos[zona.id].length === 1
      ? elegidos[zona.id][0].name
      : `${elegidos[zona.id].length} archivos`;
    revisarListo();
    estado('');
  }

  function revisarListo() {
    const hayVentas = (elegidos.meli || []).length || (elegidos.tn || []).length;
    $('impProcesar').disabled = !hayVentas;
    $('impNota').textContent = hayVentas
      ? ''
      : 'Hace falta al menos un export de ventas — Mercado Libre o Tienda Nube.';
  }

  function estado(texto, clase = '') {
    const el = $('impEstado');
    el.textContent = texto;
    el.className = `imp-estado ${clase}`;
  }

  /* ---------------------------------------------------------------- leer archivos */
  const leerBuffer = (f) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(new Uint8Array(r.result));
    r.onerror = () => rej(new Error(`no pude leer ${f.name}`));
    r.readAsArrayBuffer(f);
  });
  /** Los exports de TiendaNube salen en cp1252; latin1 alcanza para los acentos. */
  const leerTextoLatin1 = (f) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error(`no pude leer ${f.name}`));
    r.readAsText(f, 'windows-1252');
  });

  function parseCSV(texto, delim = ';') {
    const filas = []; let campo = ''; let fila = []; let comilla = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (comilla) {
        if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comilla = false; } else campo += c;
      } else if (c === '"') comilla = true;
      else if (c === delim) { fila.push(campo); campo = ''; }
      else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
      else if (c !== '\r') campo += c;
    }
    if (campo.length || fila.length) { fila.push(campo); filas.push(fila); }
    return filas;
  }

  const hoja = (buf, nombre) => {
    const wb = XLSX.read(buf, { type: 'array', cellDates: nombre !== 'ventas' });
    const cual = nombre === 'ventas'
      ? (wb.SheetNames.find((n) => /ventas/i.test(n)) || wb.SheetNames[0])
      : nombre;
    if (!wb.Sheets[cual]) throw new Error(`el archivo no tiene la hoja "${nombre}"`);
    return { wb, aoa: XLSX.utils.sheet_to_json(wb.Sheets[cual], { header: 1, raw: true, defval: '' }) };
  };

  /* ---------------------------------------------------------------- procesar */
  async function procesar() {
    $('impProcesar').disabled = true;
    try {
      if (typeof XLSX === 'undefined') {
        throw new Error('no se pudo cargar el lector de Excel. Revisá la conexión y recargá la página.');
      }

      /* costos: los del archivo si lo cargaron, si no los que ya venían */
      estado('Leyendo los costos…');
      let costos; let mesCostos = M.mesCostos;
      if (elegidos.costos) {
        const buf = await leerBuffer(elegidos.costos[0]);
        const wb = XLSX.read(buf, { type: 'array' });
        const cand = M.costos.hojasPorMes(wb.SheetNames)[0];
        if (!cand) throw new Error('la planilla de costos no tiene ninguna hoja con nombre de mes');
        costos = M.costos.buildCostos(
          XLSX.utils.sheet_to_json(wb.Sheets[cand.hoja], { header: 1, raw: true, defval: '' }),
          cand.hoja, cand.mes,
        );
        mesCostos = cand.hoja;
      } else {
        costos = { costo: new Map(M.costosPares), hoja: M.mesCostos, mes: '' };
      }
      const costoDe = M.costos.makeCostMatcher(costos);

      /* maestro: nombre y familia por SKU */
      const maestro = M.engine.buildMaestro(parseCSV(M.maestroCSV, ';'));
      const match = M.engine.makeMatcher(maestro);

      /* ventas */
      const mapasMl = []; const mapasTn = [];
      for (const f of (elegidos.meli || [])) {
        estado(`Procesando ${f.name}…`);
        await pausa();
        const { aoa } = hoja(await leerBuffer(f), 'ventas');
        mapasMl.push(M.finanzas.ingestFinanzasMeli(aoa, costoDe, match));
      }
      for (const f of (elegidos.tn || [])) {
        estado(`Procesando ${f.name}…`);
        await pausa();
        mapasTn.push(M.finanzas.ingestFinanzasTn(parseCSV(await leerTextoLatin1(f), ';'), costoDe, match));
      }

      /* central de atención */
      let central = null;
      if (elegidos.central) {
        estado('Leyendo la central de atención…');
        const buf = await leerBuffer(elegidos.central[0]);
        central = {
          postventa: hoja(buf, 'Postventa').aoa,
          minorista: hoja(buf, 'Preventa Minorista').aoa,
          volumen: hoja(buf, 'Preventa Volumen').aoa,
        };
      }

      estado('Armando el tablero…');
      await pausa();

      /* Postventa: la del archivo si lo cargaron, si no la que ya traía el
         tablero — sus casos son de otro período, no dependen del export. */
      let post = (window.NakuDatos || {}).clientes || null;
      if (central) {
        const ordenesPorMes = {};   // se completa abajo, cuando estén los meses
        const porCanal = {
          todos: M.postventa.buildPostventa(central.postventa, central.minorista, central.volumen, ordenesPorMes, 'todos'),
          ml: M.postventa.buildPostventa(central.postventa, central.minorista, central.volumen, ordenesPorMes, 'Mercado Libre'),
          tn: M.postventa.buildPostventa(central.postventa, central.minorista, central.volumen, ordenesPorMes, 'Tienda Nube'),
        };
        post = porCanal.todos ? { ...porCanal.todos, porCanal } : null;
      }

      const armado = M.tablero.armarTablero({
        mapasMl, mapasTn, post,
        meta: {
          fuentes: {
            origen: { ventas: { origen: 'navegador' } },
            costos: { archivo: elegidos.costos ? elegidos.costos[0].name : '(embebido)', hoja: mesCostos, skus: costos.costo.size },
            ventas: {
              meli: (elegidos.meli || []).map((f) => f.name),
              tiendanube: (elegidos.tn || []).map((f) => f.name),
              meses: [],
            },
            postventa: elegidos.central ? { archivo: elegidos.central[0].name, corte: post ? post.corte : '' } : null,
          },
        },
      });
      if (!armado.ok) throw new Error(armado.error);
      const D = armado.tablero;
      D.fuentes.ventas.meses = D.serie.map((x) => x.mes);

      ultimoJson = D;
      window.NakuDatos = D;
      window.NakuPintar(D);

      const e = D.vistas.todos.mes.eerr;
      const mb = e.lineas.find((l) => l.c === 'Margen bruto');
      estado(`Listo: ${D.mesCerrado.largo}, ${e.ordenes.toLocaleString('es-AR')} órdenes, `
        + `margen bruto ${String(mb.pct).replace('.', ',')}%.`, 'bien');
      $('impPublicar').hidden = false;
      $('impBajar').hidden = false;
      pedirClaveSiHace();
      $('impCerrarPie').textContent = 'Ver el tablero';
    } catch (err) {
      estado(err.message || String(err), 'mal');
    } finally {
      $('impProcesar').disabled = false;
    }
  }

  /** Deja respirar al navegador para que se vea el cartel de progreso. */
  const pausa = () => new Promise((r) => setTimeout(r, 16));

  /* ------------------------------------------------------------- publicar
     La clave y el nombre viven en este navegador. La clave no está en la
     página: sin ella se puede mirar el tablero, no cambiarlo. */
  const recordado = (k) => { try { return localStorage.getItem('naku.' + k) || ''; } catch { return ''; } };
  const recordar = (k, v) => { try { localStorage.setItem('naku.' + k, v); } catch { /* modo privado */ } };

  /* La clave puede venir en el link:
       …/direccion.html#clave=naku-xxxx&quien=Leo
     Así el que carga exports no la escribe nunca: abre el link que le mandaron y
     listo. El link público —el mismo, sin esa parte— sigue siendo de sólo lectura.
     El fragmento no viaja al servidor, no queda en ningún log. */
  function claveDelLink() {
    const h = location.hash;
    if (!h) return;
    const clave = (/[#&]clave=([^&]+)/.exec(h) || [])[1];
    const quien = (/[#&]quien=([^&]+)/.exec(h) || [])[1];
    if (!clave && !quien) return;
    try {
      if (clave) recordar('clave', decodeURIComponent(clave));
      if (quien) recordar('quien', decodeURIComponent(quien));
    } catch { /* modo privado: se la va a tener que escribir */ }
    // Se saca de la barra para que no quede a la vista ni en el historial.
    history.replaceState(null, '', location.pathname + location.search);
  }

  function pedirClaveSiHace() {
    $('impClaveInput').value = recordado('clave');
    $('impQuienInput').value = recordado('quien');
    $('impClave').classList.toggle('pide', !$('impClaveInput').value || !$('impQuienInput').value);
  }

  async function publicar() {
    if (!ultimoJson) return;
    const clave = $('impClaveInput').value.trim() || recordado('clave');
    const quien = $('impQuienInput').value.trim() || recordado('quien');
    if (!clave) {
      $('impClave').classList.add('pide');
      $('impClaveInput').focus();
      estado('Falta la clave para publicar.', 'mal');
      return;
    }

    $('impPublicar').disabled = true;
    estado('Publicando…');
    try {
      const r = await fetch(window.NakuAPI + '/', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-naku-clave': clave,
          'x-naku-quien': quien,
        },
        body: JSON.stringify(ultimoJson),
        signal: AbortSignal.timeout(60000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) {
        // La clave guardada no sirve más: que la vuelva a escribir.
        recordar('clave', '');
        $('impClave').classList.add('pide');
        $('impClaveInput').value = '';
        $('impClaveInput').focus();
        throw new Error('Clave incorrecta.');
      }
      if (!r.ok || !j.ok) throw new Error(j.error || `La base contestó ${r.status}.`);

      recordar('clave', clave);
      recordar('quien', quien);
      $('impClave').classList.remove('pide');
      window.NakuPublicado = { publicado: j.publicado, quien: j.quien };
      window.NakuPintar(ultimoJson);     // repinta el pie con quién publicó
      estado('Publicado. Ya lo ven todos los que abran el tablero.', 'bien');
      $('impPublicar').textContent = 'Publicado ✓';
    } catch (err) {
      estado(err.name === 'TimeoutError'
        ? 'La base tardó demasiado. Probá de nuevo.'
        : (err.message || String(err)), 'mal');
    } finally {
      $('impPublicar').disabled = false;
    }
  }

  function bajar() {
    if (!ultimoJson) return;
    const blob = new Blob([JSON.stringify(ultimoJson, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'direccion.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------------------------------------------------------------- cablear */
  $('btnActualizar').hidden = false;
  $('btnActualizar').addEventListener('click', abrir);
  $('impCerrar').addEventListener('click', cerrar);
  $('impCerrarPie').addEventListener('click', cerrar);
  $('impFondo').addEventListener('click', (e) => { if (e.target === $('impFondo')) cerrar(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('impFondo').hidden) cerrar(); });
  $('impProcesar').addEventListener('click', procesar);
  $('impPublicar').addEventListener('click', publicar);
  $('impBajar').addEventListener('click', bajar);
  // Si vuelve a procesar después de publicar, el botón tiene que dejar de decir
  // "Publicado ✓": lo que hay cargado ya no es lo que está publicado.
  $('impProcesar').addEventListener('click', () => {
    $('impPublicar').textContent = 'Publicar para todos';
  });
  claveDelLink();
  pintarZonas();
  revisarListo();
})();
