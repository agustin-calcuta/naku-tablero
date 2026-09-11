/* Vista de cierre mensual. El detalle de órdenes conserva su propio universo. */
(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf=new Intl.NumberFormat('es-AR',{maximumFractionDigits:0});
  const monto=v=>v===null||v===undefined?'—':Math.abs(v)>=1e6?'$'+(v/1e6).toLocaleString('es-AR',{maximumFractionDigits:1})+' M':'$'+nf.format(v);
  const porcentaje=v=>v===null?'—':v.toLocaleString('es-AR',{maximumFractionDigits:1})+'%';
  const nombre=m=>new Date(m+'-15T12:00:00').toLocaleDateString('es-AR',{month:'long',year:'numeric'});
  let originales=null, filtro={canal:'empresa',periodo:'mes'},D=null;
  const card=(titulo,valor,nota,focus=false)=>`<article class="ficha${focus?' foco':''}"><span class="et">${esc(titulo)}</span><span class="val">${valor}</span><div class="pie"><span class="glosa">${esc(nota)}</span></div></article>`;
  const panel=(titulo,sub,body)=>`<div class="panel"><header><h3>${esc(titulo)}</h3><span class="sub">${esc(sub)}</span></header><div class="cuerpo">${body}</div></div>`;
  function gastosDireccion(g,meses,V){
    const r=window.NakuMotor.gestion.resumenGastos(g,meses);
    const pendiente=r.items.find(c=>c.id==='pendiente');
    const comparacion=r.anteriores.length===1?nombre(r.anteriores[0]):nombre(r.anteriores[0])+' – '+nombre(r.anteriores.at(-1));
    const mayor=r.items.filter(c=>c.anterior!==null&&c.importe>c.anterior).sort((a,b)=>(b.importe-b.anterior)-(a.importe-a.anterior))[0];
    const nota=mayor?`Mayor aumento entre categorías comparables: ${mayor.nombre}, ${monto(mayor.importe-mayor.anterior)} más.`:'La variación se muestra cuando ambos períodos tienen importes cargados.';
    return `<div style="margin-top:14px">${panel('Gastos por categoría','Fijos y variables · '+monto(r.total)+' cargados',
      `<p>${esc(nota)}</p><div class="tablaEnv"><table class="eerr"><thead><tr><th>Categoría</th><th>Importe</th><th>% de ventas</th><th>Variación</th></tr></thead><tbody>${r.items.map(c=>`<tr><td><b>${esc(c.nombre)}</b><br><small>${esc(c.detalle)}</small></td><td>${monto(c.importe)}${c.sinImporte?' *':''}</td><td>${porcentaje(c.importe!==null&&V.ventas?100*c.importe/V.ventas:null)}</td><td>${c.variacion===null?'—':(c.variacion>0?'+':'')+porcentaje(c.variacion)}</td></tr>`).join('')}</tbody></table></div><p class="notaPanel">Comparación con ${esc(comparacion)}.${r.sinImporte?' * Hay celdas sin importe: se muestra únicamente lo cargado.':''} Mercadería y cargos de los canales se presentan por separado en el resultado.</p>${pendiente?`<p class="notaPanel">Sin mapear: ${pendiente.conceptos} conceptos · ${monto(pendiente.importe)} cargados. Falta confirmar su categoría.</p>`:''}<details><summary>Consultar conceptos de la planilla</summary><div class="rejilla r2">${panel('Gastos fijos','Detalle de origen',lista(V.fijos))}${panel('Gastos variables','Detalle de origen',lista(V.variables))}</div></details>`
    )}</div>`;
  }
  const lista=(items,fmt=monto)=>!items.length?'<p class="notaPanel">Sin datos para este período.</p>':`<div class="tablaEnv"><table class="eerr"><tbody>${items.map(x=>`<tr><td>${esc(x.n)}</td><td>${esc(fmt(x.v))}</td></tr>`).join('')}</tbody></table></div>`;
  const rotulo=t=>`<div class="rotulo"><span class="lab">${esc(t)}</span><span class="regla"></span></div>`;
  function prepararModo(data){
    let bar=$('modoDatos');
    if(!bar){bar=document.createElement('div');bar.id='modoDatos';bar.className='filtros';bar.innerHTML='<div class="filtrosin"><span class="et">Vista</span><div class="pestanas"><button id="modoCierre" type="button">Cierre mensual</button><button id="modoDetalle" type="button">Detalle de ventas</button></div><span class="resumen" id="modoNota"></span></div>';$('filtros').before(bar);}
    bar.hidden=!data.gestion;
    $('modoCierre').setAttribute('aria-selected',String(!window.NakuDetalle));$('modoDetalle').setAttribute('aria-selected',String(!!window.NakuDetalle));
    $('modoDetalle').disabled=!Object.keys(data.vistas||{}).length;
    $('modoNota').textContent=window.NakuDetalle?'Órdenes de MeLi/TN · mismos importes que Compradores':'Planillas de administración · empresa completa';
    const agenda=document.querySelector('nav a[href="#agenda"]');if(agenda)agenda.textContent=window.NakuDetalle||!data.gestion?'La semana':'Caja';
    $('modoCierre').onclick=()=>{window.NakuDetalle=false;window.NakuPintar(data);};
    $('modoDetalle').onclick=()=>{window.NakuDetalle=true;window.NakuPintar(data);};
  }
  function restaurar(data){
    if(originales){for(const [id,html]of Object.entries(originales))$(id).innerHTML=html;originales=null;}
    prepararModo(data);
  }
  function pintar(data){
    D=data;prepararModo(D);
    if(!$('gestionStyles')){const css=document.createElement('style');css.id='gestionStyles';css.textContent='.gestion-fichas{grid-template-columns:repeat(4,minmax(0,1fr))}@media(max-width:1100px){.gestion-fichas{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.gestion-fichas{grid-template-columns:1fr}}#modoDatos{position:relative;top:auto}';document.head.append(css);}
    if(!originales)originales=Object.fromEntries(['pulso','finanzas','ventas','clientes','agenda'].map(id=>[id,$(id).innerHTML]));
    const g=D.gestion,meses=Object.keys(g.meses).filter(m=>g.meses[m].calendarioCerrado).sort();
    if(!meses.length){$('pulso').innerHTML='<p>No hay meses cerrados disponibles en la planilla.</p>';return;}
    const ultimo=meses.at(-1),year=ultimo.slice(0,4);
    const ultimos=n=>{const d=new Date(ultimo+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-n+1);return meses.filter(m=>m>=d.toISOString().slice(0,7));};
    const periodos=[{id:'mes',n:'Último mes',meses:[ultimo]},{id:'m3',n:'Últimos 3 meses',meses:ultimos(3)},{id:'m6',n:'Últimos 6 meses',meses:ultimos(6)},{id:'anio',n:'Este año',meses:meses.filter(m=>m.startsWith(year))},{id:'rango',n:'Rango',meses}];
    const canales=[['empresa','Toda la empresa'],['online','MeLi + TN'],['mayoristas','Mayoristas'],['ml','Mercado Libre'],['tn','Tienda Nube'],['a','Mayorista A'],['b','Mayorista B']];
    $('filtros').hidden=false;
    const tabs=(id,items,campo)=>{$(id).innerHTML=items.map(([v,n])=>`<button type="button" role="tab" data-v="${v}" aria-selected="${filtro[campo]===v}">${esc(n)}</button>`).join('');$(id).onclick=e=>{const b=e.target.closest('[data-v]');if(!b)return;filtro[campo]=b.dataset.v;pintar(D);};};
    tabs('tabsCanal',canales,'canal');tabs('tabsPeriodo',periodos.map(p=>[p.id,p.n]),'periodo');
    for(const id of ['rangoDesde','rangoHasta']){const prev=filtro[id];$(id).innerHTML=meses.map(m=>`<option value="${m}">${esc(nombre(m))}</option>`).join('');$(id).value=meses.includes(prev)?prev:id==='rangoHasta'?ultimo:meses[0];$(id).onchange=()=>{if($('rangoDesde').value>$('rangoHasta').value)$(id==='rangoDesde'?'rangoHasta':'rangoDesde').value=$(id).value;filtro.rangoDesde=$('rangoDesde').value;filtro.rangoHasta=$('rangoHasta').value;pintar(D);};}
    $('rango').hidden=filtro.periodo!=='rango';
    const pedidos=filtro.periodo==='rango'?meses.filter(m=>m>=$('rangoDesde').value&&m<=$('rangoHasta').value):(periodos.find(p=>p.id===filtro.periodo)||periodos[0]).meses;
    const V=window.NakuMotor.gestion.bloqueGestion(g,pedidos,filtro.canal);
    const rango=pedidos.length===1?nombre(pedidos[0]):nombre(pedidos[0])+' – '+nombre(pedidos.at(-1));
    $('resumenFiltro').textContent=rango+' · importes mensuales';
    const parcial=V.pendientes.length||V.alertas.length;
    const empresa=filtro.canal==='empresa';
    $('pulso').hidden=false;
    $('pulso').innerHTML=`<div class="portada"><div><h1>Cómo viene la empresa</h1><p>Ventas mayoristas y online, costos, gastos y atención al cliente. Cierre mensual desde las planillas de administración.</p></div><div class="periodo"><span class="et">Mes cerrado</span><b>${esc(rango)}</b><small>${parcial?'Cierre con pendientes de revisión':'Datos mensuales disponibles'}</small></div></div><div class="fichas gestion-fichas">${
      card('Ventas antes de cargos',monto(V.ventas),'MeLi/TN sin IVA. Mayoristas en la base informada en la planilla.',true)+
      card('Después de cargos de canales',monto(V.neto),'Incluye los descuentos del resumen administrativo; no acredita cobros bancarios.')+
      card('Margen bruto',porcentaje(V.margenPct),V.costo===null?'El costo está informado para mayoristas u online juntos.':monto(V.margen)+' · costo de mercadería del período')+
      (empresa?card('Resultado operativo provisional',monto(V.provisional),parcial?'Faltan validar datos. No es el resultado definitivo.':'Después de mercadería, cargos y gastos cargados.',true):card('Costo de mercadería',monto(V.costo),'Los costos conjuntos no se reparten por canal sin una fuente.'))
    }</div>`;
    const aviso=[...V.pendientes.map(s=>'Falta: '+s),...V.alertas];
    const base=V.sinProrrateo?'El costo se informa por grupo (mayoristas / online); no hay prorrateo por canal.':'Los gastos de estructura se muestran sólo en Toda la empresa.';
    $('finanzas').hidden=false;
    $('finanzas').innerHTML=rotulo('Finanzas')+`<div class="rejilla r-53">${panel('Estado de resultados',g.archivo,`<div class="tablaEnv"><table class="eerr"><thead><tr><th>Concepto</th><th>Importe</th><th>% sobre ventas</th></tr></thead><tbody>${V.lineas.map(l=>`<tr class="${l.tipo==='destacado'?'destacado total':l.tipo==='total'?'total':''}"><td>${esc(l.c)}</td><td>${monto(l.v)}</td><td>${porcentaje(l.pct)}</td></tr>`).join('')}</tbody></table><p class="notaPanel">${esc(base)} ${esc(g.alcance)}</p></div>`)}${panel('Estado del cierre',rango,aviso.length?`<p>${V.pendientes.length} datos pendientes · ${V.alertas.length} diferencias para revisar.</p><details><summary>Revisar el cierre</summary><ul>${aviso.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></details>`:'<p>Los componentes del resumen están cargados. Revisar el detalle de conciliación antes de confirmar el cierre.</p>')}</div>`+
      (empresa?gastosDireccion(g,pedidos,V):'')+
      `<details class="panel" style="margin-top:14px;padding:20px"><summary>Consultar cargos de MeLi y Tienda Nube</summary>${panel('Cargos informados por los canales','Ya incluidos en el neto',lista(pedidos.flatMap(m=>['ml','tn'].filter(c=>empresa||filtro.canal==='online'||filtro.canal===c).flatMap(c=>(g.meses[m].canales[c]?.cargos||[]).filter(x=>x.importe).map(x=>({n:nombre(m)+' · '+c.toUpperCase()+' · '+x.concepto,v:x.importe}))))))}</details>`;
    const units=new Map();const faltanRotacion=pedidos.filter(m=>!g.rotacion.meses[m]?.disponible);
    if(empresa)for(const m of pedidos)for(const p of g.rotacion.meses[m]?.items||[])units.set(p.sku,(units.get(p.sku)||0)+(p.unidades||0));
    const top=[...units].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([n,v])=>({n,v}));
    const cats=new Map();let catMeses=0;
    const selected={empresa:['a','b','ml','tn'],online:['ml','tn'],mayoristas:['a','b']}[filtro.canal]||[filtro.canal];
    for(const m of pedidos){if(g.categorias.meses[m])catMeses++;for(const c of g.categorias.meses[m]?.items||[])if(selected.includes(c.canal)&&c.importe!==null)cats.set(c.tipo,(cats.get(c.tipo)||0)+c.importe);}
    const conc=g.conciliacion?.filter(c=>pedidos.includes(c.mes)&&selected.includes(c.canal))||[];
    $('ventas').hidden=false;
    $('ventas').innerHTML=rotulo('Ventas')+panel('Evolución mensual','Ventas antes de cargos',lista(V.serie.map(x=>({n:nombre(x.mes),v:x.v}))))+`<div class="rejilla r2" style="margin-top:14px">${panel('Más vendidos por unidades',empresa?'ROTACION DE STOCK · sin desglose por canal':'La matriz de unidades no identifica canales',lista(top,v=>nf.format(v)+' u')+(faltanRotacion.length?`<p class="notaPanel">Sin cantidades en ${esc(faltanRotacion.map(nombre).join(', '))}. El ranking muestra sólo los meses con datos.</p>`:''))}${panel('Ventas por tipo de artículo',`${catMeses} de ${pedidos.length} meses con detalle`,lista([...cats].map(([n,v])=>({n,v})).sort((a,b)=>b.v-a.v)))}</div>`+
      `<details class="panel" style="margin-top:14px;padding:20px"><summary>Conciliación con el detalle de MeLi/TN</summary><p>La planilla alimenta el cierre. Las órdenes alimentan Compradores y el detalle comercial. Las diferencias se muestran sin ajustar ni distribuir importes artificialmente.</p><div class="tablaEnv"><table class="eerr"><thead><tr><th>Mes / canal</th><th>Planilla</th><th>Órdenes</th><th>Diferencia</th></tr></thead><tbody>${conc.map(c=>`<tr><td>${esc(nombre(c.mes))} · ${c.canal.toUpperCase()}</td><td>${monto(c.planilla)}</td><td>${monto(c.detalle)}</td><td>${monto(c.diferencia)}</td></tr>`).join('')}</tbody></table></div><p class="notaPanel">Órdenes, ticket promedio, provincias y reparto por comprador requieren el detalle de ventas.</p></details>`;
    pintarClientes(g,pedidos,selected);
    pintarCaja(g,pedidos);
    $('pieFuentes').textContent=g.alcance+' '+(D.sincronizacion?'Última actualización desde Google: '+new Date(D.sincronizacion.actualizado).toLocaleString('es-AR'):'Vista de archivos importados. Sincronización de Google pendiente de activar.');
    requestAnimationFrame(()=>{if(typeof medirSticky==='function')medirSticky();});
  }
  function pintarClientes(g,pedidos,selected){
    $('clientes').hidden=false;let ingresos=0,cierres=0,aprox=0,urgentes=0;
    const canales=filtro.canal==='empresa'?['empresa']:selected.filter(c=>['ml','tn'].includes(c));
    for(const m of pedidos)for(const c of canales){const p=g.postventa?.meses[m]?.[c];if(p){ingresos+=p.ingresos;cierres+=p.cierresReales;aprox+=p.cierresAproximados;urgentes+=p.urgentes;}}
    const datos=canales.length&&g.postventa;
    $('clientes').innerHTML=rotulo('Atención al cliente')+(datos?`<div class="fichas">${card('Casos ingresados',nf.format(ingresos),'Altas en los meses seleccionados')+card('Ingresos urgentes',nf.format(urgentes),'Casos ingresados con urgencia alta')+card('Cierres con fecha real',nf.format(cierres),aprox+' cierres adicionales con fecha aproximada')}</div><p class="notaPanel">${esc(g.postventa.nota)} No se calcula una tasa sobre ventas sin contar órdenes del mismo universo.</p>`:panel('Postventa','Sin desglose disponible','<p>La central no identifica ventas A/B por separado. Toda la empresa muestra todos los casos; MeLi/TN tienen su propio filtro.</p>'));
  }
  function pintarCaja(g,pedidos){
    const snap=g.caja.mensuales[pedidos.at(-1)];
    const pro=g.proyeccion;
    $('agenda').hidden=false;
    $('agenda').innerHTML=rotulo('Caja y próximos pagos')+`<div class="rejilla r2">${panel('Saldos al cierre',snap?'Última fecha informada: '+snap.fecha:'Sin saldo para este mes',lista((snap?.items||[]).map(x=>({n:x.concepto,v:x.importe})))+`<p class="notaPanel">${esc(g.caja.alcance)}</p>`)}${panel('Proyección de caja',pro?'Corte propio: '+pro.fecha:'Sin proyección disponible',lista((pro?.meses||[]).map(x=>({n:nombre(x.mes)+' · pagos informados',v:x.pagosInformados})))+`<p class="notaPanel">${esc(pro?.alcance||'')}${pro?.alertas?.length?' '+esc(pro.alertas.join(' ')):''}</p>`)}</div>`+
      `<details class="panel" style="margin-top:14px;padding:20px"><summary>Fuentes y cobertura de las ${g.inventario.length} pestañas</summary><p>El cierre usa ventas y gastos. Rotación, categorías y saldos tienen su propio alcance. Las pestañas fechadas son versiones de cash flow: se conserva sólo la más reciente como proyección.</p>${lista(g.inventario.map(x=>({n:x.hoja+(x.oculta?' · histórica/oculta':''),v:x.errores.length})),v=>v?v+' celdas con error':'Sin errores de celda detectados')}</details>`;
  }
  window.NakuGestionUI={pintar,restaurar,prepararModo};
  if(window.NakuDatos?.gestion&&window.NakuPintar)window.NakuPintar(window.NakuDatos);
})();
