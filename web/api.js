// api.js — cliente del backend Apps Script (sin dependencias).
// El frontend parsea los archivos con engine.mjs y usa esto para persistir/leer.
// Nota CORS: POST va como text/plain para evitar el preflight que Apps Script no maneja.

const NakuApi = {
  base: '',    // URL del Web App terminada en /exec  (setear al deployar)
  token: '',   // el mismo TOKEN que en Code.gs CONFIG

  async _get(action) {
    const url = `${this.base}?action=${action}&token=${encodeURIComponent(this.token)}`;
    const r = await fetch(url);
    return r.json();
  },
  async _post(payload) {
    const r = await fetch(this.base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // simple request → sin preflight
      body: JSON.stringify(Object.assign({ token: this.token }, payload)),
    });
    return r.json();
  },

  ping() { return this._get('ping'); },
  getRollup() { return this._get('rollup'); },     // → { ok, rollup }
  getMaestro() { return this._get('maestro'); },   // → { ok, maestro:[{SKU,...}] }

  // Guarda líneas normalizadas en chunks (evita payloads gigantes). Recomputa el
  // rollup al enviar el último chunk (final:true) y lo devuelve.
  async saveLines(lines, opts = {}) {
    const chunk = opts.chunk || 4000;
    let added = 0, skipped = 0, rollup = null;
    for (let i = 0; i < lines.length; i += chunk) {
      const slice = lines.slice(i, i + chunk);
      const final = i + chunk >= lines.length;
      const res = await this._post({ action: 'save', lines: slice, final });
      if (!res.ok) throw new Error(res.error || 'save falló');
      added += res.added || 0; skipped += res.skipped || 0;
      if (res.rollup) rollup = res.rollup;
      if (opts.onProgress) opts.onProgress({ done: Math.min(i + chunk, lines.length), total: lines.length, added, skipped });
    }
    return { added, skipped, rollup };
  },
};

// export para módulos; en browser plano queda como global window.NakuApi
if (typeof module !== 'undefined') module.exports = { NakuApi };
