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

        console.log(`[MP] Creando preferencia — Comprador: ${name} <${email}> — siteUrl: ${siteUrl}`);

        const client = new MercadoPagoConfig({ accessToken, options: { timeout: 8000 } });
        const preference = new Preference(client);

        const result = await preference.create({
            body: {
                items: [{
                    id:          'BOLETA-EL-FUTURO-ES-AHORA',
                    title:       'El Futuro Es Ahora — Boleta General',
                    description: '2 días · 11 y 12 de Abril · Bogotá',
                    category_id: 'tickets',
                    quantity:    1,
                    unit_price:  280000,
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
