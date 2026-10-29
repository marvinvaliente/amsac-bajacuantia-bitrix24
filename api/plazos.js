// Plazo para registrar la factura o documento equivalente (Reglamento Art. 19).
//
// Desde el día del desembolso hasta el día en que se registra la factura o
// documento equivalente (cuando todos los ítems de la solicitud ya tienen su
// factura) deben pasar, como máximo, N días HÁBILES (por defecto 3; lunes a
// viernes sin feriados). Si se supera:
//   - el solicitante y el administrador del fondo reciben una notificación de
//     Bitrix24 y un recordatorio una vez por día mientras siga pendiente
//     (función programada diaria: vercel.json -> GET /api/plazos);
//   - queda en el historial de incumplimientos (tabla gastos_plazos);
//   - cuenta contra el score de cumplimiento del solicitante.
// Los parámetros (días del plazo y feriados) se editan en "Reglas de fondos".
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET;
const gestiones = require('./gestiones');
const presupuesto = require('./presupuesto');

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
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// ---- Fechas y días hábiles (hora de El Salvador, UTC-6) ----
const hoyLocal = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
const fechaLocalDe = (ts) => new Date(new Date(ts).getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
const fmtFecha = (d) => String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4);
function addDias(fecha, n) {
  const d = new Date(fecha + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function esHabil(fecha, feriados) {
  const dow = new Date(fecha + 'T00:00:00Z').getUTCDay();
  return dow !== 0 && dow !== 6 && !feriados.has(fecha);
}
// Fecha en que vence el plazo: el N-ésimo día hábil después de la fecha de partida.
function sumarHabiles(fecha, n, feriados) {
  let c = 0, x = fecha, guarda = 0;
  while (c < n && guarda++ < 800) { x = addDias(x, 1); if (esHabil(x, feriados)) c++; }
  return x;
}
// Días hábiles transcurridos en el intervalo (desde, hasta].
function habilesEntre(desde, hasta, feriados) {
  let c = 0, x = desde, guarda = 0;
  while (x < hasta && guarda++ < 800) { x = addDias(x, 1); if (esHabil(x, feriados)) c++; }
  return c;
}

async function configPlazo() {
  const g = (await gestiones.cargarReglas()).reglas.global || {};
  const dias = Number.isInteger(Number(g.plazoComprobantesDias)) && Number(g.plazoComprobantesDias) > 0 ? Number(g.plazoComprobantesDias) : 3;
  return { dias, feriados: new Set(Array.isArray(g.feriados) ? g.feriados : []) };
}

// ---- Ciclo de vida de un plazo ----
// Al desembolsar: empieza a correr el plazo para el solicitante.
async function iniciarPlazo(sol, actorId, actorNombre) {
  try {
    const cfg = await configPlazo();
    const des = fechaLocalDe(sol.desembolsado_at || new Date().toISOString());
    const fila = {
      solicitud_id: sol.id, fondo_id: sol.fondo_id, solicitante_id: String(sol.created_by_id || ''), solicitante_nombre: sol.created_by_nombre || '',
      administrador_id: String(actorId || ''), administrador_nombre: actorNombre || '',
      desembolsado_at: sol.desembolsado_at || new Date().toISOString(), dias_plazo: cfg.dias, fecha_limite: sumarHabiles(des, cfg.dias, cfg.feriados)
    };
    await sb('gastos_plazos?on_conflict=solicitud_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(fila) });
  } catch (e) { console.error('plazos.iniciarPlazo: ' + (e && e.message || e)); }
}

// Al registrar la última factura de la solicitud: se cierra el plazo (a tiempo o
// con atraso). Solo se cierra la primera vez.
async function cerrarPlazo(solicitudId) {
  try {
    const r = await sb('gastos_plazos?solicitud_id=eq.' + encodeURIComponent(solicitudId) + '&estado=eq.pendiente&select=*');
    const filas = await r.json();
    if (!r.ok || !Array.isArray(filas) || !filas[0]) return;
    const p = filas[0];
    const cfg = await configPlazo();
    const hoy = hoyLocal();
    const habiles = habilesEntre(fechaLocalDe(p.desembolsado_at), hoy, cfg.feriados);
    const cumple = hoy <= p.fecha_limite;
    await sb('gastos_plazos?id=eq.' + p.id, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ estado: cumple ? 'cumplio' : 'incumplio', cumplido_at: new Date().toISOString(), dias_habiles: habiles, dias_atraso: cumple ? 0 : habilesEntre(p.fecha_limite, hoy, cfg.feriados) })
    });
  } catch (e) { console.error('plazos.cerrarPlazo: ' + (e && e.message || e)); }
}

// Recordatorio diario: a quien tenga un plazo vencido sin registrar (solicitante y
// administrador del fondo). Máximo uno por día por solicitud.
async function procesarRecordatorios() {
  const hoy = hoyLocal();
  const cfg = await configPlazo();
  const r = await sb('gastos_plazos?estado=eq.pendiente&fecha_limite=lt.' + hoy + '&select=*&order=fecha_limite.asc&limit=500');
  const filas = await r.json();
  if (!r.ok || !Array.isArray(filas)) throw new Error('No se pudieron leer los plazos.');
  let notificados = 0;
  for (const p of filas) {
    if (p.ultimo_recordatorio === hoy) continue;
    // "Reclamar" el día de forma atómica para no repetir si el proceso corre dos veces.
    const claim = await sb('gastos_plazos?id=eq.' + p.id + '&or=(ultimo_recordatorio.is.null,ultimo_recordatorio.lt.' + hoy + ')', {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ultimo_recordatorio: hoy, recordatorios: (Number(p.recordatorios) || 0) + 1, primera_alerta_at: p.primera_alerta_at || new Date().toISOString() })
    });
    const cl = await claim.json().catch(() => []);
    if (!claim.ok || !Array.isArray(cl) || !cl.length) continue;
    let desc = '';
    try {
      const rs = await sb('gastos_solicitudes?id=eq.' + p.solicitud_id + '&select=descripcion,nombre_proceso');
      const sd = await rs.json();
      desc = (sd && sd[0] && (sd[0].nombre_proceso || sd[0].descripcion)) || '';
    } catch (e) { /* solo informativo */ }
    const atraso = habilesEntre(p.fecha_limite, hoy, cfg.feriados);
    const detalle = 'la solicitud #' + p.solicitud_id + (desc ? ' ("' + String(desc).slice(0, 70) + '")' : '') + ' fue desembolsada el ' + fmtFecha(fechaLocalDe(p.desembolsado_at)) +
      ' y el plazo de ' + p.dias_plazo + ' días hábiles para registrar la factura o documento equivalente venció el ' + fmtFecha(p.fecha_limite) +
      ' (atraso: ' + atraso + ' día' + (atraso === 1 ? '' : 's') + ' hábil' + (atraso === 1 ? '' : 'es') + ').';
    const tag = 'GASTOS_PLAZO_' + p.solicitud_id + '_' + hoy;
    await gestiones.notificar(p.solicitante_id,
      '⚠️ Plazo vencido: ' + detalle + ' Regístrala hoy en "Registrar factura o documento equivalente". Cada incumplimiento afecta tu score de cumplimiento.',
      'Tienes un plazo vencido para registrar una factura.', tag + '_S');
    notificados++;
    if (p.administrador_id && String(p.administrador_id) !== String(p.solicitante_id)) {
      await gestiones.notificar(p.administrador_id,
        '⚠️ Plazo vencido de ' + (p.solicitante_nombre || 'el solicitante') + ': ' + detalle + ' Dale seguimiento para que registre su factura o documento equivalente.',
        'Un solicitante tiene un plazo vencido.', tag + '_A');
      notificados++;
    }
  }
  return { fecha: hoy, vencidos: filas.length, notificaciones: notificados };
}

// ---- Resumen y score ----
function nivelScore(score) { return score == null ? 'sin_datos' : (score >= 90 ? 'excelente' : (score >= 75 ? 'bueno' : 'en_riesgo')); }
// Score = a tiempo / (a tiempo + incumplidos + vencidos sin registrar). Lo que está dentro del plazo no cuenta todavía.
function resumir(filas) {
  const r = { cumplio: 0, incumplio: 0, vencidas: 0, enPlazo: 0 };
  filas.forEach((f) => {
    if (f.estado_calc === 'cumplio') r.cumplio++;
    else if (f.estado_calc === 'incumplio') r.incumplio++;
    else if (f.estado_calc === 'vencido') r.vencidas++;
    else r.enPlazo++;
  });
  const considerados = r.cumplio + r.incumplio + r.vencidas;
  r.total = filas.length;
  r.score = considerados ? Math.round((100 * r.cumplio) / considerados) : null;
  r.nivel = nivelScore(r.score);
  return r;
}
function enriquecer(p, hoy, feriados) {
  const o = Object.assign({}, p);
  if (p.estado === 'pendiente') {
    if (p.fecha_limite < hoy) { o.estado_calc = 'vencido'; o.dias_atraso = habilesEntre(p.fecha_limite, hoy, feriados); }
    else { o.estado_calc = 'en_plazo'; o.dias_restantes = habilesEntre(hoy, p.fecha_limite, feriados); }
  } else o.estado_calc = p.estado;
  return o;
}

module.exports = async (req, res) => {
  if (!URL || !KEY) { res.status(500).json({ error: 'Faltan variables de entorno del servidor.' }); return; }
  try {
    // Función programada diaria (Vercel Cron). Con CRON_SECRET definido solo acepta a Vercel.
    if (req.method === 'GET') {
      const secret = process.env.CRON_SECRET;
      if (secret && String((req.headers && req.headers.authorization) || '') !== 'Bearer ' + secret) { res.status(401).json({ ok: false, error: 'No autorizado.' }); return; }
      res.status(200).json(Object.assign({ ok: true }, await procesarRecordatorios()));
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido.' }); return; }
    const body = await readBody(req);
    const actor = String(body.actor_id || '').trim();
    if (!actor) { res.status(400).json({ ok: false, error: 'Falta el usuario.' }); return; }
    const cfg = await configPlazo();
    const hoy = hoyLocal();
    const reglas = { dias: cfg.dias, feriados: Array.from(cfg.feriados).sort() };
    const esAdmin = await presupuesto.esAdminPortal(actor, body.auth_token);

    // Enviar los recordatorios ahora (solo administrador del portal verificado).
    if (body.action === 'recordar') {
      if (!esAdmin) { res.status(403).json({ ok: false, error: 'Solo un administrador del portal puede enviar los recordatorios.' }); return; }
      res.status(200).json(Object.assign({ ok: true }, await procesarRecordatorios()));
      return;
    }

    // Score propio (barra superior)
    const rM = await sb('gastos_plazos?solicitante_id=eq.' + encodeURIComponent(actor) + '&select=*&limit=1000');
    const propias = await rM.json();
    if (!rM.ok || !Array.isArray(propias)) { res.status(500).json({ ok: false, error: 'No se pudo leer el cumplimiento.' }); return; }
    const mio = resumir(propias.map((p) => enriquecer(p, hoy, cfg.feriados)));
    if (body.action === 'mio') { res.status(200).json({ ok: true, mio, reglas }); return; }

    // Seguimiento completo según el alcance: administrador del portal (todo), administrador de
    // fondo (sus fondos y lo propio) o solo lo propio.
    let alcance = 'propio', filtro = '&solicitante_id=eq.' + encodeURIComponent(actor);
    if (esAdmin) { alcance = 'todos'; filtro = ''; }
    else {
      const rA = await sb('gastos_fondo_usuarios?usuario_id=eq.' + encodeURIComponent(actor) + '&es_administrador=eq.true&select=fondo_id');
      const adm = await rA.json();
      if (!rA.ok || !Array.isArray(adm)) { res.status(502).json({ ok: false, error: 'No se pudo verificar los fondos que administras.' }); return; }
      const ids = Array.from(new Set(adm.map((a) => a.fondo_id).filter((x) => x != null)));
      if (ids.length) { alcance = 'fondos'; filtro = '&or=(solicitante_id.eq.' + encodeURIComponent(actor) + ',fondo_id.in.(' + ids.map(encodeURIComponent).join(',') + '))'; }
    }
    const r = await sb('gastos_plazos?select=*&order=desembolsado_at.desc&limit=500' + filtro);
    const crudas = await r.json();
    if (!r.ok || !Array.isArray(crudas)) { res.status(500).json({ ok: false, error: 'No se pudo leer el seguimiento de plazos.' }); return; }
    const filas = crudas.map((p) => enriquecer(p, hoy, cfg.feriados));
    // descripción de cada solicitud (informativa)
    if (filas.length) {
      const rs = await sb('gastos_solicitudes?id=in.(' + filas.map((f) => f.solicitud_id).join(',') + ')&select=id,descripcion,nombre_proceso,monto_total');
      const sd = await rs.json();
      const mapa = {};
      (Array.isArray(sd) ? sd : []).forEach((x) => { mapa[x.id] = x; });
      filas.forEach((f) => { const x = mapa[f.solicitud_id] || {}; f.descripcion = x.nombre_proceso || x.descripcion || ''; f.monto_total = x.monto_total; });
    }
    // Ranking por solicitante (solo cuando se ve más que lo propio)
    let ranking = [];
    if (alcance !== 'propio') {
      const grupos = {};
      filas.forEach((f) => { (grupos[f.solicitante_id] = grupos[f.solicitante_id] || { id: f.solicitante_id, nombre: f.solicitante_nombre, filas: [] }).filas.push(f); });
      ranking = Object.keys(grupos).map((k) => Object.assign({ id: grupos[k].id, nombre: grupos[k].nombre }, resumir(grupos[k].filas)))
        .sort((a, b) => ((a.score == null ? 101 : a.score) - (b.score == null ? 101 : b.score)) || (b.incumplio + b.vencidas) - (a.incumplio + a.vencidas));
    }
    res.status(200).json({ ok: true, alcance, mio, ranking, filas, reglas });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
module.exports.iniciarPlazo = iniciarPlazo;
module.exports.cerrarPlazo = cerrarPlazo;
module.exports.procesarRecordatorios = procesarRecordatorios;
module.exports.sumarHabiles = sumarHabiles;
module.exports.habilesEntre = habilesEntre;
module.exports.esHabil = esHabil;
module.exports.resumir = resumir;
