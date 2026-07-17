module.exports = async (req, res) => {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET;
    if (!url || !key) {
      res.status(500).json({ ok: false, error: 'Faltan variables de entorno SUPABASE_URL / SUPABASE_SECRET' });
      return;
    }
    const r = await fetch(url + '/rest/v1/gastos_registros?select=id&limit=1', {
      headers: { apikey: key, Authorization: 'Bearer ' + key }
    });
    const text = await r.text();
    res.status(200).json({ ok: r.ok, status: r.status, body: text });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
