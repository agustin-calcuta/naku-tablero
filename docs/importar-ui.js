/* Ventas compartidas: los exports de MeLi/TN se procesan en el servidor para
   actualizar Buyer y Finanzas juntos. Costos y central sólo se editan acá. */
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
  let pendingOperation = null;
  let publishing = false;

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
    ultimoJson = null;
    pendingOperation = null;
    $('impPublicar').hidden = true;
    $('impBajar').hidden = true;
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
    const hayVentas = Object.values(elegidos).some(files=>files.length);
    $('impProcesar').disabled = !hayVentas;
    $('impNota').textContent = hayVentas
      ? 'Al publicar, las ventas se actualizan también en el Buyer.'
      : 'Los exports de MeLi y TN se comparten con el Buyer. También podés actualizar sólo costos o atención al cliente.';
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
    if(publishing)return;
    publishing=true;$('impProcesar').disabled=true;ultimoJson=null;pendingOperation=null;
    $('impPublicar').hidden=true;$('impBajar').hidden=true;
    try {
      if(typeof XLSX==='undefined')throw new Error('No se pudo cargar el lector de Excel. Revisá la conexión.');
      const operation={id:crypto.randomUUID(),exports:[],nombre:'Carga desde Finanzas'};
      for(const f of elegidos.meli||[]) {
        estado('Leyendo '+f.name+'…');await pausa();
        operation.exports.push(window.NakuVentas.cleanExport('ml',hoja(await leerBuffer(f),'ventas').aoa,f.name));
      }
      for(const f of elegidos.tn||[]) {
        estado('Leyendo '+f.name+'…');await pausa();
        const bytes=await f.arrayBuffer();let text;
        try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1252').decode(bytes);}
        const rows=[';',','].map(d=>window.NakuBuyer.parseCSV(text,d)).sort((a,b)=>(b[0]?.length||0)-(a[0]?.length||0))[0];
        operation.exports.push(window.NakuVentas.cleanExport('tn',rows,f.name));
      }
      if(elegidos.costos) {
        const wb=XLSX.read(await leerBuffer(elegidos.costos[0]),{type:'array'});
        const cand=M.costos.hojasPorMes(wb.SheetNames)[0];
        if(!cand)throw new Error('La planilla de costos no tiene una hoja con nombre de mes.');
        const costs=M.costos.buildCostos(XLSX.utils.sheet_to_json(wb.Sheets[cand.hoja],{header:1,raw:true,defval:''}),cand.hoja,cand.mes);
        operation.costos={pares:[...costs.costo],hoja:cand.hoja,mes:cand.mes,archivo:elegidos.costos[0].name};
      }
      if(elegidos.central) {
        const buf=await leerBuffer(elegidos.central[0]);
        operation.central={postventa:hoja(buf,'Postventa').aoa,minorista:hoja(buf,'Preventa Minorista').aoa,volumen:hoja(buf,'Preventa Volumen').aoa};
      }
      estado('Calculando la vista previa con el histórico compartido…');
      window.NakuBuyerSync.setKey(window.NakuClave.leer('clave'));
      const r=await window.NakuBuyerSync.request('/preview',operation);
      ultimoJson=r.finance;pendingOperation=operation;
      window.NakuPintar(ultimoJson);
      estado('Vista previa lista. Publicar actualiza las ventas en Buyer y Finanzas para todos.','bien');
      $('impPublicar').hidden=false;$('impBajar').hidden=false;pedirNombreSiHace();
      $('impCerrarPie').textContent='Ver la vista previa';
    }catch(e){estado(e.message||String(e),'mal');}
    finally{publishing=false;$('impProcesar').disabled=false;}
  }

  /** Deja respirar al navegador para que se vea el cartel de progreso. */
  const pausa = () => new Promise((r) => setTimeout(r, 16));

  /* ------------------------------------------------------------- publicar
     Acá no se pide clave: si estás viendo esta pantalla es porque ya entraste, y
     la misma clave que abre el tablero deja publicar. La maneja direccion.html
     (window.NakuClave), que es quien la necesita primero. Lo único que se pide
     es el nombre, y es opcional: sirve para que al pie diga quién cargó. */
  const recordado = (k) => window.NakuClave.leer(k);
  const recordar = (k, v) => window.NakuClave.guardar(k, v);

  function pedirNombreSiHace() {
    $('impQuienInput').value = recordado('quien');
  }

  async function publicar() {
    if(!pendingOperation||publishing)return;
    publishing=true;$('impPublicar').disabled=true;
    estado('Guardando las ventas y actualizando ambos tableros…');
    try {
      window.NakuBuyerSync.setKey(recordado('clave'));
      const r=await window.NakuBuyerSync.request('/finanzas',pendingOperation);
      // Recuperar también después de un reintento de una publicación confirmada.
      if(r.finance)ultimoJson=r.finance;
      else {
        const latest=await fetch(window.NakuAPI+'/',{headers:{'x-naku-clave':recordado('clave')}});
        if(!latest.ok)throw new Error('Se guardó, pero no se pudo refrescar Finanzas. Recargá la página.');
        ultimoJson=(await latest.json()).datos;
      }
      recordar('quien',$('impQuienInput').value.trim());
      window.NakuPublicado={publicado:r.actualizado,quien:'Carga compartida MeLi/TN'};
      window.NakuDatos=ultimoJson;window.NakuPintar(ultimoJson);
      estado('Publicado para todos. Buyer y Finanzas ya toman las mismas ventas.','bien');
      $('impPublicar').textContent='Publicado ✓';pendingOperation=null;
    }catch(e){estado('No se pudo confirmar la publicación: '+e.message+'. Podés reintentar.','mal');}
    finally{publishing=false;$('impPublicar').disabled=false;}
  }

  // Las pestañas abiertas acompañan las cargas del Buyer sin pisar una vista previa.
  let polling=false;
  async function syncFinance(){
    if(polling||publishing||pendingOperation||document.hidden||!recordado('clave')||!$('entrar').hidden)return;
    polling=true;
    try{
      const headers={'x-naku-clave':recordado('clave')};
      const state=await fetch(window.NakuAPI+'/estado',{headers,cache:'no-store',signal:AbortSignal.timeout(20000)});
      if(!state.ok)return;
      const meta=await state.json();
      if(meta.actualizado!==window.NakuPublicado?.publicado){
        const res=await fetch(window.NakuAPI+'/',{headers,cache:'no-store',signal:AbortSignal.timeout(30000)});
        if(!res.ok)return;
        const data=await res.json();
        if(publishing||pendingOperation||Date.parse(data.publicado)<Date.parse(window.NakuPublicado?.publicado))return;
        window.NakuDatos=data.datos;
        window.NakuPublicado={publicado:data.publicado,quien:data.quien};window.NakuPintar(data.datos);
      }
    }catch{/* conserva la última vista confirmada */}finally{polling=false;}
  }
  setInterval(syncFinance,30000);window.addEventListener('focus',syncFinance);

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
  pintarZonas();
  revisarListo();
})();
