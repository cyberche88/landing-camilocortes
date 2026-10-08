/**
 * Netlify Function — Crear preferencia de pago MercadoPago
 * Equivale al endpoint POST /create-preference de server.js
 * Se invoca en producción via: /.netlify/functions/create-preference
 * (netlify.toml redirige /create-preference → aquí)
 */

const { MercadoPagoConfig, Preference } = require('mercadopago');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

// Precio en USD; se cobra en COP convertido con la TRM del día.
const USD_PRICE = 89;
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

exports.handler = async (event) => {
    // Preflight CORS
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
        console.error('[MP] MP_ACCESS_TOKEN no configurado');
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Servidor mal configurado' }) };
    }

    try {
        const { name = '', email = '', phone = '', country = 'CO' } = JSON.parse(event.body || '{}');

        // DEPLOY_PRIME_URL es siempre la URL .netlify.app (más estable que el dominio custom)
        // URL es el dominio personalizado si está configurado
        const siteUrl = process.env.DEPLOY_PRIME_URL || process.env.URL || 'https://tu-sitio.netlify.app';
        console.log(`[MP] siteUrl usado: ${siteUrl}`);

        // Precio dinámico: 89 USD -> COP con la TRM del día
        const { trm, source } = await getTRM();
        const unitPrice = 1000; /* === PRECIO DE PRUEBA $1.000 COP — REVERTIR A: Math.round(USD_PRICE * trm) === */
        console.log(`[MP] Preferencia — ${name} <${email}> — TRM(${source})=${trm} → ${unitPrice} COP`);

        const client = new MercadoPagoConfig({ accessToken, options: { timeout: 8000 } });
        const preference = new Preference(client);

        const result = await preference.create({
            body: {
                items: [{
                    id:          'ENTRADA-EL-CODIGO-DEL-FUTURO',
                    title:       'El Código del Futuro — Entrada General',
                    description: '18 de Octubre · 8:00am–6:00pm · Centro de Convenciones Ágora, Bogotá',
                    category_id: 'tickets',
                    quantity:    1,
                    unit_price:  unitPrice,
                    currency_id: 'COP'
                }],

                payer: {
                    name:  name  || undefined,
                    email: email || undefined,
                    phone: phone
                        ? { area_code: country === 'CO' ? '57' : '', number: phone.replace(/\D/g, '').slice(-10) }
                        : undefined,
                },

                back_urls: {
                    success: `${siteUrl}/?status=approved`,
                    failure: `${siteUrl}/?status=rejected`,
                    pending: `${siteUrl}/?status=in_process`
                },
                auto_return: 'approved',

                // Sin restricciones de método de pago — dejar que MP muestre todo
                statement_descriptor: 'BE IMPARABLES',
                external_reference:   `EVENTO-${Date.now()}`,
                // Usar siempre la URL .netlify.app para el webhook (más estable que dominio custom)
                notification_url: `https://landing-camilocortes.netlify.app/.netlify/functions/webhook`,
            }
        });

        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                id:                 result.id,
                init_point:         result.init_point,
                sandbox_init_point: result.sandbox_init_point
            })
        };

    } catch (err) {
        console.error('[MP] Error creando preferencia:', err?.message || err);
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'No se pudo crear la preferencia de pago' })
        };
    }
};
