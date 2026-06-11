// api/track.js
// Recibe eventos del tarot app y los guarda en Upstash Redis

const UPSTASH_URL   = process.env.STORAGE_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.STORAGE_REDIS_REST_TOKEN;

async function redis(command, ...args) {
  const res = await fetch(`${UPSTASH_URL}/${[command, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const data = await res.json();
  return data.result;
}

// Hora en Argentina
function nowAR() {
  return new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function getDateKey() {
  // "2026-06-11"
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function getHour() {
  return parseInt(new Date().toLocaleString('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: 'numeric',
    hour12: false
  }));
}

function getDayOfWeek() {
  // 0=Domingo ... 6=Sabado
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'short'
  }); // "Mon", "Tue", etc
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { event, name, category, country, timezone, isMobile } = req.body;
  if (!event) return res.status(400).json({ error: 'Falta event' });

  const today   = getDateKey();   // "2026-06-11"
  const hour    = getHour();      // 0-23
  const dow     = getDayOfWeek(); // "Mon"

  const pipe = [];

  // ── Contadores globales (acumulados forever) ──────────────────────────
  if (event === 'session') {
    pipe.push(redis('incr', 'total:sessions'));
    pipe.push(redis('incr', `sessions:${today}`));
    pipe.push(redis('incr', `heatmap:${dow}:${hour}`));
    if (country) {
      pipe.push(redis('zincrby', 'countries', '1', country));
    }
  }

  if (event === 'reading') {
    pipe.push(redis('incr', 'total:readings'));
    pipe.push(redis('incr', `readings:${today}`));
    if (category) {
      pipe.push(redis('zincrby', 'categories', '1', category));
    }
  }

  if (event === 'paywall') {
    pipe.push(redis('incr', 'total:paywall'));
    pipe.push(redis('incr', `paywall:${today}`));
  }

  if (event === 'purchase') {
    const { plan, amount } = req.body;
    pipe.push(redis('incr', 'total:purchases'));
    pipe.push(redis('incr', `purchases:${today}`));
    if (amount) {
      pipe.push(redis('incrbyfloat', 'total:revenue', String(amount)));
      pipe.push(redis('incrbyfloat', `revenue:${today}`, String(amount)));
    }
  }

  // ── Live feed (últimos 50 eventos) ────────────────────────────────────
  const feedEvent = JSON.stringify({
    event,
    name: name || 'Alguien',
    category: category || null,
    country: country || null,
    isMobile: isMobile ?? true,
    ts: nowAR(),
  });
  pipe.push(
    redis('lpush', 'feed:events', feedEvent)
      .then(() => redis('ltrim', 'feed:events', '0', '49'))
  );

  // Actualizar usuarios activos (ventana de 5 minutos con TTL)
  pipe.push(redis('set', `active:${name || 'anon'}:${Date.now()}`, '1', 'EX', '300'));

  await Promise.all(pipe);

  // Flag para live push — el ping endpoint lo lee y lo borra
  await redis('set', 'new_event', '1', 'EX', '60');

  return res.status(200).json({ ok: true });
}
