import fs from 'node:fs';

export function sharedClient(root) {
  const buyer=fs.readFileSync(root+'/src/buyer.mjs','utf8').replace(/^import .*;\n/gm,'').replace(/^export\s+/gm,'');
  const sources=fs.readFileSync(root+'/src/ventas-compartidas.mjs','utf8').split('export function buildShared')[0].replace(/^import .*;\n/gm,'').replace(/^export\s+/gm,'');
  return `window.NakuBuyer=(function({buildMaestro,makeMatcher,normSku}){\n${buyer}\nreturn {BUYER_COLS,parseCSV,parseMaestro,packLines,unpackLines,lineKey,mergeMaestro,mergeBuyer,buyerPeriodMonths};})(window.NakuMotor?.engine||window);\n`
    + `window.NakuVentas=(()=>{\n${sources}\nreturn {cleanExport};})();\n`
    + fs.readFileSync(root+'/web/buyer-sync.js','utf8');
}
