/* Vista de cierre mensual. El detalle de órdenes conserva su propio universo. */
(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf=new Intl.NumberFormat('es-AR',{maximumFractionDigits:0});
  const monto=v=>v===null||v===undefined?'—':Math.abs(v)>=1e6?'$'+(v/1e6).toLocaleString('es-AR',{maximumFractionDigits:1})+' M':'$'+nf.format(v);
  const porcentaje=v=>v===null?'—':v.toLocaleString('es-AR',{maximumFractionDigits:1})+'%';
  const nombre=m=>new Date(m+'-15T12:00:00').toLocaleDateString('es-AR',{month:'long',year:'numeric'});
  let filtro={canal:'empresa',periodo:'mes'},D=null;
  const card=(titulo,valor,nota,focus=false)=>`<article class="ficha${focus?' foco':''}"><span class="et">${esc(titulo)}</span><span class="val">${valor}</span><div class="pie"><span class="glosa">${esc(nota)}</span></div></article>`;
  const panel=(titulo,sub,body)=>`<div class="panel"><header><h3>${esc(titulo)}</h3><span class="sub">${esc(sub)}</span></header><div class="cuerpo">${body}</div></div>`;
  const barras=(items,formato=monto)=>{
    const max=Math.max(...items.map(x=>x.v||0),1);
    return !items.length?'<p class="notaPanel">Sin datos para este período.</p>':`<div class="lista">${items.map((x,i)=>`<div class="item c${i%4+1}"><span class="nom">${esc(x.n)}</span><span class="cif">${esc(formato(x.v))}${x.extra?` <span>${esc(x.extra)}</span>`:''}</span><span class="riel"><i style="width:${Math.max(2,100*(x.v||0)/max).toFixed(1)}%"></i></span></div>`).join('')}</div>`;
  };
  function gastosDireccion(g,meses,V){
    const r=window.NakuMotor.gestion.resumenGastos(g,meses);
    const pendiente=r.items.find(c=>c.id==='pendiente');
    const comparacion=r.anteriores.length===1?nombre(r.anteriores[0]):nombre(r.anteriores[0])+' – '+nombre(r.anteriores.at(-1));
    const mayor=r.items.filter(c=>c.anterior!==null&&c.importe>c.anterior).sort((a,b)=>(b.importe-b.anterior)-(a.importe-a.anterior))[0];
    const nota=mayor?`Mayor aumento entre categorías comparables: ${mayor.nombre}, ${monto(mayor.importe-mayor.anterior)} más.`:'La variación se muestra cuando ambos períodos tienen importes cargados.';
    return `<div style="margin-top:14px">${panel('A dónde se va cada peso','Fijos y variables · '+monto(r.total)+' cargados',
      `${barras(r.items.filter(c=>c.importe!==null).map(c=>({n:c.nombre,v:c.importe,extra:porcentaje(V.ventas?100*c.importe/V.ventas:null)})))}<p class="notaPanel">${esc(nota)} Comparación con ${esc(comparacion)}.</p>${pendiente?`<p class="notaPanel">Sin mapear: ${pendiente.conceptos} conceptos · ${monto(pendiente.importe)} cargados.</p>`:''}<details><summary>Ver variaciones por categoría</summary><div class="tablaEnv"><table class="eerr"><thead><tr><th>Categoría</th><th>Importe</th><th>Variación</th></tr></thead><tbody>${r.items.map(c=>`<tr><td>${esc(c.nombre)}</td><td>${monto(c.importe)}${c.sinImporte?' *':''}</td><td>${c.variacion===null?'—':(c.variacion>0?'+':'')+porcentaje(c.variacion)}</td></tr>`).join('')}</tbody></table></div><p class="notaPanel">${r.sinImporte?'* Hay celdas sin importe; se muestra únicamente lo cargado. ':''}Mercadería y cargos de canales se presentan por separado.</p></details>`
    )}</div>`;
  }
  const rotulo=t=>`<div class="rotulo"><span class="lab">${esc(t)}</span><span class="regla"></span></div>`;
  function pintar(data){
    D=data;
    const agenda=document.querySelector('nav a[href="#agenda"]');if(agenda)agenda.textContent='La semana';
    if(!$('gestionStyles')){const css=document.createElement('style');css.id='gestionStyles';css.textContent='.gestion-fichas{grid-template-columns:repeat(3,minmax(0,1fr))}@media(max-width:900px){.gestion-fichas{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.gestion-fichas{grid-template-columns:1fr}}';document.head.append(css);}
    const g=D.gestion,meses=Object.keys(g.meses).filter(m=>g.meses[m].calendarioCerrado).sort();
    if(!meses.length){$('pulso').innerHTML='<p>No hay meses cerrados disponibles en la planilla.</p>';return;}
    const ultimo=meses.at(-1),year=ultimo.slice(0,4);
    const ultimos=n=>{const d=new Date(ultimo+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-n+1);return meses.filter(m=>m>=d.toISOString().slice(0,7));};
    const periodos=[{id:'mes',n:'Último mes',meses:[ultimo]},{id:'m3',n:'Últimos 3 meses',meses:ultimos(3)},{id:'m6',n:'Últimos 6 meses',meses:ultimos(6)},{id:'anio',n:'Este año',meses:meses.filter(m=>m.startsWith(year))},{id:'rango',n:'Rango',meses}];
    const canales=[['empresa','Toda la empresa'],['online','MeLi + TN'],['mayoristas','Mayoristas'],['ml','Mercado Libre'],['tn','Tienda Nube'],['a','Mayorista A'],['b','Mayorista B']];
    $('filtros').hidden=false;
    const tabs=(id,items,campo)=>{$(id).innerHTML=items.map(([v,n])=>`<option value="${v}"${filtro[campo]===v?' selected':''}>${esc(n)}</option>`).join('');$(id).onchange=()=>{filtro[campo]=$(id).value;pintar(D);};};
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
      (empresa?card('Resultado operativo provisional',monto(V.provisional),parcial?'Faltan validar datos. No es el resultado definitivo.':'Después de mercadería, cargos y gastos cargados.',true):'')+
      card('Costo de mercadería',monto(V.costo),'Costo informado para el conjunto seleccionado.')+
      (empresa?card('Gastos operativos',monto(window.NakuMotor.gestion.resumenGastos(g,pedidos).total),'Fijos y variables; el detalle se agrupa por destino.'):'')
    }</div>`;
    const aviso=[...V.pendientes.map(s=>'Falta: '+s),...V.alertas];
    const base=V.sinProrrateo?'El costo se informa por grupo (mayoristas / online); no hay prorrateo por canal.':'Los gastos de estructura se muestran sólo en Toda la empresa.';
    $('finanzas').hidden=false;
    $('finanzas').innerHTML=rotulo('Finanzas')+`<div class="rejilla r-53">${panel('Estado de resultados',g.archivo,`<div class="tablaEnv"><table class="eerr"><thead><tr><th>Concepto</th><th>Importe</th><th>% sobre ventas</th></tr></thead><tbody>${V.lineas.map(l=>`<tr class="${l.tipo==='destacado'?'destacado total':l.tipo==='total'?'total':''}"><td>${esc(l.c)}</td><td>${monto(l.v)}</td><td>${porcentaje(l.pct)}</td></tr>`).join('')}</tbody></table><p class="notaPanel">${esc(base)} ${esc(g.alcance)}</p></div>`)}${panel('Estado del cierre',rango,aviso.length?`<p>${V.pendientes.length} datos pendientes · ${V.alertas.length} diferencias para revisar.</p><details><summary>Revisar el cierre</summary><ul>${aviso.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></details>`:'<p>Los componentes del resumen están cargados. Confirmar el cierre con Administración.</p>')}</div>`+
      (empresa?gastosDireccion(g,pedidos,V):'');
    const selected={empresa:['a','b','ml','tn'],online:['ml','tn'],mayoristas:['a','b']}[filtro.canal]||[filtro.canal];
    const comercial=detalleComercial(D,pedidos,filtro.canal);
    $('ventas').hidden=false;
    const serie=pedidos.map(m=>{const x=window.NakuMotor.gestion.bloqueGestion(g,[m],filtro.canal);return {m:nombre(m).replace(' de ',' ').slice(0,8),ventas:x?.ventas,margen:x?.margenPct};});
    const alcance=filtro.canal==='empresa'?'Detalle de MeLi + Tienda Nube dentro del total de la empresa':filtro.canal==='online'?'MeLi + Tienda Nube':filtro.canal==='ml'?'Mercado Libre':filtro.canal==='tn'?'Tienda Nube':'Sin detalle de órdenes mayoristas';
    const sinDetalle='<p class="nodato">La planilla mayorista no informa producto, provincia ni forma de entrega.</p>';
    $('ventas').innerHTML=rotulo('Ventas')+`<div class="rejilla r2"><div class="panel"><header><h3>Evolución de ventas</h3><span class="sub">antes de cargos</span></header><div class="cuerpo"><div class="grafico" id="gVentasGestion"></div></div></div><div class="panel"><header><h3>Margen bruto</h3><span class="sub">% sobre ventas</span></header><div class="cuerpo"><div class="grafico" id="gMargenGestion"></div></div></div></div>`+`<div class="rejilla r2" style="margin-top:14px">${panel('Los artículos que traccionan',alcance,comercial?barras(comercial.productos,v=>monto(v)):sinDetalle)}${panel('Mix por familia',alcance,comercial?barras(comercial.familias,v=>porcentaje(v)):sinDetalle)}${panel('De dónde compran',alcance,comercial?barras(comercial.provincias,v=>porcentaje(v)):sinDetalle)}${panel('Cómo llega el paquete',alcance,comercial?barras(comercial.envios,v=>nf.format(v)+' órdenes'):sinDetalle)}</div>`;
    const ventasSerie=serie.filter(x=>x.ventas!==null),margenSerie=serie.filter(x=>x.margen!==null);
    if(ventasSerie.length)graficoLinea('gVentasGestion',ventasSerie,'ventas','var(--c1)','Evolución mensual de ventas',monto);
    if(margenSerie.length)graficoLinea('gMargenGestion',margenSerie,'margen','var(--c4)','Evolución mensual del margen bruto',porcentaje);
    pintarPostventa(D);
    pintarSemana(g,pedidos,V,selected,comercial);
    $('pieFuentes').textContent=g.alcance+' '+(D.sincronizacion?'Última actualización desde Google: '+new Date(D.sincronizacion.actualizado).toLocaleString('es-AR'):'Vista de archivos importados. Sincronización de Google pendiente de activar.');
    requestAnimationFrame(()=>{if(typeof medirSticky==='function')medirSticky();});
  }
  function pintarPostventa(data){
    const id={empresa:'todos',online:'todos',ml:'ml',tn:'tn'}[filtro.canal];
    const C=id&&(data.clientes?.porCanal?.[id]||(id==='todos'?data.clientes:null));
    if(!C||typeof window.pintarClientes!=='function'){$('clientes').hidden=true;return;}
    $('clientes').hidden=false;
    $('fuenteClientes').textContent=`Central de atención · corte ${C.corte}`;
    const canal=id==='ml'?'Mercado Libre':id==='tn'?'Tienda Nube':null;
    window.pintarClientes(C,data,canal);
  }
  function detalleComercial(data,meses,canal){
    const id={empresa:'todos',online:'todos',ml:'ml',tn:'tn'}[canal],porCanal=id&&data.vistas?.[id];
    if(!porCanal)return null;
    const disponibles=meses.filter(m=>porCanal['mes:'+m]);
    return disponibles.length?sumarBloques(porCanal,disponibles):null;
  }
  function pintarSemana(g,pedidos,V,selected,comercial){
    const rg=window.NakuMotor.gestion.resumenGastos(g,pedidos);
    const suba=rg.items.filter(x=>x.anterior!==null&&x.importe>x.anterior).sort((a,b)=>(b.importe-b.anterior)-(a.importe-a.anterior))[0];
    const top=comercial?.productos?.[0];let urgentes=0;
    const canales=filtro.canal==='empresa'?['empresa']:selected.filter(c=>['ml','tn'].includes(c));
    for(const m of pedidos)for(const c of canales)urgentes+=g.postventa?.meses[m]?.[c]?.urgentes||0;
    const nota=(clase,titulo,texto,quien)=>`<article class="nota ${clase}"><span class="marca-sev"></span><div><h4>${esc(titulo)}</h4><p>${esc(texto)}</p><span class="quien">${esc(quien)}</span></div></article>`;
    const cierre=V.pendientes.length||V.alertas.length
      ?nota('ojo','Cerrar los datos pendientes',`${V.pendientes.length} datos faltantes y ${V.alertas.length} diferencias para revisar.`,'Administración')
      :nota('bien','Cierre listo para revisar','Los componentes del resultado están cargados para el período.','Dirección');
    const gasto=suba?nota('ojo','Revisar '+suba.nombre,`Es la categoría que más aumentó: ${monto(suba.importe-suba.anterior)} frente al período anterior.`,'Administración'):nota('bien','Gastos sin saltos comparables','No aparece una suba relevante entre las categorías con datos completos.','Dirección');
    const producto=top?nota('info','Asegurar stock de '+top.n,`Es el artículo que más facturó en el detalle online: ${monto(top.v)} y ${nf.format(top.u||0)} unidades.`,'Comercial'):nota('info','Completar el detalle comercial','Para ver artículos, ubicación y envíos hay que cargar los exports de MeLi/Tienda Nube.','Comercial');
    const post=urgentes?nota('mal','Resolver '+nf.format(urgentes)+' casos urgentes','Son ingresos marcados con urgencia alta en el período seleccionado.','Postventa'):nota('bien','Sin ingresos urgentes','La central no registra casos nuevos con urgencia alta en el período.','Postventa');
    $('agenda').hidden=false;
    $('agenda').innerHTML=rotulo('Para la semana')+`<div class="agenda">${cierre+gasto+producto+post}</div>`;
  }
  window.NakuGestionUI={pintar};
  if(window.NakuDatos?.gestion&&window.NakuPintar)window.NakuPintar(window.NakuDatos);
})();
