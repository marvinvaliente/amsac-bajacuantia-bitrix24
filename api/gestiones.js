// API de gestiones de reembolso/reintegro o liquidación de un fondo. Una
// gestión agrupa los gastos "registrado" de un fondo en un mes específico
// (ver schema.sql para el flujo completo de estados). Mismo modelo de
// confianza que el resto de la app: sin sesión propia, la identidad llega
// en el cuerpo/consulta.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET;
const BITRIX24_WEBHOOK_URL = process.env.BITRIX24_WEBHOOK_URL;
const presupuesto = require('./presupuesto');

const TIPOS_GESTION = ['reintegro', 'liquidacion'];
const TIPO_LABEL = { reintegro: 'Reintegro', liquidacion: 'Liquidación' };
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

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

// ---- Bitrix24 Disk (best-effort documentado en README; requiere el scope
// "disk" en el mismo webhook que ya usa BITRIX24_WEBHOOK_URL) ----
async function bx24(method, params) {
  const base = BITRIX24_WEBHOOK_URL.endsWith('/') ? BITRIX24_WEBHOOK_URL : BITRIX24_WEBHOOK_URL + '/';
  const r = await fetch(base + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {})
  });
  const data = await r.json();
  if (!r.ok || data.error) {
    const detalle = (data && (data.error_description || data.error)) || ('Bitrix24 respondió ' + r.status);
    throw new Error(method + ': ' + detalle);
  }
  return data.result;
}

const CARPETA_RAIZ_DISK = 'Gastos de Baja Cuantía';

async function obtenerOCrearCarpetaEnStorage(storageId, nombre) {
  const hijos = await bx24('disk.storage.getchildren', { id: storageId });
  const existente = (hijos || []).find((h) => h.TYPE === 'folder' && h.NAME === nombre);
  if (existente) return existente.ID;
  const nueva = await bx24('disk.storage.addfolder', { id: storageId, data: { NAME: nombre } });
  return nueva.ID;
}
async function obtenerOCrearSubcarpeta(folderId, nombre) {
  const hijos = await bx24('disk.folder.getchildren', { id: folderId });
  const existente = (hijos || []).find((h) => h.TYPE === 'folder' && h.NAME === nombre);
  if (existente) return existente.ID;
  const nueva = await bx24('disk.folder.addsubfolder', { id: folderId, data: { NAME: nombre } });
  return nueva.ID;
}

// Sube el PDF a una carpeta compartida (del usuario dueño del webhook, NO
// del administrador de fondo -- crear carpetas dentro del Drive personal de
// OTRO usuario no está garantizado por la API de Bitrix24), organizada en
// subcarpetas con el nombre de cada administrador de fondo:
//   "Gastos de Baja Cuantía" / <Nombre del administrador> / archivo.pdf
async function subirPdfADisk(nombreAdministrador, nombreArchivo, dataBase64) {
  if (!BITRIX24_WEBHOOK_URL) throw new Error('Falta configurar BITRIX24_WEBHOOK_URL en el servidor (variable de entorno de Vercel).');
  const storages = await bx24('disk.storage.getlist', {});
  if (!storages || !storages[0]) throw new Error('No se encontró un almacenamiento de Bitrix24 Disk disponible para el webhook.');
  const carpetaRaizId = await obtenerOCrearCarpetaEnStorage(storages[0].ID, CARPETA_RAIZ_DISK);
  const subcarpetaId = await obtenerOCrearSubcarpeta(carpetaRaizId, nombreAdministrador || 'Sin nombre');
  const archivo = await bx24('disk.folder.uploadfile', {
    id: subcarpetaId,
    data: { NAME: nombreArchivo },
    fileContent: [nombreArchivo, dataBase64],
    generateUniqueName: true
  });
  return { url: archivo.DOWNLOAD_URL || archivo.DETAIL_URL || '', nombre: archivo.NAME || nombreArchivo };
}

// Mismo mecanismo que api/solicitudes.js: notificación del sistema de
// Bitrix24 (best-effort, nunca bloquea la acción principal).
async function notificar(usuarioId, mensaje, mensajeOut, tag) {
  if (!BITRIX24_WEBHOOK_URL || !usuarioId) return;
  try {
    const base = BITRIX24_WEBHOOK_URL.endsWith('/') ? BITRIX24_WEBHOOK_URL : BITRIX24_WEBHOOK_URL + '/';
    const r = await fetch(base + 'im.notify.system.add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ USER_ID: usuarioId, MESSAGE: mensaje, MESSAGE_OUT: mensajeOut, TAG: tag })
    });
    if (!r.ok) console.error('gestiones.notificar: Bitrix24 respondió ' + r.status + ' — ' + (await r.text().catch(() => '')));
  } catch (e) {
    console.error('gestiones.notificar: error de conexión — ' + (e && e.message || e));
  }
}

function sanitizarNombreArchivo(s) {
  return String(s || '').replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

function etiquetaPeriodo(g) {
  if (g.fecha_desde && g.fecha_hasta) {
    const f = (d) => String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4);
    return 'del ' + f(g.fecha_desde) + ' al ' + f(g.fecha_hasta);
  }
  return 'de ' + (MESES[g.mes] || g.mes) + ' ' + g.anio;
}

// ---- Regla del reintegro (Reglamento, Art. 5 y 31) ----------------------
// Cada fondo tiene un monto máximo al año (gastos_fondos.monto_total). La
// referencia mensual es ese monto entre 12; para que los 12 meses sumen
// exactamente el total se reparte con redondeo acumulado (en centavos).
// Un reintegro se puede solicitar cuando los gastos alcanzan el 60% de la
// referencia del mes o, como máximo, el último día del mes (plazo).
function hoyLocal() { return new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10); } // El Salvador, UTC-6
function ultimoDiaDelMes(fecha) {
  const y = parseInt(String(fecha).slice(0, 4), 10), m = parseInt(String(fecha).slice(5, 7), 10);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function referenciaMensualCentavos(montoAnual, mes) {
  const total = Math.round((Number(montoAnual) || 0) * 100);
  return Math.floor(total * mes / 12) - Math.floor(total * (mes - 1) / 12);
}
function evaluarReintegro(montoAnual, gastos, hoy, R) {
  hoy = hoy || hoyLocal();
  R = R || DEFAULTS.circulante;
  const pct = Number.isFinite(Number(R.reintegroPct)) ? Number(R.reintegroPct) : 60;
  const mes = parseInt(hoy.slice(5, 7), 10);
  const refC = referenciaMensualCentavos(montoAnual, mes);
  const umbralC = Math.ceil((refC * Math.round(pct * 100)) / 10000);
  const montoC = gastos.reduce((a, g) => a + Math.round((Number(g.monto_total) || 0) * 100), 0);
  const fechas = gastos.map((g) => String(g.fecha)).filter(Boolean).sort();
  const limite = fechas.length ? ultimoDiaDelMes(fechas[0]) : ultimoDiaDelMes(hoy);
  const plazoCumplido = hoy >= limite;
  const plazoCuenta = R.reintegroFinDeMes !== false;
  return { ok: montoC >= umbralC || (plazoCuenta && plazoCumplido), pct, refC, umbralC, montoC, faltaC: Math.max(0, umbralC - montoC), plazoCumplido, plazoCuenta, limite, hoy };
}
const fmtC = (c) => (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFecha = (d) => String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4);

// ---- Parámetros de las reglas de uso de los fondos -------------------------
// Ya no están escritos en el código: se leen de la tabla gastos_reglas, que se
// edita desde la app ("Reglas de fondos"). DEFAULTS son los valores del
// reglamento vigente y se usan como respaldo (y para completar parámetros
// nuevos que aún no estén guardados).
//   0 en un tope = sin tope.
const DEFAULTS = {
  global: { salarioMinimo: 408.80 },
  circulante: {
    montoMaximoAnual: 300000, limiteCompra: 1000,
    formasPago: ['efectivo', 'transferencia', 'cheque'], efectivoMaxCompra: 500, efectivoPct: 40,
    excepcionesPermitidas: true, excepcionMaxSalarios: 20, excepcionMensualPct: 50, exigeAcuerdo: true, exigeRetencion: false,
    reintegroPct: 60, reintegroFinDeMes: true, reintegroExigeDocumento: true
  },
  caja_chica: {
    montoMaximoAnual: 24000, limiteCompra: 100,
    formasPago: ['efectivo'], efectivoMaxCompra: 0, efectivoPct: 100,
    excepcionesPermitidas: true, excepcionMaxSalarios: 0, excepcionMensualPct: 50, exigeAcuerdo: false, exigeRetencion: true,
    reintegroPct: 60, reintegroFinDeMes: true, reintegroExigeDocumento: true
  }
};
const FORMAS_PAGO_VALIDAS = ['efectivo', 'transferencia', 'cheque'];
const FORMA_LABEL = { efectivo: 'efectivo', transferencia: 'transferencia', cheque: 'cheque' };
const TIPOS_REGLAS = ['global', 'circulante', 'caja_chica'];
let cacheReglas = null, cacheReglasT = 0;
function invalidarCacheReglas() { cacheReglas = null; }

// Lee las reglas vigentes (cache corto para no consultar en cada validación).
async function cargarReglas(forzar) {
  if (!forzar && cacheReglas && Date.now() - cacheReglasT < 15000) return cacheReglas;
  let filas = [], leido = false;
  try {
    const r = await sb('gastos_reglas?select=*');
    const d = await r.json();
    if (r.ok && Array.isArray(d)) { filas = d; leido = true; }
  } catch (e) { /* se usan los valores por defecto */ }
  const fila = (k) => filas.find((f) => f.tipo === k);
  const reglas = {}, meta = {};
  TIPOS_REGLAS.forEach((k) => {
    reglas[k] = Object.assign({}, DEFAULTS[k], (fila(k) && fila(k).valor) || {});
    meta[k] = fila(k) ? { updated_at: fila(k).updated_at, updated_by_nombre: fila(k).updated_by_nombre } : null;
  });
  const out = { reglas, meta };
  if (leido) { cacheReglas = out; cacheReglasT = Date.now(); }
  return out;
}

// Limpia y acota lo que llega del formulario de "Reglas de fondos".
function normalizarReglas(tipo, v) {
  v = v || {};
  const num = (x, def, min, max) => { let n = Number(x); if (!Number.isFinite(n)) n = def; if (min != null && n < min) n = min; if (max != null && n > max) n = max; return Math.round(n * 100) / 100; };
  const bool = (x, def) => (typeof x === 'boolean' ? x : (x === 'true' ? true : (x === 'false' ? false : def)));
  if (tipo === 'global') {
    const sm = Number(v.salarioMinimo);
    if (!Number.isFinite(sm) || sm <= 0) return { error: 'El salario mínimo debe ser un monto mayor que cero.' };
    return { valor: { salarioMinimo: Math.round(sm * 100) / 100 } };
  }
  const d = DEFAULTS[tipo];
  if (!d) return { error: 'Tipo de reglas inválido.' };
  const formas = Array.from(new Set((Array.isArray(v.formasPago) ? v.formasPago : []).filter((f) => FORMAS_PAGO_VALIDAS.indexOf(f) !== -1)));
  if (!formas.length) return { error: 'Debe haber al menos una forma de pago permitida.' };
  const limite = Number(v.limiteCompra);
  if (!Number.isFinite(limite) || limite <= 0) return { error: 'El límite de compra ordinaria debe ser mayor que cero.' };
  const hayBanco = formas.indexOf('transferencia') !== -1 || formas.indexOf('cheque') !== -1;
  const hayEfectivo = formas.indexOf('efectivo') !== -1;
  // Coherencia: sin efectivo permitido no hay parte en efectivo; sin banco, todo en efectivo.
  let efectivoPct = num(v.efectivoPct, d.efectivoPct, 0, 100);
  if (!hayEfectivo) efectivoPct = 0;
  if (!hayBanco) efectivoPct = 100;
  return { valor: {
    montoMaximoAnual: num(v.montoMaximoAnual, d.montoMaximoAnual, 0, 1000000000),
    limiteCompra: Math.round(limite * 100) / 100,
    formasPago: formas,
    efectivoMaxCompra: hayEfectivo ? num(v.efectivoMaxCompra, d.efectivoMaxCompra, 0, 1000000000) : 0,
    efectivoPct: efectivoPct,
    excepcionesPermitidas: bool(v.excepcionesPermitidas, d.excepcionesPermitidas),
    excepcionMaxSalarios: num(v.excepcionMaxSalarios, d.excepcionMaxSalarios, 0, 100000),
    excepcionMensualPct: num(v.excepcionMensualPct, d.excepcionMensualPct, 0, 100),
    exigeAcuerdo: bool(v.exigeAcuerdo, d.exigeAcuerdo),
    exigeRetencion: bool(v.exigeRetencion, d.exigeRetencion),
    reintegroPct: num(v.reintegroPct, d.reintegroPct, 0, 100),
    reintegroFinDeMes: bool(v.reintegroFinDeMes, d.reintegroFinDeMes),
    reintegroExigeDocumento: bool(v.reintegroExigeDocumento, d.reintegroExigeDocumento)
  } };
}

// Guarda las reglas de un tipo y deja registro de quién cambió qué.
async function guardarReglas(tipo, valores, actor) {
  if (TIPOS_REGLAS.indexOf(tipo) === -1) return { error: 'Tipo de reglas inválido.' };
  const n = normalizarReglas(tipo, valores);
  if (n.error) return { error: n.error };
  const anterior = (await cargarReglas(true)).reglas[tipo];
  const r = await sb('gastos_reglas?on_conflict=tipo', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ tipo: tipo, valor: n.valor, updated_at: new Date().toISOString(), updated_by_id: String((actor && actor.id) || ''), updated_by_nombre: (actor && actor.nombre) || '' })
  });
  if (!r.ok) return { error: 'No se pudieron guardar las reglas.' };
  try {
    await sb('gastos_reglas_historial', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ tipo: tipo, valor_anterior: anterior, valor_nuevo: n.valor, cambiado_por_id: String((actor && actor.id) || ''), cambiado_por_nombre: (actor && actor.nombre) || '' })
    });
  } catch (e) { /* el registro es complementario */ }
  invalidarCacheReglas();
  return { ok: true };
}
async function historialReglas(limite) {
  const r = await sb('gastos_reglas_historial?select=*&order=created_at.desc&limit=' + (limite || 20));
  const d = await r.json();
  return r.ok && Array.isArray(d) ? d : [];
}

// Lo que ve el navegador (para avisos y validaciones en pantalla).
async function reglasPublicas() {
  const { reglas, meta } = await cargarReglas();
  const sm = reglas.global.salarioMinimo;
  const conMax = (t) => Object.assign({}, reglas[t], { excepcionMaxMonto: Math.round((Number(reglas[t].excepcionMaxSalarios) || 0) * sm * 100) / 100 });
  return { salarioMinimo: sm, circulante: conMax('circulante'), caja_chica: conMax('caja_chica'), meta: meta };
}
const centavosDe = (n) => Math.round((Number(n) || 0) * 100);
const fechaLocalDe = (ts) => new Date(new Date(ts).getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
// Inicio (UTC) del mes local de El Salvador al que pertenece una fecha local.
function limitesMesUTC(fechaLocal) {
  const y = parseInt(fechaLocal.slice(0, 4), 10), m = parseInt(fechaLocal.slice(5, 7), 10);
  const ini = new Date(Date.UTC(y, m - 1, 1, 6, 0, 0)).toISOString();
  const fin = new Date(Date.UTC(y, m, 1, 6, 0, 0)).toISOString();
  return { ini, fin };
}

async function leerFondo(fondoId) {
  const rF = await sb('gastos_fondos?id=eq.' + encodeURIComponent(fondoId) + '&select=id,tipo,monto_total,anio');
  const f = await rF.json();
  if (!rF.ok || !Array.isArray(f)) throw new Error('No se pudo leer el fondo.');
  return f[0] || null;
}

// Valida una compra (solicitud) contra las reglas del fondo (parámetros vigentes).
// Devuelve { error } si no se permite; si no, { excepcional, acuerdoRequerido, retencionRequerida, ... }.
//   datos: { fondoId, monto, formaPago, tieneAcuerdo, excluirId, fecha (AAAA-MM-DD local) }
async function evaluarCuantia(datos) {
  const f = await leerFondo(datos.fondoId);
  if (!f) return { error: 'El fondo no existe.' };
  const { reglas } = await cargarReglas();
  const R_ = reglas[f.tipo];
  if (!R_) return { excepcional: false, acuerdoRequerido: false, retencionRequerida: false };
  const SM = reglas.global.salarioMinimo;
  const nom = f.tipo === 'circulante' ? 'el fondo circulante' : 'la caja chica';
  const nomDe = f.tipo === 'circulante' ? 'del fondo circulante' : 'de la caja chica';
  const monto = Math.round((Number(datos.monto) || 0) * 100) / 100;

  // Forma de pago (efectivo / banco)
  if (R_.formasPago.indexOf(datos.formaPago) === -1) {
    return { error: 'En ' + nom + ' solo se permite pagar con: ' + R_.formasPago.map((x) => FORMA_LABEL[x] || x).join(', ') + '. Cambia la forma de pago de la solicitud.' };
  }
  if (datos.formaPago === 'efectivo' && R_.efectivoMaxCompra > 0 && monto > R_.efectivoMaxCompra) {
    return { error: 'En ' + nom + ' el efectivo solo se usa en compras de hasta $' + R_.efectivoMaxCompra.toFixed(2) + '. Esta compra es de $' + monto.toFixed(2) + ': debe pagarse por otro medio permitido.' };
  }

  const excepcional = monto > R_.limiteCompra;
  const out = {
    excepcional, tipo: f.tipo, limite: R_.limiteCompra,
    acuerdoRequerido: excepcional && R_.excepcionesPermitidas && !!R_.exigeAcuerdo,
    retencionRequerida: excepcional && R_.excepcionesPermitidas && !!R_.exigeRetencion
  };
  if (!excepcional) return out;

  if (!R_.excepcionesPermitidas) {
    return { error: 'Esta compra de $' + monto.toFixed(2) + ' supera el límite de compra ' + nomDe + ' ($' + R_.limiteCompra.toFixed(2) + ') y no se permiten compras excepcionales.' };
  }
  if (R_.excepcionMaxSalarios > 0) {
    const maxC = Math.round(R_.excepcionMaxSalarios * SM * 100);
    if (centavosDe(monto) > maxC) {
      return { error: 'Esta compra de $' + monto.toFixed(2) + ' supera el máximo que se puede autorizar de forma excepcional en ' + nom + ': ' + R_.excepcionMaxSalarios + ' salarios mínimos ($' + fmtC(maxC) + ').' };
    }
  }
  if (R_.exigeAcuerdo && !datos.tieneAcuerdo) {
    return { error: 'Esta compra supera el límite ordinario ' + nomDe + ' ($' + R_.limiteCompra.toFixed(2) + ') y es excepcional: debes adjuntar el acuerdo administrativo en PDF.' };
  }

  // Tope mensual: lo excepcional del mes no puede pasar el % de la referencia mensual
  if (R_.excepcionMensualPct > 0) {
    const fecha = datos.fecha || hoyLocal();
    const mes = parseInt(fecha.slice(5, 7), 10);
    const refC = referenciaMensualCentavos(f.monto_total, mes);
    if (refC > 0) {
      const topeC = Math.floor((refC * Math.round(R_.excepcionMensualPct * 100)) / 10000);
      const { ini, fin } = limitesMesUTC(fecha);
      const rS = await sb('gastos_solicitudes?fondo_id=eq.' + encodeURIComponent(datos.fondoId) + '&excepcional=eq.true&estado=not.in.(denegado,eliminada)' +
        '&created_at=gte.' + encodeURIComponent(ini) + '&created_at=lt.' + encodeURIComponent(fin) + '&select=id,monto_total');
      const ex = await rS.json();
      if (!rS.ok || !Array.isArray(ex)) throw new Error('No se pudieron leer las compras excepcionales del mes.');
      const usadoC = ex.filter((x) => String(x.id) !== String(datos.excluirId || '')).reduce((a, x) => a + centavosDe(x.monto_total), 0);
      out.refC = refC; out.topeC = topeC; out.usadoC = usadoC;
      if (usadoC + centavosDe(monto) > topeC) {
        return { error: 'Las compras excepcionales del mes sumarían $' + fmtC(usadoC + centavosDe(monto)) + ' y el tope mensual es el ' + R_.excepcionMensualPct + '% de la referencia del fondo ($' + fmtC(refC) + ' → $' + fmtC(topeC) +
          '); ya hay $' + fmtC(usadoC) + ' en compras excepcionales este mes. Lo no utilizado no se acumula para los meses siguientes.' };
      }
    }
  }
  return out;
}

// Saldo en efectivo y en banco de un fondo, calculado con los desembolsos
// reales: lo desembolsado (solicitudes desembolsadas o facturadas) que aún no
// fue repuesto por un reintegro entregado o cerrado. La forma de pago de cada
// solicitud decide el medio: efectivo -> efectivo; cheque o transferencia -> banco.
// El reparto efectivo/banco de la referencia mensual sale de las reglas del
// fondo (parámetro "efectivoPct").
async function calcularSaldoFondo(fondoId) {
  const f = await leerFondo(fondoId);
  if (!f) return null;
  const hoy = hoyLocal();
  const mes = parseInt(hoy.slice(5, 7), 10);
  const refC = referenciaMensualCentavos(f.monto_total, mes);
  const { reglas } = await cargarReglas();
  const R_ = reglas[f.tipo];
  const efectivoCapC = R_ ? Math.round((refC * Math.round(R_.efectivoPct * 100)) / 10000) : refC;
  const bancoCapC = refC - efectivoCapC;

  const rS = await sb('gastos_solicitudes?fondo_id=eq.' + encodeURIComponent(fondoId) + '&estado=in.(desembolsado,facturado)&select=id,estado,forma_pago,monto_total');
  const sols = await rS.json();
  if (!rS.ok || !Array.isArray(sols)) throw new Error('No se pudieron leer los desembolsos del fondo.');
  let repuestas = new Set();
  const porSolicitud = {};
  if (sols.length) {
    const ids = sols.map((x) => x.id).join(',');
    const rG = await sb('gastos_registros?solicitud_id=in.(' + ids + ')&estado=neq.eliminado&select=solicitud_id,gestion_id');
    const gs = await rG.json();
    if (!rG.ok || !Array.isArray(gs)) throw new Error('No se pudieron leer los gastos del fondo.');
    gs.forEach((g) => { (porSolicitud[g.solicitud_id] = porSolicitud[g.solicitud_id] || []).push(g); });
    const gIds = Array.from(new Set(gs.map((g) => g.gestion_id).filter((x) => x != null)));
    if (gIds.length) {
      const rE = await sb('gastos_gestiones?id=in.(' + gIds.join(',') + ')&estado=in.(entregado,cerrado)&select=id');
      const es = await rE.json();
      if (!rE.ok || !Array.isArray(es)) throw new Error('No se pudieron leer las gestiones del fondo.');
      repuestas = new Set(es.map((e) => String(e.id)));
    }
  }
  let efectivoUsadoC = 0, bancoUsadoC = 0;
  sols.forEach((x) => {
    const gs = porSolicitud[x.id] || [];
    const repuesta = x.estado === 'facturado' && gs.length > 0 && gs.every((g) => g.gestion_id != null && repuestas.has(String(g.gestion_id)));
    if (repuesta) return;
    if (x.forma_pago === 'efectivo') efectivoUsadoC += centavosDe(x.monto_total); else bancoUsadoC += centavosDe(x.monto_total);
  });
  return { fondoId: f.id, tipo: f.tipo, mes, refC, efectivoCapC, bancoCapC, efectivoUsadoC, bancoUsadoC,
    efectivoDispC: efectivoCapC - efectivoUsadoC, bancoDispC: bancoCapC - bancoUsadoC };
}

// Fondo circulante y caja chica: si el administrador de ese fondo tiene un
// reintegro ya entregado por Tesorería y todavía no confirmó que lo recibió, no
// puede usar el fondo (no se inicia un ciclo nuevo hasta confirmar). Devuelve
// esa gestión (o null). Lo usan solicitudes.js y gastos.js. (El nombre se
// conserva por compatibilidad.)
async function bloqueoCajaChica(fondoId, actorId) {
  if (!fondoId || !actorId) return null;
  const rG = await sb('gastos_gestiones?fondo_id=eq.' + encodeURIComponent(fondoId) + '&administrador_id=eq.' + encodeURIComponent(actorId) +
    '&estado=eq.entregado&select=id,tipo,mes,anio,fecha_desde,fecha_hasta,monto_total,acuerdo_url,acuerdo_nombre,comprobante_url,comprobante_nombre&order=created_at.asc&limit=1');
  const g = await rG.json();
  return (rG.ok && g[0]) || null;
}

module.exports = async (req, res) => {
  if (!URL || !KEY) { res.status(500).json({ error: 'Faltan variables de entorno del servidor.' }); return; }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const action = q.action || 'list';

      if (action === 'list') {
        let path = 'gastos_gestiones?select=*&order=created_at.desc';
        if (q.fondoId) path += '&fondo_id=eq.' + encodeURIComponent(q.fondoId);
        if (q.estado) path += String(q.estado).indexOf(',') !== -1
          ? '&estado=in.(' + String(q.estado).split(',').map(encodeURIComponent).join(',') + ')'
          : '&estado=eq.' + encodeURIComponent(q.estado);
        if (q.tipo) path += '&tipo=eq.' + encodeURIComponent(q.tipo);
        if (q.administradorId) path += '&administrador_id=eq.' + encodeURIComponent(q.administradorId);
        const r = await sb(path);
        res.status(200).json({ ok: r.ok, gestiones: await r.json() });
        return;
      }

      res.status(400).json({ error: 'Acción GET no reconocida.' });
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const action = body.action;

      if (action === 'crear') {
        const fondoId = parseInt(body.fondo_id, 10);
        const tipo = TIPOS_GESTION.indexOf(body.tipo) !== -1 ? body.tipo : null;
        const desde = String(body.fecha_desde || ''), hasta = String(body.fecha_hasta || '');
        const ids = (Array.isArray(body.gasto_ids) ? body.gasto_ids : []).map((x) => parseInt(x, 10)).filter(Number.isInteger);
        if (!Number.isInteger(fondoId)) { res.status(400).json({ ok: false, error: 'Falta el fondo.' }); return; }
        if (!tipo) { res.status(400).json({ ok: false, error: 'Selecciona si es Reintegro o Liquidación.' }); return; }
        const reFecha = /^\d{4}-\d{2}-\d{2}$/;
        if (!reFecha.test(desde) || !reFecha.test(hasta) || desde > hasta) {
          res.status(400).json({ ok: false, error: 'El rango de fechas no es válido.' }); return;
        }
        if (!ids.length) { res.status(400).json({ ok: false, error: 'Selecciona al menos un gasto.' }); return; }

        const rFondo = await sb('gastos_fondos?id=eq.' + fondoId + '&select=tipo,monto_total,anio');
        const fondoData = await rFondo.json();
        if (!rFondo.ok || !fondoData[0]) { res.status(400).json({ ok: false, error: 'El fondo no existe.' }); return; }
        const cuenta = String(body.cuenta_bancaria || '').trim();
        if (tipo === 'reintegro' && fondoData[0].tipo === 'circulante' && !cuenta) {
          res.status(400).json({ ok: false, error: 'Indica la cuenta bancaria del administrador (banco y número) para la transferencia del reintegro.' });
          return;
        }

        // Normalmente quien gestiona es el propio administrador del fondo
        // (actor_id). Un administrador de Bitrix24 puede hacerlo en nombre
        // de otro administrador de fondo (elegido en el selector de Informe
        // de Gastos) -- en ese caso administrador_id llega aparte y NO debe
        // confundirse con actor_id (quien ejecuta la acción).
        const administradorId = (body.actor_is_admin && body.administrador_id) ? String(body.administrador_id) : String(body.actor_id || '');
        const administradorNombre = (body.actor_is_admin && body.administrador_id) ? (body.administrador_nombre || '') : (body.actor_nombre || '');

        if (!body.actor_is_admin) {
          const chk = await sb(
            'gastos_fondo_usuarios?fondo_id=eq.' + encodeURIComponent(fondoId) +
            '&usuario_id=eq.' + encodeURIComponent(body.actor_id || '') + '&es_administrador=eq.true&select=id'
          );
          const chkData = await chk.json();
          if (!chk.ok || !Array.isArray(chkData) || !chkData.length) {
            res.status(403).json({ ok: false, error: 'No eres administrador de este fondo.' });
            return;
          }
        }

        const rGastos = await sb(
          'gastos_registros?id=in.(' + ids.join(',') + ')&fondo_id=eq.' + fondoId +
          '&estado=eq.registrado&fecha=gte.' + desde + '&fecha=lte.' + hasta + '&select=*'
        );
        const gastosData = await rGastos.json();
        if (!rGastos.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(gastosData) }); return; }
        if (!Array.isArray(gastosData) || gastosData.length !== ids.length) {
          res.status(400).json({ ok: false, error: 'Algunos gastos seleccionados ya no están disponibles (otra gestión, otro fondo, otra fecha o ya informados). Actualiza la lista e inténtalo de nuevo.' });
          return;
        }

        // Un reintegro solo admite gastos cuyo documento físico ya recibió el
        // administrador, y solo se puede pedir al alcanzar el 60% de la
        // referencia mensual del fondo o a más tardar el último día del mes.
        // (La liquidación no tiene estas restricciones.)
        if (tipo === 'reintegro') {
          const RG = (await cargarReglas()).reglas[fondoData[0].tipo] || DEFAULTS.circulante;
          const sinDoc = RG.reintegroExigeDocumento === false ? [] : gastosData.filter((g) => !g.documento_fisico_recibido);
          if (sinDoc.length) {
            res.status(400).json({ ok: false, error: sinDoc.length + ' gasto(s) seleccionado(s) no tienen el documento físico recibido por el administrador (' +
              sinDoc.slice(0, 5).map((g) => g.numero_documento || ('#' + g.id)).join(', ') + (sinDoc.length > 5 ? '…' : '') +
              '). Márcalos como recibidos o quítalos del reintegro.' });
            return;
          }
          const ev = evaluarReintegro(fondoData[0].monto_total, gastosData, undefined, RG);
          if (!ev.ok) {
            res.status(400).json({ ok: false, error: 'Aún no se puede solicitar el reintegro: los gastos seleccionados suman $' + fmtC(ev.montoC) +
              ' y se necesita al menos el ' + ev.pct + '% de la referencia mensual del fondo ($' + fmtC(ev.refC) + ' → $' + fmtC(ev.umbralC) + '); faltan $' + fmtC(ev.faltaC) + '.' +
              (ev.plazoCuenta ? ' También podrás solicitarlo a más tardar el último día del mes (' + fmtFecha(ev.limite) + ').' : '') });
            return;
          }
        }

        const montoTotal = gastosData.reduce((acc, g) => acc + (Number(g.monto_total) || 0), 0);
        const rGestion = await sb('gastos_gestiones', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            fondo_id: fondoId, administrador_id: administradorId, administrador_nombre: administradorNombre,
            tipo: tipo, mes: parseInt(desde.slice(5, 7), 10), anio: parseInt(desde.slice(0, 4), 10),
            fecha_desde: desde, fecha_hasta: hasta, cuenta_bancaria: cuenta || null,
            monto_total: Math.round(montoTotal * 100) / 100,
            estado: 'pendiente', created_by_id: String(body.actor_id || ''), created_by_nombre: body.actor_nombre || ''
          })
        });
        const gestionData = await rGestion.json();
        if (!rGestion.ok || !gestionData[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(gestionData) }); return; }
        const gestion = gestionData[0];

        const rUpdate = await sb('gastos_registros?id=in.(' + ids.join(',') + ')', {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ estado: 'informado', gestion_id: gestion.id, updated_at: new Date().toISOString() })
        });
        if (!rUpdate.ok) { res.status(500).json({ ok: false, error: 'La gestión se creó pero no se pudieron actualizar todos los gastos.' }); return; }

        res.status(200).json({ ok: true, gestion: gestion, actualizados: ids.length });
        return;
      }

      if (action === 'revisar') {
        if (!body.id) { res.status(400).json({ ok: false, error: 'Falta id.' }); return; }
        // Revisar/autorizar una gestión: solo personal del Departamento de
        // Presupuesto (incluido su jefe), verificado contra Bitrix24.
        try {
          if (!(await presupuesto.puedeComoPresupuesto(body))) {
            res.status(403).json({ ok: false, error: 'Solo el personal del Departamento de Presupuesto (incluido su jefe) o un administrador del portal puede revisar y autorizar una gestión.' });
            return;
          }
        } catch (ePers) {
          res.status(502).json({ ok: false, error: 'No se pudo verificar tu pertenencia al Departamento de Presupuesto: ' + String((ePers && ePers.message) || ePers) });
          return;
        }
        const actual = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id) + '&select=*');
        const actualData = await actual.json();
        if (!actual.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(actualData) }); return; }
        if (!actualData || !actualData[0]) { res.status(404).json({ ok: false, error: 'La gestión no existe.' }); return; }
        if (actualData[0].estado !== 'pendiente') { res.status(400).json({ ok: false, error: 'Esta gestión ya fue revisada.' }); return; }

        const pdf = body.pdf || {};
        if (!pdf.dataBase64 || !pdf.filename) { res.status(400).json({ ok: false, error: 'Falta el PDF generado.' }); return; }

        // Presupuesto puede haber editado montos de los gastos: el total de la
        // gestión se recalcula con lo que realmente quedó.
        const rSuma = await sb('gastos_registros?gestion_id=eq.' + encodeURIComponent(body.id) + '&estado=eq.informado&select=monto_total');
        const sumaData = await rSuma.json();
        if (!rSuma.ok || !Array.isArray(sumaData) || !sumaData.length) {
          res.status(400).json({ ok: false, error: 'La gestión no tiene gastos para autorizar.' });
          return;
        }
        const montoRevisado = Math.round(sumaData.reduce((a, x) => a + (Number(x.monto_total) || 0), 0) * 100) / 100;

        let subido;
        try {
          subido = await subirPdfADisk(sanitizarNombreArchivo(actualData[0].administrador_nombre), pdf.filename, pdf.dataBase64);
        } catch (e) {
          console.error('gestiones.revisar: fallo al subir el PDF a Bitrix24 Disk — ' + (e && e.message || e));
          res.status(502).json({ ok: false, error: 'No se pudo guardar el PDF en Bitrix24 Disk: ' + (e && e.message || e) });
          return;
        }

        const r = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id), {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            estado: 'revisado', monto_total: montoRevisado, pdf_url: subido.url, pdf_nombre: subido.nombre,
            revisado_at: new Date().toISOString(), revisado_por_id: String(body.actor_id || ''), revisado_por_nombre: body.actor_nombre || ''
          })
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(data) }); return; }

        const g = data[0];
        const etiq = (TIPO_LABEL[g.tipo] || g.tipo) + ' ' + etiquetaPeriodo(g);
        await notificar(
          g.administrador_id,
          'Presupuesto revisó y autorizó tu gestión de ' + etiq + '. Imprime el comprobante para tu archivo físico; Tesorería realizará el trámite.\n' +
          (subido.url ? '[URL=' + subido.url + ']📄 Ver comprobante[/URL]' : ''),
          'Tu gestión de ' + etiq + ' fue autorizada por Presupuesto.',
          'GASTOS_GESTION_REVISADA_' + g.id
        );
        // Avisa al personal del Departamento de Tesorería (miembros + jefe).
        try {
          const tUsers = await presupuesto.usuariosTesoreria();
          for (const tId of tUsers) {
            await notificar(tId,
              'Gestión de ' + etiq + ' de ' + (g.administrador_nombre || 'un administrador de fondo') + ' autorizada por Presupuesto: ya puede registrarse en Tesorería.',
              'Gestión autorizada por Presupuesto, pendiente de Tesorería.', 'GASTOS_GESTION_TESORERIA_' + g.id);
          }
        } catch (eT) { /* best-effort */ }

        res.status(200).json({ ok: true, gestion: g });
        return;
      }

      if (action === 'registrar_tesoreria') {
        if (!body.id) { res.status(400).json({ ok: false, error: 'Falta id.' }); return; }
        // Liberar el reintegro (acuerdo + comprobante/voucher) solo lo hace el
        // personal del Departamento de Tesorería, verificado contra Bitrix24.
        try {
          if (!(await presupuesto.puedeComoTesoreria(body))) {
            res.status(403).json({ ok: false, error: 'Solo el personal del Departamento de Tesorería o un administrador del portal puede registrar el reintegro.' });
            return;
          }
        } catch (ePers) {
          res.status(502).json({ ok: false, error: 'No se pudo verificar tu pertenencia al Departamento de Tesorería: ' + String((ePers && ePers.message) || ePers) });
          return;
        }
        const rA = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id) + '&select=*');
        const aData = await rA.json();
        if (!rA.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(aData) }); return; }
        const ges = aData && aData[0];
        if (!ges) { res.status(404).json({ ok: false, error: 'La gestión no existe.' }); return; }
        if (ges.tipo !== 'reintegro') { res.status(400).json({ ok: false, error: 'Esto aplica solo a reintegros.' }); return; }
        if (ges.estado !== 'revisado') { res.status(400).json({ ok: false, error: 'Esta gestión todavía no fue autorizada por Presupuesto, o Tesorería ya la registró.' }); return; }

        const prefijo = URL + '/storage/v1/object/public/comprobantes/';
        const acuerdo = body.acuerdo || {}, comp = body.comprobante || {};
        if (!String(acuerdo.url || '').startsWith(prefijo)) { res.status(400).json({ ok: false, error: 'Falta subir el acuerdo municipal (PDF).' }); return; }
        if (!String(comp.url || '').startsWith(prefijo)) { res.status(400).json({ ok: false, error: 'Falta subir el comprobante (transferencia, voucher o cheque).' }); return; }

        const rF = await sb('gastos_fondos?id=eq.' + encodeURIComponent(ges.fondo_id) + '&select=tipo');
        const fData = await rF.json();
        const esCajaChica = !!(fData && fData[0] && fData[0].tipo === 'caja_chica');
        const ahora = new Date().toISOString();
        const patch = {
          acuerdo_url: acuerdo.url, acuerdo_nombre: acuerdo.nombre || 'Acuerdo municipal',
          comprobante_url: comp.url, comprobante_nombre: comp.nombre || 'Comprobante',
          tesoreria_at: ahora, tesoreria_por_id: String(body.actor_id || ''), tesoreria_por_nombre: body.actor_nombre || ''
        };
        // Tanto en fondo circulante (transferencia) como en caja chica
        // (voucher/cheque) el reintegro queda "entregado": el ciclo se cierra
        // cuando el administrador confirma que recibió los fondos.
        patch.estado = 'entregado';
        const r = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id), {
          method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch)
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(data) }); return; }
        const etiq = (TIPO_LABEL[ges.tipo] || ges.tipo) + ' ' + etiquetaPeriodo(ges);
        await notificar(
          ges.administrador_id,
          esCajaChica
            ? 'Tesorería entregó tu ' + etiq + ' (acuerdo municipal y voucher/cheque). Entra a la app y confirma que lo recibiste: mientras no lo hagas no podrás usar la caja chica.'
            : 'Tesorería realizó la transferencia de tu ' + etiq + ' (acuerdo municipal y comprobante cargados). Entra a la app y confirma que la recibiste: mientras no lo hagas no podrás usar el fondo circulante.',
          esCajaChica ? 'Confirma que recibiste tu reintegro de caja chica.' : 'Confirma que recibiste tu reintegro.',
          'GASTOS_GESTION_TESORERIA_OK_' + ges.id
        );
        res.status(200).json({ ok: true, gestion: data[0] });
        return;
      }

      if (action === 'confirmar') {
        if (!body.id) { res.status(400).json({ ok: false, error: 'Falta id.' }); return; }
        const rC = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id) + '&select=estado,administrador_id');
        const cData = await rC.json();
        if (!rC.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(cData) }); return; }
        if (!cData || !cData[0]) { res.status(404).json({ ok: false, error: 'La gestión no existe.' }); return; }
        if (!body.actor_is_admin && String(cData[0].administrador_id) !== String(body.actor_id || '')) {
          res.status(403).json({ ok: false, error: 'Solo el administrador del fondo (o un administrador del portal) puede confirmar la recepción.' });
          return;
        }
        if (cData[0].estado !== 'entregado') { res.status(400).json({ ok: false, error: 'Esta gestión no está pendiente de confirmar.' }); return; }
        const r = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id), {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ estado: 'cerrado', cerrado_at: new Date().toISOString(), cerrado_por_id: String(body.actor_id || ''), cerrado_por_nombre: body.actor_nombre || '' })
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(data) }); return; }
        res.status(200).json({ ok: true, gestion: data[0] });
        return;
      }

      if (action === 'cerrar') {
        if (!body.id) { res.status(400).json({ ok: false, error: 'Falta id.' }); return; }
        try {
          if (!(await presupuesto.puedeComoTesoreria(body))) {
            res.status(403).json({ ok: false, error: 'Solo el personal del Departamento de Tesorería o un administrador del portal puede cerrar una liquidación.' });
            return;
          }
        } catch (ePers) {
          res.status(502).json({ ok: false, error: 'No se pudo verificar tu pertenencia al Departamento de Tesorería: ' + String((ePers && ePers.message) || ePers) });
          return;
        }
        const actual = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id) + '&select=estado,tipo');
        const actualData = await actual.json();
        if (!actual.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(actualData) }); return; }
        if (!actualData || !actualData[0]) { res.status(404).json({ ok: false, error: 'La gestión no existe.' }); return; }
        if (actualData[0].tipo !== 'liquidacion') { res.status(400).json({ ok: false, error: 'Los reintegros se cierran registrando el acuerdo municipal y el comprobante.' }); return; }
        if (actualData[0].estado !== 'revisado') { res.status(400).json({ ok: false, error: 'Esta gestión todavía no fue revisada, o ya está cerrada.' }); return; }

        const r = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id), {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            estado: 'cerrado', cerrado_at: new Date().toISOString(),
            cerrado_por_id: String(body.actor_id || ''), cerrado_por_nombre: body.actor_nombre || ''
          })
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(data) }); return; }
        res.status(200).json({ ok: true, gestion: data[0] });
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

module.exports.bloqueoCajaChica = bloqueoCajaChica;
module.exports.evaluarReintegro = evaluarReintegro;
module.exports.evaluarCuantia = evaluarCuantia;
module.exports.calcularSaldoFondo = calcularSaldoFondo;
module.exports.reglasPublicas = reglasPublicas;
module.exports.cargarReglas = cargarReglas;
module.exports.guardarReglas = guardarReglas;
module.exports.historialReglas = historialReglas;
module.exports.normalizarReglas = normalizarReglas;
module.exports.invalidarCacheReglas = invalidarCacheReglas;
module.exports.DEFAULTS = DEFAULTS;
module.exports.fechaLocalDe = fechaLocalDe;
module.exports.fmtC = fmtC;
module.exports.referenciaMensualCentavos = referenciaMensualCentavos;
