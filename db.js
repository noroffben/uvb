// Datalager: Postgres (Neon) om DATABASE_URL finns, annars ett minne-lager
// för lokal testning (data försvinner vid omstart).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function createPgStore(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString,
    // Neon kräver SSL. En lokal databas (localhost) körs utan.
    ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString) ? false : { rejectUnauthorized: false },
    max: 5,
  });

  return {
    kind: 'postgres',

    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS slots (
          day           TEXT PRIMARY KEY CHECK (day ~ '^\\d{4}-\\d{2}-\\d{2}$'),
          note          TEXT NOT NULL DEFAULT '',
          member_number TEXT CHECK (member_number ~ '^\\d{4}$'),
          booked_at     TIMESTAMPTZ,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
    },

    async list(from, to) {
      const { rows } = await pool.query(
        `SELECT day, note, member_number, booked_at
           FROM slots WHERE day >= $1 AND day <= $2 ORDER BY day`,
        [from, to]
      );
      return rows.map(r => ({
        day: r.day,
        note: r.note,
        memberNumber: r.member_number,
        bookedAt: r.booked_at ? new Date(r.booked_at).toISOString() : null,
      }));
    },

    // Öppnar ett datum (gör det rött) eller uppdaterar anteckningen.
    async upsert(day, note) {
      await pool.query(
        `INSERT INTO slots (day, note) VALUES ($1, $2)
         ON CONFLICT (day) DO UPDATE SET note = EXCLUDED.note`,
        [day, note]
      );
    },

    // Stänger ett datum (gör det grått igen). Tar även bort en ev. bokning.
    async remove(day) {
      await pool.query(`DELETE FROM slots WHERE day = $1`, [day]);
    },

    // Först till kvarn: uppdateringen lyckas bara om datumet är ledigt.
    async book(day, memberNumber) {
      const { rowCount } = await pool.query(
        `UPDATE slots SET member_number = $2, booked_at = now()
          WHERE day = $1 AND member_number IS NULL`,
        [day, memberNumber]
      );
      if (rowCount === 1) return 'ok';
      const { rowCount: exists } = await pool.query(
        `SELECT 1 FROM slots WHERE day = $1`, [day]
      );
      return exists ? 'taken' : 'not_open';
    },

    async cancel(day) {
      await pool.query(
        `UPDATE slots SET member_number = NULL, booked_at = NULL WHERE day = $1`,
        [day]
      );
    },
  };
}

function createMemoryStore() {
  const slots = new Map();
  return {
    kind: 'memory',
    async init() {},
    async list(from, to) {
      return [...slots.values()]
        .filter(s => s.day >= from && s.day <= to)
        .sort((a, b) => a.day.localeCompare(b.day))
        .map(s => ({ ...s }));
    },
    async upsert(day, note) {
      const s = slots.get(day);
      if (s) s.note = note;
      else slots.set(day, { day, note, memberNumber: null, bookedAt: null });
    },
    async remove(day) { slots.delete(day); },
    async book(day, memberNumber) {
      const s = slots.get(day);
      if (!s) return 'not_open';
      if (s.memberNumber) return 'taken';
      s.memberNumber = memberNumber;
      s.bookedAt = new Date().toISOString();
      return 'ok';
    },
    async cancel(day) {
      const s = slots.get(day);
      if (s) { s.memberNumber = null; s.bookedAt = null; }
    },
  };
}

function createStore() {
  const url = process.env.DATABASE_URL;
  return url ? createPgStore(url) : createMemoryStore();
}

module.exports = { createStore, DATE_RE };
