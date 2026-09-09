// Transporte del Buyer: la base compartida es la fuente de datos.
// IndexedDB se consulta únicamente para rescatar cargas de la versión anterior.
window.NakuBuyerSync = (() => {
  const api = 'https://br-wispy-lake-ayf0dl28-buyer.compute.c-5.us-east-2.aws.neon.tech';
  let key = '';
  const stored = name => { try { return localStorage.getItem(name) || ''; } catch { return ''; } };
  key = stored('naku.buyer.clave') || stored('naku.clave');
  const fragment = new URLSearchParams(location.hash.slice(1));
  if(fragment.has('clave')) {
    key=fragment.get('clave');
    setKey(key);
    history.replaceState(null,'',location.pathname+location.search);
  }
  function setKey(value) {
    key=value;
    try { localStorage.setItem('naku.buyer.clave',key); } catch { /* funciona también sin storage */ }
  }
  async function encode(data) {
    const bytes=new Uint8Array(await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    let binary='';
    for(let i=0;i<bytes.length;i+=32768) binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return btoa(binary);
  }
  async function decode(data) {
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }
  async function request(path='',operation) {
    const r=await fetch(api+path,{
      method:operation?'PUT':'GET',headers:{'x-naku-clave':key,...(operation?{'content-type':'application/json'}:{})},
      body:operation?JSON.stringify({datos:await encode(operation)}):undefined,
      signal:AbortSignal.timeout(operation?90000:45000),cache:'no-store'
    });
    const data=await r.json();
    if(!r.ok) throw Object.assign(new Error(data.error||'No se pudo acceder al Buyer.'),{status:r.status});
    if(data.datos) data.data=await decode(data.datos);
    return data;
  }
  return {request,setKey,hasKey:()=>Boolean(key)};
})();
