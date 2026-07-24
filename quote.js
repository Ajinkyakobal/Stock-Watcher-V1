// /api/quote — Vercel serverless proxy to Yahoo Finance (same source yfinance uses).
// No API key. Cached 5 min at the edge. CommonJS + global fetch (Node 18+ on Vercel).
// GET /api/quote?symbols=MSFT,AAPL&range=1y   → { MSFT:{ok,closes,price,prevClose}, ... }

const RANGES = new Set(['5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y']);

module.exports = async (req, res) => {
  const q = req.query || {};
  const symbols = String(q.symbols || '')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 40);
  const range = RANGES.has(q.range) ? q.range : '1y';
  const out = {};

  await Promise.all(symbols.map(async sym => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
                  `?range=${range}&interval=1d`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (portfolio-intel-showcase)' }
      });
      const j = await r.json();
      const c = j && j.chart && j.chart.result && j.chart.result[0];
      if (!c) throw new Error('no result');
      const closes = (((c.indicators || {}).quote || [{}])[0].close || [])
        .filter(v => v != null);
      const meta = c.meta || {};
      if (meta.regularMarketPrice != null && closes.length) {
        closes[closes.length - 1] = meta.regularMarketPrice; // last point = live price
      }
      out[sym] = {
        ok: closes.length > 5,
        closes,
        price: meta.regularMarketPrice != null ? meta.regularMarketPrice : closes[closes.length - 1],
        prevClose: meta.chartPreviousClose != null ? meta.chartPreviousClose : null,
        currency: meta.currency || 'USD'
      };
    } catch (e) {
      out[sym] = { ok: false, error: String((e && e.message) || e) };
    }
  }));

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(out);
};
