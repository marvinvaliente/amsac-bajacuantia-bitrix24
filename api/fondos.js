// API de fondos (caja chica / circulante) y su asociación con usuarios de Bitrix24.
// Mismo modelo de confianza que el resto de la app: la identidad llega en el
// cuerpo/consulta, sin sesión propia en el servidor.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET;

const TIPOS = ['caja_chica', 'circulante'];

function sb(path, options) {
  options = options || {};
  const headers = Object.assign(
    { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    options.headers || {}
  );
  return fetch(URL + '/rest/v1/' + path, Object.assign({}, options, { headers }));
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

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

module.exports = async (req, res) => {
  if (!URL || !KEY) { res.status(500).json({ error: 'Faltan variables de entorno del servidor.' }); return; }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const action = q.action || 'list';

      if (action === 'list') {
        const [rFondos, rAsig] = await Promise.all([
          sb('gastos_fondos?select=*&order=anio.desc,created_at.desc'),
          sb('gastos_fondo_usuarios?select=fondo_id,usuario_id')
        ]);
        const fondos = await rFondos.json();
        const asignaciones = await rAsig.json();
        const conUsuarios = (fondos || []).map((f) => ({
          ...f,
          usuario_ids: (asignaciones || []).filter((a) => a.fondo_id === f.id).map((a) => a.usuario_id)
        }));
        res.status(200).json({ ok: rFondos.ok && rAsig.ok, fondos: conUsuarios });
        return;
      }

      res.status(400).json({ error: 'Acción GET no reconocida.' });
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const action = body.action;

      if (action === 'create') {
        const f = body.fondo || {};
        const tipo = String(f.tipo || '');
        const montoTotal = numOrNull(f.monto_total);
        const anio = parseInt(f.anio, 10);
        if (TIPOS.indexOf(tipo) === -1) { res.status(400).json({ ok: false, error: 'Tipo de fondo inválido.' }); return; }
        if (montoTotal == null || montoTotal < 0) { res.status(400).json({ ok: false, error: 'Monto total inválido.' }); return; }
        if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) { res.status(400).json({ ok: false, error: 'Año inválido.' }); return; }

        const r = await sb('gastos_fondos', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ tipo: tipo, monto_total: montoTotal, anio: anio })
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, raw: data }); return; }
        res.status(200).json({ ok: true, fondo: Object.assign({}, data[0], { usuario_ids: [] }) });
        return;
      }

      if (action === 'delete') {
        if (!body.id) { res.status(400).json({ error: 'Falta id.' }); return; }
        const r = await sb('gastos_fondos?id=eq.' + encodeURIComponent(body.id), {
          method: 'DELETE', headers: { Prefer: 'return=minimal' }
        });
        res.status(r.ok ? 200 : 500).json({ ok: r.ok });
        return;
      }

      if (action === 'asignar') {
        if (!body.fondo_id) { res.status(400).json({ error: 'Falta fondo_id.' }); return; }
        const ids = Array.isArray(body.usuario_ids) ? body.usuario_ids.map((x) => String(x)) : [];

        const del = await sb('gastos_fondo_usuarios?fondo_id=eq.' + encodeURIComponent(body.fondo_id), {
          method: 'DELETE', headers: { Prefer: 'return=minimal' }
        });
        if (!del.ok) { res.status(500).json({ ok: false, error: 'No se pudo actualizar la asignación.' }); return; }

        if (ids.length) {
          const filas = ids.map((uid) => ({ fondo_id: body.fondo_id, usuario_id: uid }));
          const ins = await sb('gastos_fondo_usuarios', {
            method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(filas)
          });
          if (!ins.ok) { res.status(500).json({ ok: false, error: 'No se pudo guardar la asignación.' }); return; }
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
