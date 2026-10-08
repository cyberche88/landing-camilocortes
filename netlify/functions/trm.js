/**
 * Netlify Function — TRM del día (USD -> COP)
 * Devuelve el precio del ticket ($149 USD) convertido a COP con la TRM vigente.
 * Se invoca via /trm (redirigido en netlify.toml).
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, max-age=0'
};

const USD_PRICE = 149;
const FALLBACK_TRM = 4200; // conservador, solo si fallan las 2 fuentes

async function fetchJSON(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
    return await r.json();
  } finally { clearTimeout(t); }
}

async function getTRM() {
  // 1) TRM oficial Colombia (Superfinanciera vía datos.gov.co)
  try {
    const j = await fetchJSON('https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1');
    const v = parseFloat(j && j[0] && j[0].valor);
    if (v > 1000) return { trm: v, source: 'datos.gov.co' };
  } catch (e) { /* sigue */ }
  // 2) Mercado (open.er-api, sin key)
  try {
    const j = await fetchJSON('https://open.er-api.com/v6/latest/USD');
    const v = parseFloat(j && j.rates && j.rates.COP);
    if (v > 1000) return { trm: v, source: 'er-api' };
  } catch (e) { /* sigue */ }
  // 3) fallback
  return { trm: FALLBACK_TRM, source: 'fallback' };
}

exports.handler = async () => {
  const { trm, source } = await getTRM();
  const cop = Math.round(USD_PRICE * trm);
  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ usd: USD_PRICE, trm, cop, source })
  };
};
