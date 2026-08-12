// API de certificadores presupuestarios: quién puede certificar una
// solicitud (pestaña "Certificación presupuestaria"), asignado por usuario
// individual o por departamento completo de Bitrix24. Mismo modelo de
// confianza que el resto de la app: sin sesión propia, la identidad llega
// en el cuerpo/consulta.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET;

const TIPOS = ['usuario', 'departamento'];

function sb(path, options) {
  options = options || {};
  const headers = Object.assign(
    { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    options.headers || {}
  );
  return fetch(URL + '/rest/v1/' + path, Object.assign({}, options, { headers }));
}

function dbErrorMsg(data) {
  if (!data) return 'Error desconocido de la base de datos.';
  if (Array.isArray(data)) {
    const msg = data.map((d) => d && d.message).filter(Boolean).join('; ');
    return msg || 'Error desconocido de la base de datos.';
  }
  return data.message || data.error || data.hint || JSON.stringify(data);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  if (!URL || !KEY) { res.status(500).json({ error: 'Faltan variables de entorno del servidor.' }); return; }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const action = q.action || 'list';

      if (action === 'list') {
        const r = await sb('gastos_certificadores?select=id,tipo,valor&order=created_at.asc');
        res.status(200).json({ ok: r.ok, certificadores: await r.json() });
        return;
      }

      res.status(400).json({ error: 'Acción GET no reconocida.' });
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const action = body.action;

      if (action === 'guardar') {
        const lista = Array.isArray(body.items) ? body.items : [];
        const limpios = [];
        for (const it of lista) {
          const tipo = TIPOS.indexOf(it && it.tipo) !== -1 ? it.tipo : null;
          const valor = String((it && it.valor) || '').trim();
          if (!tipo || !valor) continue;
          limpios.push({ tipo: tipo, valor: valor });
        }

        const del = await sb('gastos_certificadores?id=gt.0', { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        if (!del.ok) { res.status(500).json({ ok: false, error: 'No se pudo actualizar la lista de certificadores.' }); return; }

        if (limpios.length) {
          const ins = await sb('gastos_certificadores', {
            method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(limpios)
          });
          if (!ins.ok) {
            const data = await ins.json().catch(() => null);
            res.status(500).json({ ok: false, error: dbErrorMsg(data) });
            return;
          }
        }
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: 'Acción POST no reconocida.' });
      return;
    }

    res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
