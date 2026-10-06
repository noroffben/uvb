const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { createStore, DATE_RE } = require('./db');

const PORT = process.env.PORT || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TZ = 'Europe/Stockholm';

if (!/^\d{4}$/.test(ADMIN_CODE)) {
  console.warn('VARNING: ADMIN_CODE saknas eller är inte 4 siffror. Admin-inloggning är avstängd.');
}

const store = createStore();
const app = express();
app.set('trust proxy', 1); // Render ligger bakom en proxy
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Hjälpfunktioner ----------

function todayInSweden() {
  // sv-SE ger formatet YYYY-MM-DD
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

function isValidDay(day) {
  if (!DATE_RE.test(day)) return false;
  const d = new Date(day + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === day;
}

function cleanNote(note) {
  return String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// Enkel begränsning av antal försök per IP (skyddar 4-siffriga koder mot gissning).
function rateLimiter({ max, windowMs }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return {
    blocked(key) {
      const h = hits.get(key);
      return h && h.reset > Date.now() && h.count >= max;
    },
    hit(key) {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || h.reset < now) hits.set(key, { count: 1, reset: now + windowMs });
      else h.count++;
    },
    clear(key) { hits.delete(key); },
  };
}

const loginLimiter = rateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
const bookLimiter = rateLimiter({ max: 10, windowMs: 10 * 60 * 1000 });

// Admin-token: signerad tidsstämpel, giltig i 12 timmar.
const TOKEN_TTL = 12 * 60 * 60 * 1000;
function sign(payload) {
  return crypto.createHmac('sha256', SECRET + ADMIN_CODE).update(payload).digest('hex');
}
function makeToken() {
  const exp = String(Date.now() + TOKEN_TTL);
  return exp + '.' + sign(exp);
}
function validToken(token) {
  if (!token || !ADMIN_CODE) return false;
  const [exp, sig] = String(token).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  return sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function requireAdmin(req, res, next) {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!validToken(token)) return res.status(401).json({ error: 'Inte inloggad som admin.' });
  next();
}

function rangeFrom(req) {
  const { from, to } = req.query;
  if (!isValidDay(from) || !isValidDay(to) || from > to) return null;
  return { from, to };
}

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Publika endpoints ----------

app.get('/api/slots', wrap(async (req, res) => {
  const r = rangeFrom(req);
  if (!r) return res.status(400).json({ error: 'Ogiltigt datumintervall.' });
  const slots = await store.list(r.from, r.to);
  // Medlemsnumret skickas aldrig till vanliga besökare.
  res.json({
    today: todayInSweden(),
    slots: slots.map(s => ({ day: s.day, note: s.note, booked: !!s.memberNumber })),
  });
}));

app.post('/api/book', wrap(async (req, res) => {
  const ip = req.ip;
  if (bookLimiter.blocked(ip)) {
    return res.status(429).json({ error: 'För många försök. Vänta en stund och försök igen.' });
  }
  bookLimiter.hit(ip);

  const day = String(req.body?.day || '');
  const memberNumber = String(req.body?.memberNumber || '').trim();
  if (!isValidDay(day)) return res.status(400).json({ error: 'Ogiltigt datum.' });
  if (!/^\d{4}$/.test(memberNumber)) {
    return res.status(400).json({ error: 'Medlemsnumret ska vara exakt 4 siffror.' });
  }
  if (day < todayInSweden()) {
    return res.status(400).json({ error: 'Datumet har redan passerat.' });
  }

  const result = await store.book(day, memberNumber);
  if (result === 'ok') return res.json({ ok: true });
  if (result === 'taken') return res.status(409).json({ error: 'Tyvärr, någon hann före. Datumet är redan bokat.' });
  return res.status(404).json({ error: 'Datumet är inte öppet för bokning.' });
}));

// ---------- Admin ----------

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  if (!ADMIN_CODE) return res.status(503).json({ error: 'Admin är inte konfigurerad (ADMIN_CODE saknas).' });
  if (loginLimiter.blocked(ip)) {
    return res.status(429).json({ error: 'För många felaktiga försök. Vänta 15 minuter.' });
  }
  const code = String(req.body?.code || '');
  const ok = code.length === ADMIN_CODE.length &&
    crypto.timingSafeEqual(Buffer.from(code), Buffer.from(ADMIN_CODE));
  if (!ok) {
    loginLimiter.hit(ip);
    return res.status(401).json({ error: 'Fel kod.' });
  }
  loginLimiter.clear(ip);
  res.json({ token: makeToken() });
});

app.get('/api/admin/slots', requireAdmin, wrap(async (req, res) => {
  const r = rangeFrom(req);
  if (!r) return res.status(400).json({ error: 'Ogiltigt datumintervall.' });
  const slots = await store.list(r.from, r.to);
  res.json({ today: todayInSweden(), slots });
}));

app.put('/api/admin/slots/:day', requireAdmin, wrap(async (req, res) => {
  const { day } = req.params;
  if (!isValidDay(day)) return res.status(400).json({ error: 'Ogiltigt datum.' });
  await store.upsert(day, cleanNote(req.body?.note));
  res.json({ ok: true });
}));

app.delete('/api/admin/slots/:day', requireAdmin, wrap(async (req, res) => {
  const { day } = req.params;
  if (!isValidDay(day)) return res.status(400).json({ error: 'Ogiltigt datum.' });
  await store.remove(day);
  res.json({ ok: true });
}));

app.post('/api/admin/slots/:day/cancel', requireAdmin, wrap(async (req, res) => {
  const { day } = req.params;
  if (!isValidDay(day)) return res.status(400).json({ error: 'Ogiltigt datum.' });
  await store.cancel(day);
  res.json({ ok: true });
}));

// Admin-sidan är samma app, men i admin-läge.
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/healthz', (req, res) => res.send('ok'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Något gick fel på servern. Försök igen.' });
});

store.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Båtklubbens vaktkalender körs på port ${PORT} (lagring: ${store.kind})`);
      if (store.kind === 'memory') {
        console.warn('VARNING: DATABASE_URL saknas – bokningar sparas bara i minnet och försvinner vid omstart.');
      }
    });
  })
  .catch(err => {
    console.error('Kunde inte ansluta till databasen:', err.message);
    process.exit(1);
  });
