// API de gastos de baja cuantía respaldada por Supabase.
// Mismo modelo de confianza que el resto de apps AMSAC/Bitrix24: la identidad del
// usuario (Bitrix) llega en el cuerpo/consulta, sin sesión propia en el servidor.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET;

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

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function construirFila(g, actorId, actorNombre) {
  const fecha = g.fecha || '';
  if (!FECHA_RE.test(fecha)) return { error: 'Fecha inválida (se espera AAAA-MM-DD): ' + fecha };
  const montoTotal = numOrNull(g.monto_total);
  if (montoTotal == null) return { error: 'Monto total inválido: ' + g.monto_total };
  const montoRetenido = numOrNull(g.monto_retenido) || 0;
  const numeroDocumento = String(g.numero_documento || '').trim();
  const proveedor = String(g.proveedor || '').trim();
  const areaSolicitante = String(g.area_solicitante || '').trim();
  if (!numeroDocumento) return { error: 'Falta número de documento.' };
  if (!proveedor) return { error: 'Falta proveedor.' };
  if (!areaSolicitante) return { error: 'Falta área solicitante.' };

  return {
    row: {
      fecha: fecha,
      mes: parseInt(fecha.slice(5, 7), 10),
      numero_documento: numeroDocumento,
      proveedor: proveedor,
      descripcion: String(g.descripcion || '').trim(),
      area_solicitante: areaSolicitante,
      monto_retenido: montoRetenido,
      monto_total: montoTotal,
      created_by_id: String(actorId || ''),
      created_by_nombre: actorNombre || ''
    }
  };
}

async function insertHistorial(row) {
  try {
    await sb('gastos_historial', {
      method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row)
    });
  } catch (e) { /* auditoría best-effort */ }
}

async function puedeModificar(id, actorId, isAdmin) {
  if (isAdmin) return true;
  const r = await sb('gastos_registros?id=eq.' + encodeURIComponent(id) + '&select=created_by_id,estado');
  const d = await r.json();
  if (!d || !d[0]) return false;
  if (d[0].estado === 'informado') return false;
  return String(d[0].created_by_id) === String(actorId);
}

module.exports = async (req, res) => {
  if (!URL || !KEY) { res.status(500).json({ error: 'Faltan variables de entorno del servidor.' }); return; }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const action = q.action || 'list';

      if (action === 'list') {
        const filtro = (q.admin === '1') ? '' : '&created_by_id=eq.' + encodeURIComponent(q.userId || '');
        const r = await sb('gastos_registros?select=*&order=fecha.desc,created_at.desc' + filtro);
        res.status(200).json({ ok: r.ok, gastos: await r.json() });
        return;
      }

      if (action === 'proveedores') {
        const r = await sb('gastos_registros?select=proveedor&order=proveedor.asc');
        const data = await r.json();
        const proveedores = Array.from(new Set((data || []).map((x) => x.proveedor).filter(Boolean)));
        res.status(200).json({ ok: r.ok, proveedores: proveedores });
        return;
      }

      res.status(400).json({ error: 'Acción GET no reconocida.' });
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const action = body.action;

      if (action === 'save') {
        const built = construirFila(body.gasto || {}, body.actor_id, body.actor_nombre);
        if (built.error) { res.status(400).json({ ok: false, error: built.error }); return; }
        const row = built.row;

        let data, r;
        if (body.id) {
          if (!(await puedeModificar(body.id, body.actor_id, body.actor_is_admin))) {
            res.status(403).json({ ok: false, error: 'Solo quien registró el gasto o un administrador puede editarlo.' });
            return;
          }
          delete row.created_by_id;
          delete row.created_by_nombre;
          row.updated_at = new Date().toISOString();
          r = await sb('gastos_registros?id=eq.' + encodeURIComponent(body.id), {
            method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row)
          });
          data = await r.json();
          if (!r.ok || !data[0]) { res.status(500).json({ ok: false, raw: data }); return; }
          await insertHistorial({ gasto_id: data[0].id, accion: 'editado', actor_id: body.actor_id, actor_nombre: body.actor_nombre, detalle: row });
        } else {
          row.estado = 'registrado';
          r = await sb('gastos_registros', {
            method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row)
          });
          data = await r.json();
          if (!r.ok || !data[0]) { res.status(500).json({ ok: false, raw: data }); return; }
          await insertHistorial({ gasto_id: data[0].id, accion: 'creado', actor_id: body.actor_id, actor_nombre: body.actor_nombre, detalle: row });
        }
        res.status(200).json({ ok: true, gasto: data[0] });
        return;
      }

      if (action === 'bulk_save') {
        const rows = Array.isArray(body.rows) ? body.rows : [];
        const buenas = [];
        const errores = [];
        rows.forEach((g, i) => {
          const built = construirFila(g, body.actor_id, body.actor_nombre);
          if (built.error) errores.push({ fila: i + 1, error: built.error });
          else { built.row.estado = 'registrado'; buenas.push(built.row); }
        });

        let insertados = 0;
        if (buenas.length) {
          const r = await sb('gastos_registros', {
            method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(buenas)
          });
          const data = await r.json();
          if (!r.ok) { res.status(500).json({ ok: false, error: 'Error al insertar en Supabase.', raw: data, errores: errores }); return; }
          insertados = Array.isArray(data) ? data.length : 0;
          await insertHistorial({ accion: 'importacion_excel', actor_id: body.actor_id, actor_nombre: body.actor_nombre, detalle: { insertados: insertados, con_error: errores.length } });
        }
        res.status(200).json({ ok: true, insertados: insertados, errores: errores });
        return;
      }

      if (action === 'informar') {
        const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
        if (!ids.length) { res.status(400).json({ ok: false, error: 'No hay gastos para informar.' }); return; }
        const filtroPropio = body.actor_is_admin ? '' : '&created_by_id=eq.' + encodeURIComponent(body.actor_id || '');
        const lista = 'id=in.(' + ids.map((id) => encodeURIComponent(id)).join(',') + ')';
        const r = await sb('gastos_registros?' + lista + filtroPropio, {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ estado: 'informado', updated_at: new Date().toISOString() })
        });
        const data = await r.json();
        if (!r.ok) { res.status(500).json({ ok: false, raw: data }); return; }
        await insertHistorial({ accion: 'informado', actor_id: body.actor_id, actor_nombre: body.actor_nombre, detalle: { ids: ids, actualizados: (data || []).length } });
        res.status(200).json({ ok: true, actualizados: (data || []).length });
        return;
      }

      if (action === 'delete') {
        if (!body.id) { res.status(400).json({ error: 'Falta id.' }); return; }
        if (!(await puedeModificar(body.id, body.actor_id, body.actor_is_admin))) {
          res.status(403).json({ ok: false, error: 'Solo quien registró el gasto o un administrador puede eliminarlo.' });
          return;
        }
        const r = await sb('gastos_registros?id=eq.' + encodeURIComponent(body.id), {
          method: 'DELETE', headers: { Prefer: 'return=minimal' }
        });
        if (r.ok) await insertHistorial({ gasto_id: body.id, accion: 'eliminado', actor_id: body.actor_id, actor_nombre: body.actor_nombre, detalle: {} });
        res.status(r.ok ? 200 : 500).json({ ok: r.ok });
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
