const PLANS = {
  basico: {
    title: 'Tarot - Respuesta Inmediata (3 tiradas)',
    price: 3990,
    success_url: 'https://tarot-3-tiradas.netlify.app/?reset=$7i$&payment=success',
  },
  estandar: {
    title: 'Tarot - Claridad Completa (10 tiradas x 7 días)',
    price: 7990,
    success_url: 'https://tarot-10-tiradas.netlify.app/?reset=$7i$&payment=success',
  },
  semanal: {
    title: 'Tarot - Guía Diaria VIP (7 días)',
    price: 14990,
    success_url: 'https://tarot-7-dias.netlify.app/?reset=$7i$&payment=success',
  },
};

const FAILURE_URL = 'https://tarot-3-tiradas.netlify.app/?payment=failure';
const PENDING_URL = 'https://tarot-3-tiradas.netlify.app/?payment=pending';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { plan } = req.body;
  const planData = PLANS[plan];

  if (!planData) {
    return res.status(400).json({ error: 'Plan inválido' });
  }

  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        items: [
          {
            title: planData.title,
            quantity: 1,
            unit_price: planData.price,
            currency_id: 'ARS',
          },
        ],
        back_urls: {
          success: planData.success_url,
          failure: FAILURE_URL,
          pending: PENDING_URL,
        },
        auto_return: 'approved',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('MP error:', data);
      return res.status(500).json({ error: 'Error creando preferencia', detail: data });
    }

    return res.status(200).json({ init_point: data.init_point });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Error del servidor' });
  }
}
