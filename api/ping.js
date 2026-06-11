// api/ping.js
// El dashboard lo llama cada 10s para saber si llegó un evento nuevo.
// Si hay novedades responde con X-Has-New-Events: true y borra el flag.

const UPSTASH_URL   = process.env.STORAGE_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.STORAGE_REDIS_REST_TOKEN;

async function redis(command, ...args) {
  const res = await fetch(`${UPSTASH_URL}/${[command, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const data = await res.json();
  return data.result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Leer y borrar el flag atómicamente (getdel)
    const flag = await redis('getdel', 'new_event');
    const hasNew = flag === '1' || flag === 1;

    res.setHeader('X-Has-New-Events', hasNew ? 'true' : 'false');
    return res.status(200).json({ hasNew });
  } catch (err) {
    // Si falla Redis, no romper el dashboard — simplemente decir que no hay eventos
    res.setHeader('X-Has-New-Events', 'false');
    return res.status(200).json({ hasNew: false });
  }
}
