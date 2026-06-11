// api/webhook-whop.js
// Recibe webhooks de Whop cuando se completa un pago real

const UPSTASH_URL        = process.env.KV_REST_API_URL;
const UPSTASH_TOKEN      = process.env.KV_REST_API_TOKEN;
const TELEGRAM_TOKEN     = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT      = process.env.TELEGRAM_CHAT_ID;
const WHOP_WEBHOOK_SECRET = process.env.WHOP_WEBHOOK_SECRET;

async function redis(command, ...args) {
  const res = await fetch(`${UPSTASH_URL}/${[command, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const data = await res.json();
  return data.result;
}

function nowAR() {
  return new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function getDateKey() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
}

// Verificar firma de Whop
async function verifyWhopSignature(req, rawBody) {
  try {
    const signature = req.headers['whop-signature'] || req.headers['x-whop-signature'] || '';
    if (!WHOP_WEBHOOK_SECRET || !signature) return true; // si no hay secret configurado, dejar pasar
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(WHOP_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Buffer.from(signature.replace('sha256=', ''), 'hex');
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(rawBody));
    return valid;
  } catch (_) {
    return true; // en caso de error en verificación, dejar pasar
  }
}

async function redis(command, ...args) {
  const res = await fetch(`${UPSTASH_URL}/${[command, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const data = await res.json();
  return data.result;
}

function nowAR() {
  return new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function getDateKey() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
}

// Mapa de plan IDs de Whop a nombres y precios reales
const PLAN_MAP = {
  'plan_B764A7Z74h9OR': { name: 'Tarot 3 Tiradas',  usd: 2.99 },
  'plan_QVWoyUKqtKPlq': { name: 'Tarot 10 Tiradas', usd: 7.99 },
  'plan_k9UunKYAPYBui': { name: 'Tarot Semanal',    usd: 9.99 },
};

async function sendTelegram(msg) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: msg, parse_mode: 'HTML' }),
    });
  } catch (_) {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const rawBody = JSON.stringify(req.body);
    const valid = await verifyWhopSignature(req, rawBody);
    if (!valid) return res.status(401).json({ error: 'Invalid signature' });

    const body = req.body;
    const eventType = body?.action || body?.event || body?.type;

    // Solo procesar pagos exitosos
    if (eventType !== 'payment_succeeded' && eventType !== 'membership_activated') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    // Extraer datos del pago
    const data     = body?.data || body;
    const planId   = data?.plan_id || data?.membership?.plan_id || data?.product_id || null;
    const email    = data?.user?.email || data?.email || null;
    const username = data?.user?.username || data?.username || email || 'Comprador';

    // Precio: usar el del mapa si conocemos el plan, sino lo que mande Whop
    let amountUSD = parseFloat(data?.final_amount || data?.amount || data?.price || 0) / 100;
    if (amountUSD === 0 && planId && PLAN_MAP[planId]) {
      amountUSD = PLAN_MAP[planId].usd;
    }
    const planName = (planId && PLAN_MAP[planId]?.name) || planId || 'Plan';

    const today = getDateKey();
    const hora  = nowAR();

    // Guardar en Redis
    await Promise.all([
      redis('incr', 'total:purchases'),
      redis('incr', `purchases:${today}`),
      redis('incrbyfloat', 'total:revenue', String(amountUSD)),
      redis('incrbyfloat', `revenue:${today}`, String(amountUSD)),
      redis('set', 'new_event', '1', 'EX', '60'),
    ]);

    // Feed de eventos
    const feedEvent = JSON.stringify({
      event: 'purchase',
      name: username,
      category: planName,
      country: null,
      isMobile: false,
      ts: hora,
    });
    await redis('lpush', 'feed:events', feedEvent);
    await redis('ltrim', 'feed:events', '0', '49');

    // Notificar por Telegram
    await sendTelegram(
      `💰 <b>¡Compra completada!</b>\n` +
      `👤 Usuario: <b>${username}</b>\n` +
      `📦 Plan: <b>${planName}</b>\n` +
      `💵 Monto: <b>$${amountUSD.toFixed(2)} USD</b>\n` +
      `🕐 Hora: ${hora}`
    );

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
