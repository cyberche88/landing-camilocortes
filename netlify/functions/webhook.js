/**
 * Netlify Function — Webhook de notificaciones MercadoPago
 * URL: /.netlify/functions/webhook
 *
 * Para ver los logs en tiempo real:
 * Netlify Dashboard → tu sitio → Functions → webhook → Ver logs
 */

const { MercadoPagoConfig, Payment } = require('mercadopago');

// Tabla de motivos de rechazo de MercadoPago en español
const REJECTION_REASONS = {
    cc_rejected_bad_filled_card_number: '❌ Número de tarjeta mal ingresado',
    cc_rejected_bad_filled_date:        '❌ Fecha de vencimiento incorrecta',
    cc_rejected_bad_filled_other:       '❌ Datos de tarjeta incorrectos',
    cc_rejected_bad_filled_security_code: '❌ CVV incorrecto',
    cc_rejected_blacklist:              '❌ Tarjeta bloqueada por el banco',
    cc_rejected_call_for_authorize:     '❌ Banco requiere autorización manual — cliente debe llamar al banco',
    cc_rejected_card_disabled:          '❌ Tarjeta no habilitada para compras online',
    cc_rejected_card_error:             '❌ Error procesando la tarjeta',
    cc_rejected_duplicated_payment:     '❌ Pago duplicado detectado',
    cc_rejected_high_risk:              '❌ Rechazado por sistema antifraude',
    cc_rejected_insufficient_amount:    '❌ Fondos insuficientes',
    cc_rejected_invalid_installments:   '❌ Cuotas no permitidas para esta tarjeta',
    cc_rejected_max_attempts:           '❌ Máximo de intentos alcanzado — tarjeta bloqueada temporalmente',
    cc_rejected_other_reason:           '❌ Rechazo del banco sin motivo especificado',
    pending_contingency:                '⏳ Pago pendiente — procesando',
    pending_review_manual:              '⏳ En revisión manual por MercadoPago',
};

exports.handler = async (event) => {
    // GET simple para verificar que el webhook está activo
    if (event.httpMethod === 'GET') {
        return {
            statusCode: 200,
            body: JSON.stringify({ ok: true, msg: 'Webhook activo ✓', ts: new Date().toISOString() })
        };
    }

    console.log('═══════════════════════════════════════');
    console.log('[Webhook] Notificación recibida');
    console.log('[Webhook] Body:', event.body);
    console.log('═══════════════════════════════════════');

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

    // ── Formato nuevo: type/data (IPN v2) ───────────────────────
    if (body.type === 'payment' && body.data?.id) {
        await procesarPago(body.data.id, client);

    // ── Formato viejo: topic/resource (IPN v1) ───────────────────
    } else if (body.topic === 'merchant_order' && body.resource) {
        try {
            // Consultar la merchant_order para obtener los payment_ids
            const res = await fetch(body.resource, {
                headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
            });
            const order = await res.json();
            console.log(`[Webhook] merchant_order ${order.id} — status: ${order.order_status}`);
            console.log(`[Webhook] Pagos en la orden: ${order.payments?.length || 0}`);

            for (const p of (order.payments || [])) {
                console.log(`[Webhook] → Procesando pago ID: ${p.id} status: ${p.status}`);
                await procesarPago(p.id, client);
            }
        } catch (err) {
            console.error('[Webhook] Error consultando merchant_order:', err?.message);
        }

    } else if (body.topic === 'payment' && body.resource) {
        // Extraer ID del resource URL
        const paymentId = body.resource.split('/').pop();
        await procesarPago(paymentId, client);
    }

    return { statusCode: 200, body: 'OK' };
};

async function procesarPago(paymentId, client) {
    try {
        const payment = await new Payment(client).get({ id: paymentId });
        const motivo  = REJECTION_REASONS[payment.status_detail] || payment.status_detail || 'sin detalle';

        console.log('─── DETALLE DEL PAGO ───────────────────');
        console.log(`  ID:             ${payment.id}`);
        console.log(`  Estado:         ${payment.status}`);
        console.log(`  Motivo:         ${payment.status_detail}`);
        console.log(`  Descripción:    ${motivo}`);
        console.log(`  Método:         ${payment.payment_method_id} / ${payment.payment_type_id}`);
        console.log(`  Monto:          $${payment.transaction_amount} ${payment.currency_id}`);
        console.log(`  Pagador:        ${payment.payer?.email}`);
        console.log(`  Titular tarj:   ${payment.card?.cardholder?.name || 'N/A'}`);
        console.log(`  Referencia:     ${payment.external_reference}`);
        console.log('────────────────────────────────────────');

        if (payment.status === 'approved') {
            console.log(`✅ BOLETA CONFIRMADA — ${payment.payer?.email}`);
            await enviarConfirmacion(payment);
        } else if (payment.status === 'rejected') {
            console.log(`🚨 PAGO RECHAZADO — ${motivo}`);
            console.log(`   → ${getSuggestion(payment.status_detail)}`);
        } else {
            console.log(`⏳ PAGO PENDIENTE — ${payment.status} — ${payment.payer?.email}`);
        }
    } catch (err) {
        console.error(`[Webhook] Error consultando pago ${paymentId}:`, err?.message);
    }
}

function getSuggestion(statusDetail) {
    const suggestions = {
        cc_rejected_card_disabled:       'El cliente debe habilitar compras online en la app de su banco',
        cc_rejected_call_for_authorize:  'El cliente debe llamar a su banco para autorizar el pago',
        cc_rejected_insufficient_amount: 'El cliente no tiene fondos suficientes',
        cc_rejected_high_risk:           'MercadoPago bloqueó por antifraude — contactar soporte MP',
        cc_rejected_max_attempts:        'Demasiados intentos — el cliente debe esperar 24h',
        cc_rejected_blacklist:           'Tarjeta bloqueada — el cliente debe contactar su banco',
    };
    return suggestions[statusDetail] || 'Revisar con el cliente qué banco y tipo de tarjeta usó';
}

// ── Confirmación: correo (Resend) + lista de asistentes (Google Sheet) ──
async function enviarConfirmacion(payment) {
    const md     = payment.metadata || {};
    const correo = md.correo || payment.payer?.email;
    const nombre = md.nombre || payment.payer?.first_name || 'Asistente';
    const tel    = md.telefono || '';
    const monto  = payment.transaction_amount;
    const moneda = payment.currency_id;
    const ref    = payment.external_reference || ('MP-' + payment.id);
    const fecha  = new Date().toISOString();

    // 1) Lista de asistentes → Google Sheet (Apps Script)
    if (process.env.SHEET_WEBHOOK_URL) {
        try {
            await fetch(process.env.SHEET_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, correo, telefono: tel, monto, moneda, referencia: ref, pago_id: String(payment.id), estado: 'approved', fecha })
            });
            console.log('[Sheet] Asistente registrado: ' + correo);
        } catch (e) { console.error('[Sheet] Error:', e && e.message); }
    }

    // 2) Correo de confirmación → Resend
    if (process.env.RESEND_API_KEY && correo) {
        try {
            const r = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: process.env.MAIL_FROM || 'El Codigo del Futuro <onboarding@resend.dev>',
                    to: [correo],
                    subject: 'Tu entrada a El Codigo del Futuro esta confirmada',
                    html: emailHTML(nombre, ref)
                })
            });
            console.log('[Resend] Correo a ' + correo + ' status ' + r.status);
        } catch (e) { console.error('[Resend] Error:', e && e.message); }
    }
}

function emailHTML(nombre, ref) {
    return [
'<div style="margin:0;padding:0;background:#080611;">',
'<div style="max-width:560px;margin:0 auto;padding:32px 24px;background:#0E0A1E;color:#F4F1FF;font-family:Arial,Helvetica,sans-serif;border-radius:14px;">',
'<div style="letter-spacing:4px;font-size:12px;color:#B98CFF;text-transform:uppercase;">be - Imparables</div>',
'<h1 style="font-size:26px;margin:10px 0 6px;color:#ffffff;">Tu entrada esta confirmada</h1>',
'<p style="color:#A99FC9;font-size:15px;line-height:1.5;">Hola ' + nombre + ', tu lugar en <b style="color:#ffffff;">El Codigo del Futuro</b> quedo asegurado. Gracias por dar el paso.</p>',
'<div style="background:#140F29;border:1px solid #2E2359;border-radius:12px;padding:18px;margin:18px 0;">',
'<div style="font-size:12px;color:#726A94;text-transform:uppercase;letter-spacing:2px;">Detalles del evento</div>',
'<p style="margin:8px 0 0;font-size:15px;line-height:1.7;color:#F4F1FF;">Domingo 18 de octubre<br>8:00am - 6:00pm<br>Centro de Convenciones Agora, Bogota</p>',
'</div>',
'<div style="background:#1D1640;border:1px solid #2E2359;border-radius:12px;padding:16px;margin:0 0 18px;text-align:center;">',
'<div style="font-size:12px;color:#726A94;text-transform:uppercase;letter-spacing:2px;">Tu codigo de entrada</div>',
'<div style="font-family:monospace;font-size:22px;color:#FFD27A;letter-spacing:2px;margin-top:6px;">' + ref + '</div>',
'<div style="font-size:12px;color:#A99FC9;margin-top:6px;">Presenta este correo y tu documento en la entrada.</div>',
'</div>',
'<p style="color:#A99FC9;font-size:14px;line-height:1.6;">Te escribiremos por WhatsApp con los ultimos detalles. Si tienes dudas, responde este correo.</p>',
'<p style="color:#726A94;font-size:12px;margin-top:22px;border-top:1px solid #2E2359;padding-top:14px;">El Codigo del Futuro - be - Imparables</p>',
'</div></div>'
    ].join('');
}
