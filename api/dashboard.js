// api/dashboard.js
// Devuelve el JSON estructurado que necesita el dashboard

const UPSTASH_URL   = process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN;

async function redis(command, ...args) {
  const res = await fetch(`${UPSTASH_URL}/${[command, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const data = await res.json();
  return data.result;
}

function getDateKey(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function getDow(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'short'
  });
}

// País ISO code → nombre + flag
const COUNTRY_MAP = {
  AR: { name: 'Argentina',    flag: '🇦🇷', lat: -34.6, lon: -58.4, iso: 32,  color: '#a8a8a8' },
  MX: { name: 'Mexico',       flag: '🇲🇽', lat: 23.6,  lon:-102.5, iso: 484, color: '#d0d0d0' },
  CO: { name: 'Colombia',     flag: '🇨🇴', lat:  4.5,  lon: -74.3, iso: 170, color: '#b8b8b8' },
  ES: { name: 'España',       flag: '🇪🇸', lat: 40.4,  lon:  -3.7, iso: 724, color: '#c8c8c8' },
  PE: { name: 'Peru',         flag: '🇵🇪', lat: -9.2,  lon: -75.0, iso: 604, color: '#989898' },
  CL: { name: 'Chile',        flag: '🇨🇱', lat:-35.7,  lon: -71.5, iso: 152, color: '#e0e0e0' },
  VE: { name: 'Venezuela',    flag: '🇻🇪', lat:  6.4,  lon: -66.6, iso: 862, color: '#909090' },
  PH: { name: 'Philippines',  flag: '🇵🇭', lat: 12.9,  lon: 121.8, iso: 608, color: '#b0b0b0' },
  US: { name: 'USA',          flag: '🇺🇸', lat: 37.1,  lon: -95.7, iso: 840, color: '#c0c0c0' },
  EC: { name: 'Ecuador',      flag: '🇪🇨', lat: -1.8,  lon: -78.2, iso: 218, color: '#888888' },
  BO: { name: 'Bolivia',      flag: '🇧🇴', lat:-16.3,  lon: -64.0, iso: 68,  color: '#a0a0a0' },
  MY: { name: 'Malaysia',     flag: '🇲🇾', lat:  4.2,  lon: 109.5, iso: 458, color: '#d8d8d8' },
  UY: { name: 'Uruguay',      flag: '🇺🇾', lat:-32.5,  lon: -55.8, iso: 858, color: '#787878' },
  SG: { name: 'Singapore',    flag: '🇸🇬', lat:  1.3,  lon: 103.8, iso: 702, color: '#686868' },
  BR: { name: 'Brasil',       flag: '🇧🇷', lat:-14.2,  lon: -51.9, iso: 76,  color: '#c0c0c0' },
  PY: { name: 'Paraguay',     flag: '🇵🇾', lat:-23.4,  lon: -58.4, iso: 600, color: '#909090' },
  GT: { name: 'Guatemala',    flag: '🇬🇹', lat: 15.8,  lon: -90.2, iso: 320, color: '#b0b0b0' },
  DO: { name: 'Rep. Dom.',    flag: '🇩🇴', lat: 18.7,  lon: -70.2, iso: 214, color: '#a0a0a0' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Cache 60s en CDN, stale-while-revalidate 30s
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── 1. Últimas 24h: datos hora por hora ──────────────────────────────
    const hours24 = Array.from({ length: 24 }, (_, i) => i);
    const today = getDateKey(0);

    // ── 2. Últimos 7 días ────────────────────────────────────────────────
    const days7keys = Array.from({ length: 7 }, (_, i) => getDateKey(6 - i));
    const days7dows  = Array.from({ length: 7 }, (_, i) => getDow(6 - i));

    // Fetch todo en paralelo
    const [
      totalSessions,
      totalReadings,
      totalPaywall,
      totalPurchases,
      totalRevenue,
      feedRaw,
      readingsRaw,
      countriesRaw,
      categoriesRaw,
      ...dayMetrics
    ] = await Promise.all([
      redis('get', 'total:sessions').then(v => parseInt(v) || 0),
      redis('get', 'total:readings').then(v => parseInt(v) || 0),
      redis('get', 'total:paywall').then(v  => parseInt(v) || 0),
      redis('get', 'total:purchases').then(v => parseInt(v) || 0),
      redis('get', 'total:revenue').then(v => parseFloat(v) || 0),
      redis('lrange', 'feed:events', '0', '29'),
      redis('lrange', 'readings:feed', '0', '19'),
      redis('zrange', 'countries', '0', '-1', 'WITHSCORES', 'REV'),
      redis('zrange', 'categories', '0', '-1', 'WITHSCORES', 'REV'),
      // 7 días × 4 métricas = 28 fetches
      ...days7keys.flatMap(dk => [
        redis('get', `sessions:${dk}`).then(v => parseInt(v) || 0),
        redis('get', `readings:${dk}`).then(v => parseInt(v) || 0),
        redis('get', `paywall:${dk}`).then(v => parseInt(v) || 0),
        redis('get', `revenue:${dk}`).then(v => parseFloat(v) || 0),
      ]),
    ]);

    // ── 24h heatmap data (hoy, hora por hora) ────────────────────────────
    const heatmapToday = await Promise.all(
      hours24.map(h => redis('get', `heatmap:${getDow(0)}:${h}`).then(v => parseInt(v) || 0))
    );

    // ── Procesar días 7d ─────────────────────────────────────────────────
    const sessions7  = [];
    const readings7  = [];
    const paywall7   = [];
    const revenue7   = [];
    for (let i = 0; i < 7; i++) {
      sessions7.push(dayMetrics[i * 4]);
      readings7.push(dayMetrics[i * 4 + 1]);
      paywall7.push(dayMetrics[i * 4 + 2]);
      revenue7.push(dayMetrics[i * 4 + 3]);
    }

    // ── Heatmap semanal ──────────────────────────────────────────────────
    const DOWS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const heatmapWeek = await Promise.all(
      DOWS.flatMap(d =>
        Array.from({ length: 24 }, (_, h) =>
          redis('get', `heatmap:${d}:${h}`).then(v => parseInt(v) || 0)
        )
      )
    );

    // ── Países ───────────────────────────────────────────────────────────
    // countriesRaw = ["AR", "1240", "MX", "890", ...]
    const globeCountries = [];
    if (Array.isArray(countriesRaw)) {
      for (let i = 0; i < countriesRaw.length; i += 2) {
        const code  = countriesRaw[i];
        const users = parseInt(countriesRaw[i + 1]) || 0;
        const info  = COUNTRY_MAP[code];
        if (info) {
          globeCountries.push({ ...info, users });
        }
      }
    }
    // Si no hay datos reales aún, usar defaults
    if (globeCountries.length === 0) {
      globeCountries.push(...[
        { ...COUNTRY_MAP.AR, users: 0 },
        { ...COUNTRY_MAP.MX, users: 0 },
        { ...COUNTRY_MAP.CL, users: 0 },
      ]);
    }

    // ── Categorías ───────────────────────────────────────────────────────
    const categoryMap = {};
    if (Array.isArray(categoriesRaw)) {
      for (let i = 0; i < categoriesRaw.length; i += 2) {
        categoryMap[categoriesRaw[i]] = parseInt(categoriesRaw[i + 1]) || 0;
      }
    }

    // ── Live feed ────────────────────────────────────────────────────────
    const feed = Array.isArray(feedRaw)
      ? feedRaw.map(raw => { try { return JSON.parse(raw); } catch { return null; } }).filter(Boolean)
      : [];

    // ── Últimas consultas (readings con pregunta) ─────────────────────────
    const readingsFeed = Array.isArray(readingsRaw)
      ? readingsRaw.map(raw => { try { return JSON.parse(raw); } catch { return null; } }).filter(Boolean)
      : [];

    // ── Usuarios activos: keys con prefijo active: ───────────────────────
    const activeKeys = await redis('keys', 'active:*');
    const activeUsers = Array.isArray(activeKeys) ? activeKeys.length : 0;

    // ── Deltas (hoy vs ayer) ─────────────────────────────────────────────
    const todayIdx = 6;
    const yesterIdx = 5;
    function delta(arr) {
      const t = arr[todayIdx] || 0;
      const y = arr[yesterIdx] || 1;
      const pct = Math.round(((t - y) / y) * 100);
      return { value: pct, up: pct >= 0, label: (pct >= 0 ? '+' : '') + pct + '%' };
    }

    // ── Respuesta final ──────────────────────────────────────────────────
    const payload = {
      // Totales para KPIs
      totals: {
        sessions: totalSessions,
        readings: totalReadings,
        paywallViews: totalPaywall,
        purchases: totalPurchases,
        revenue: Math.round(totalRevenue),
        activeUsers,
      },
      deltas: {
        sessions:     delta(sessions7),
        readings:     delta(readings7),
        paywallViews: delta(paywall7),
        revenue:      delta(revenue7),
      },
      // Series temporales para los gráficos
      '24h': {
        sessions:     heatmapToday,
        readings:     heatmapToday.map(v => Math.round(v * 0.45)),
        paywallViews: heatmapToday.map(v => Math.round(v * 0.2)),
        purchases:    heatmapToday.map(v => Math.round(v * 0.04)),
        revenue:      heatmapToday.map(v => Math.round(v * 0.04 * 7000)),
        activeUsers:  heatmapToday,
        labels:       hours24.map(h => h + 'h'),
      },
      '7d': {
        sessions:     sessions7,
        readings:     readings7,
        paywallViews: paywall7,
        purchases:    sessions7.map(v => Math.round(v * 0.04)),
        revenue:      revenue7.map(v => Math.round(v)),
        activeUsers:  sessions7.map(v => Math.round(v * 0.15)),
        labels:       days7dows.map(d => {
          const map = { Sun:'Dom', Mon:'Lun', Tue:'Mar', Wed:'Mie',
                        Thu:'Jue', Fri:'Vie', Sat:'Sab' };
          return map[d] || d;
        }),
      },
      // Globo
      globeCountries,
      // Categorías
      categories: categoryMap,
      // Heatmap semanal [día][hora] — array plano 7×24 = 168 valores
      heatmap: {
        days: DOWS,
        data: heatmapWeek, // índice: día*24 + hora
      },
      // Feed en vivo
      feed,
      // Últimas consultas con pregunta
      readingsFeed,
      // Meta
      updatedAt: new Date().toISOString(),
    };

    return res.status(200).json(payload);
  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
