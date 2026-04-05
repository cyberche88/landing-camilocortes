/**
 * BE IMPARABLES — Backend para pagos con MercadoPago
 * Evento: El Futuro Es Ahora · 11 de Abril · Bogotá
 *
 * SETUP:
 *   1. npm install
 *   2. Copia .env.example → .env  y rellena tus credenciales
 *   3. npm start   (o: npm run dev  para desarrollo con auto-reload)
 *
 * La landing page se sirve estáticamente en http://localhost:3000
 */

require('dotenv').config();
const express  = require('express');
const path     = require('path');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
app.use(express.json());

// Servir la landing page y sus assets de forma estática
app.use(express.static(path.join(__dirname)));

// ─── CLIENTE MERCADOPAGO ──────────────────────────────────────────────────────
const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
    options: { timeout: 8000, idempotencyKey: undefined }
});

// ─── ENDPOINT: crear preferencia de pago ─────────────────────────────────────
app.post('/create-preference', async (req, res) => {
    try {
        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
        const { name = '', email = '', phone = '', country = 'CO' } = req.body;

        const preference = new Preference(mpClient);
        const result = await preference.create({
            body: {
                // ── Producto ──────────────────────────────────────────────────
                items: [{
                    id:          'BOLETA-EL-FUTURO-ES-AHORA',
                    title:       'El Futuro Es Ahora — Boleta General',
                    description: '2 días de educación financiera e inteligencia artificial · Bogotá',
                    picture_url: `${baseUrl}/og-image.jpg`,   // opcional
                    category_id: 'tickets',
                    quantity:    1,
                    unit_price:  280000,
                    currency_id: 'COP'
                }],

                // ── Datos del comprador ───────────────────────────────────────
                // En sandbox NO enviamos el email del formulario porque si
                // coincide con el email del vendedor MercadoPago rechaza el pago.
                // En producción sí lo pre-llenamos para mejorar la experiencia.
                payer: {
                    name: name || undefined,
                    ...(baseUrl.includes('localhost')
                        ? {}  // sandbox: dejar que el comprador ingrese su email en MP
                        : { email: email || undefined }
                    ),
                    phone: phone
                        ? { area_code: country === 'CO' ? '57' : '', number: phone.replace(/\D/g, '').slice(-10) }
                        : undefined,
                },

                // ── Redirección post-pago ────────────────────────────────────
                // auto_return solo funciona con URLs públicas (no localhost).
                // En desarrollo se omite; en producción se activa automáticamente.
                ...(!baseUrl.includes('localhost') && {
                    back_urls: {
                        success: `${baseUrl}/?status=approved`,
                        failure: `${baseUrl}/?status=rejected`,
                        pending: `${baseUrl}/?status=in_process`
                    },
                    auto_return: 'approved'
                }),

                // ── Métodos de pago ──────────────────────────────────────────
                payment_methods: {
                    installments: 1           // sin cuotas — pago completo
                    // excluded_payment_types: [{ id: 'ticket' }]  // descomentar para excluir efectivo
                },

                // ── Metadata ─────────────────────────────────────────────────
                statement_descriptor: 'BE IMPARABLES',
                external_reference:   `EVENTO-${Date.now()}`,

                // ── Notificaciones (Webhook) — solo con URL pública ──────────
                ...(!baseUrl.includes('localhost') && {
                    notification_url: process.env.WEBHOOK_URL || `${baseUrl}/webhook`
                }),
            }
        });

        res.json({
            id:                  result.id,
            init_point:          result.init_point,          // producción
            sandbox_init_point:  result.sandbox_init_point   // testing
        });

    } catch (err) {
        console.error('[MercadoPago] Error creando preferencia:', err?.message || err);
        res.status(500).json({ error: 'No se pudo crear la preferencia de pago. Intenta nuevamente.' });
    }
});

// ─── ENDPOINT: Webhook de notificaciones ─────────────────────────────────────
// MercadoPago envía aquí las actualizaciones de estado de pago en tiempo real.
app.post('/webhook', async (req, res) => {
    const { type, data } = req.body;

    // Responder 200 rápido para que MP no reintente
    res.sendStatus(200);

    if (type === 'payment' && data?.id) {
        try {
            const paymentApi = new Payment(mpClient);
            const payment    = await paymentApi.get({ id: data.id });

            console.log(`[Webhook] Pago ${data.id} — Estado: ${payment.status}`);

            // TODO: aquí puedes:
            //   - Registrar el pago en tu base de datos
            //   - Enviar email de confirmación (Brevo, SendGrid, etc.)
            //   - Marcar el cupo como vendido
            switch (payment.status) {
                case 'approved':
                    console.log(`✅ BOLETA CONFIRMADA — ${payment.payer?.email} — Ref: ${payment.external_reference}`);
                    break;
                case 'rejected':
                    console.log(`❌ PAGO RECHAZADO — ${payment.payer?.email}`);
                    break;
                case 'in_process':
                case 'pending':
                    console.log(`⏳ PAGO PENDIENTE — ${payment.payer?.email}`);
                    break;
            }
        } catch (err) {
            console.error('[Webhook] Error procesando notificación:', err?.message);
        }
    }
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    const ok  = !!process.env.MP_ACCESS_TOKEN;
    const env = (process.env.MP_ACCESS_TOKEN || '').startsWith('TEST-') ? 'SANDBOX' : 'PRODUCCIÓN';

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('   BE IMPARABLES — Servidor de pagos');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`   🌐  Landing page:  http://localhost:${PORT}`);
    console.log(`   💳  MercadoPago:   ${ok ? `Configurado ✓  (${env})` : '⚠ MP_ACCESS_TOKEN no configurado'}`);
    console.log(`   🔔  Webhook:       POST /webhook`);
    console.log('═══════════════════════════════════════════════════════\n');

    if (!ok) {
        console.warn('  ⚠  Copia .env.example → .env y configura tus credenciales de MercadoPago\n');
    }
});
