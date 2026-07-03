// baskets.mjs — sondea señal de co-compra (market basket) en los exports reales.
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import * as E from '../src/engine.mjs';
const DATA = '/Users/agustin/Desktop/Developer/Calcula/Naku/Tablero Buyer Naku';
function parseCSV(t,d){const rows=[];let f='',row=[],q=false;for(let i=0;i<t.length;i++){const c=t[i];
  if(q){if(c==='"'){if(t[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}
  else if(c==='"')q=true; else if(c===d){row.push(f);f='';}
  else if(c==='\n'){row.push(f);rows.push(row);row=[];f='';} else if(c==='\r'){} else f+=c;}
  if(f.length||row.length){row.push(f);rows.push(row);}return rows;}
const maestro=E.buildMaestro(parseCSV(fs.readFileSync(DATA+'/Naku - SKU+Buyer+Cat.csv','utf8'),';'));
const match=E.makeMatcher(maestro);
let all=[];
for(const fn of fs.readdirSync(DATA).filter(f=>f.endsWith('.xlsx')).sort())
  all=all.concat(E.ingestMeli(XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(DATA+'/'+fn),{type:'buffer'}).Sheets['Ventas AR'],{header:1,raw:true,defval:''}),match,fn));
all=all.concat(E.ingestTn(parseCSV(fs.readFileSync(DATA+'/Naku - Ventas Historias TN.csv').toString('latin1'),';'),match,'TN'));
all=E.dedupe(all).lines;

// agrupar por orden -> set de SKUs distintos
const orders=new Map();
for(const l of all){ if(!l.billable||!l.sku) continue; const k=l.canal+'|'+l.order_id;
  const o=orders.get(k)||{skus:new Map(),buyers:new Set()}; o.skus.set(l.sku,l); o.buyers.add(l.buyer); orders.set(k,o); }
let multi=0,total=0; const pairs=new Map(); const distinct=[];
for(const o of orders.values()){ total++; const skus=[...o.skus.keys()]; distinct.push(skus.length);
  if(skus.length>=2){ multi++;
    for(let i=0;i<skus.length;i++)for(let j=i+1;j<skus.length;j++){
      const a=o.skus.get(skus[i]), b=o.skus.get(skus[j]);
      const key=[skus[i],skus[j]].sort().join(' + ');
      const p=pairs.get(key)||{n:0,a,b}; p.n++; pairs.set(key,p);
    }
  }
}
console.log('órdenes totales:',total,'| con ≥2 SKU distintos:',multi,`(${(100*multi/total).toFixed(1)}%)`);
console.log('promedio SKU distintos/orden:',(distinct.reduce((a,b)=>a+b,0)/total).toFixed(2));
console.log('\nTOP 18 pares co-comprados:');
[...pairs.values()].sort((a,b)=>b.n-a.n).slice(0,18).forEach(p=>{
  const cross=p.a.buyer!==p.b.buyer?`  ⟂ ${p.a.buyer}×${p.b.buyer}`:`  = ${p.a.buyer}`;
  console.log(`  ${String(p.n).padStart(4)}×  ${p.a.sku} + ${p.b.sku}  |  ${p.a.familia} + ${p.b.familia}${cross}`);
});
// por persona: con qué se co-compran sus héroes (SKUs de OTRA familia/persona)
console.log('\nCo-compra saliendo de cada persona (top pares donde participa):');
for(const P of ['Martin','Juan','Mariana']){
  const rel=[...pairs.values()].filter(p=>p.a.buyer===P||p.b.buyer===P).sort((a,b)=>b.n-a.n).slice(0,4);
  console.log(' '+P+':', rel.map(p=>`${p.a.sku}+${p.b.sku}(${p.n})`).join('  ')||'—');
}
