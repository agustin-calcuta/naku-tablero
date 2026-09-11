/* Actualización simple: Google trae las tres planillas; los únicos archivos que
   se cargan a mano son los exports de MeLi/TN para el detalle comercial. */
(function () {
  const $ = (id) => document.getElementById(id);
  const M = window.NakuMotor;
  if (!M) return;                       // sin motor, el botón no aparece

  const ZONAS = [
    {
      id: 'meli', titulo: 'Mercado Libre', acepta: '.xlsx',
      pista: 'Ventas por producto', varios: true, tipo: 'ventas',
    },
    {
      id: 'tn', titulo: 'Tienda Nube', acepta: '.csv',
      pista: 'Ventas por producto', varios: true, tipo: 'ventas',
    },
  ];

  const elegidos = {};                  // id de zona -> File[]
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
      ? 'Los archivos actualizan productos, órdenes y compradores en los dos tableros.'
      : 'Las planillas se sincronizan arriba. Estos archivos actualizan el detalle de productos de MeLi y Tienda Nube.';
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
    publishing=true;$('impProcesar').disabled=true;
    try {
      if(typeof XLSX==='undefined')throw new Error('No se pudo cargar el lector de Excel. Revisá la conexión.');
      const operation={id:crypto.randomUUID(),exports:[],nombre:'Actualización de productos'};
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
      estado('Actualizando productos y ventas en los dos tableros…');
      window.NakuBuyerSync.setKey(window.NakuClave.leer('clave'));
      const r=await window.NakuBuyerSync.request('/finanzas',operation);
      const ultimoJson=r.finance;
      window.NakuPublicado={publicado:r.actualizado,quien:'Archivos de MeLi/Tienda Nube'};
      window.NakuDatos=ultimoJson;
      window.NakuPintar(ultimoJson);
      estado('Productos y ventas actualizados en los dos tableros.','bien');
      $('impCerrarPie').textContent='Cerrar';
    }catch(e){estado(e.message||String(e),'mal');}
    finally{publishing=false;$('impProcesar').disabled=false;}
  }

  /** Deja respirar al navegador para que se vea el cartel de progreso. */
  const pausa = () => new Promise((r) => setTimeout(r, 16));

  /* La misma clave que abre Dirección permite sincronizar y actualizar exports. */
  const recordado = (k) => window.NakuClave.leer(k);

  // Las pestañas abiertas acompañan las cargas del Buyer sin pisar una vista previa.
  let polling=false;
  async function syncFinance(){
    if(polling||publishing||document.hidden||!recordado('clave')||!$('entrar').hidden)return;
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
        if(publishing||Date.parse(data.publicado)<Date.parse(window.NakuPublicado?.publicado))return;
        window.NakuDatos=data.datos;
        window.NakuPublicado={publicado:data.publicado,quien:data.quien};window.NakuPintar(data.datos);
      }
    }catch{/* conserva la última vista confirmada */}finally{polling=false;}
  }
  setInterval(syncFinance,30000);window.addEventListener('focus',syncFinance);

  /* ---------------------------------------------------------------- cablear */
  $('btnActualizar').hidden = false;
  $('btnActualizar').addEventListener('click', abrir);
  const sync=document.createElement('button');sync.className='primario';sync.type='button';sync.id='impSincronizar';sync.textContent='Actualizar planillas';
  $('impZonas').before(sync);
  sync.insertAdjacentHTML('afterend','<div class="imp-seccion"><b>Actualizar productos</b><span>Subí los exports de Mercado Libre y Tienda Nube</span></div>');
  sync.onclick=async()=>{
    if(publishing)return;
    publishing=true;sync.disabled=true;estado('Leyendo ventas, costos y postventa desde Google…');
    try{
      window.NakuBuyerSync.setKey(recordado('clave'));
      const r=await window.NakuBuyerSync.request('/sincronizar',{id:crypto.randomUUID()});
      if(r.finance){window.NakuDatos=r.finance;window.NakuPublicado={publicado:r.actualizado,quien:'Planillas de Google'};window.NakuPintar(r.finance);}
      estado(r.sinCambios?'Las planillas ya estaban al día.':'Planillas sincronizadas. Ambos tableros usan la versión compartida.','bien');
    }catch(e){estado(e.message||'No se pudo sincronizar. Se conserva la última versión.','mal');}
    finally{publishing=false;sync.disabled=false;}
  };
  $('impCerrar').addEventListener('click', cerrar);
  $('impCerrarPie').addEventListener('click', cerrar);
  $('impFondo').addEventListener('click', (e) => { if (e.target === $('impFondo')) cerrar(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('impFondo').hidden) cerrar(); });
  $('impProcesar').addEventListener('click', procesar);
  pintarZonas();
  revisarListo();
})();
