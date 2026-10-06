(() => {
  'use strict';

  const isAdmin = location.pathname.replace(/\/+$/, '') === '/admin';
  const TOKEN_KEY = 'vakt-admin-token';

  const $ = id => document.getElementById(id);
  const grid = $('grid');
  const statusEl = $('status');
  const overlay = $('overlay');
  const modalBody = $('modalBody');

  const monthFmt = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const longFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const shortFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  const state = {
    today: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }),
    year: 0,
    month: 0, // 0–11
    slots: new Map(),
    token: sessionStorage.getItem(TOKEN_KEY) || '',
  };
  [state.year, state.month] = state.today.split('-').map(Number);
  state.month -= 1;

  // ---------- Hjälpfunktioner ----------

  const pad = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const asDate = day => new Date(day + 'T00:00:00Z');
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const niceDay = day => cap(longFmt.format(asDate(day)));

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  function setStatus(msg) {
    statusEl.textContent = msg || '';
  }

  async function api(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401 && isAdmin && url !== '/api/admin/login') {
      logout();
      throw new Error('Du har loggats ut. Logga in igen.');
    }
    if (!res.ok) throw new Error(data.error || 'Något gick fel. Försök igen.');
    return data;
  }

  // ---------- Dialog ----------

  function openModal({ eyebrow = '', title, content }) {
    $('modalEyebrow').textContent = eyebrow;
    $('modalTitle').textContent = title;
    modalBody.replaceChildren(...[].concat(content));
    overlay.classList.remove('hidden');
    const first = modalBody.querySelector('input, button.primary, button');
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() {
    if (overlay.dataset.locked) return;
    overlay.classList.add('hidden');
    modalBody.replaceChildren();
  }
  $('modalClose').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal();
  });

  function codeInput(id) {
    return el('input', {
      id, type: isAdmin && id === 'adminCode' ? 'password' : 'text',
      class: 'code', inputmode: 'numeric', pattern: '[0-9]*',
      maxlength: '4', autocomplete: 'off', placeholder: '····',
      oninput: e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); },
    });
  }

  // Kör en åtgärd med låst knapp och felmeddelande i dialogen.
  async function run(button, errorEl, fn) {
    button.disabled = true;
    errorEl.textContent = '';
    try { await fn(); }
    catch (err) { errorEl.textContent = err.message; }
    finally { button.disabled = false; }
  }

  // ---------- Kalender ----------

  async function load() {
    const first = iso(state.year, state.month, 1);
    const lastDay = new Date(Date.UTC(state.year, state.month + 1, 0)).getUTCDate();
    const last = iso(state.year, state.month, lastDay);
    const url = (isAdmin ? '/api/admin/slots' : '/api/slots') + `?from=${first}&to=${last}`;
    try {
      const data = await api('GET', url);
      state.today = data.today;
      state.slots = new Map(data.slots.map(s => [s.day, s]));
      setStatus('');
    } catch (err) {
      state.slots = new Map();
      setStatus(err.message);
    }
    render();
  }

  function render() {
    const { year, month } = state;
    $('monthTitle').textContent = monthFmt.format(new Date(Date.UTC(year, month, 1)));

    const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // måndag = 0
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(el('div', { class: 'day blank' }));

    for (let d = 1; d <= daysInMonth; d++) {
      const day = iso(year, month, d);
      const slot = state.slots.get(day);
      const past = day < state.today;
      const booked = slot && (isAdmin ? !!slot.memberNumber : slot.booked);
      const kind = !slot ? 'closed' : booked ? 'booked' : 'open';

      const classes = ['day', kind];
      if (past) classes.push('past');
      if (day === state.today) classes.push('today');

      // Medlemmar kan bara klicka på lediga framtida datum. Admin kan klicka på allt som inte passerat,
      // samt på passerade datum som har en bokning (för att se numret).
      const clickable = isAdmin ? (!past || !!slot) : (kind === 'open' && !past);
      if (clickable) classes.push('clickable');

      let tag = null;
      if (kind === 'open' && !past) tag = 'Ledig';
      if (kind === 'booked') tag = isAdmin ? slot.memberNumber : 'Bokad';

      const label = `${niceDay(day)}${kind === 'open' ? ', ledigt' : kind === 'booked' ? ', bokat' : ''}`;
      const cell = el(clickable ? 'button' : 'div',
        { class: classes.join(' '), 'aria-label': label, ...(clickable ? { type: 'button' } : {}) },
        el('span', { text: String(d) }),
        tag ? el('span', { class: 'tag', text: tag }) : null
      );
      if (clickable) cell.addEventListener('click', () => (isAdmin ? adminDialog(day) : bookDialog(day)));
      cells.push(cell);
    }
    grid.replaceChildren(...cells);

    if (isAdmin) renderBookingList();
  }

  function renderBookingList() {
    $('adminListMonth').textContent = monthFmt.format(new Date(Date.UTC(state.year, state.month, 1)));
    const items = [...state.slots.values()].sort((a, b) => a.day.localeCompare(b.day));
    const list = $('bookingList');
    if (!items.length) {
      list.replaceChildren(el('li', { class: 'empty', text: 'Inga öppna datum den här månaden.' }));
      return;
    }
    list.replaceChildren(...items.map(s => el('li', {},
      el('span', { text: cap(shortFmt.format(asDate(s.day))) + (s.note ? ' · ' + s.note : '') }),
      s.memberNumber
        ? el('span', { class: 'num', text: s.memberNumber })
        : el('span', { class: 'muted', text: 'Ledig' })
    )));
  }

  $('prevBtn').addEventListener('click', () => {
    if (--state.month < 0) { state.month = 11; state.year--; }
    load();
  });
  $('nextBtn').addEventListener('click', () => {
    if (++state.month > 11) { state.month = 0; state.year++; }
    load();
  });

  // ---------- Medlem: boka ----------

  function bookDialog(day) {
    const slot = state.slots.get(day);
    const input = codeInput('memberNumber');
    const error = el('p', { class: 'error' });
    const btn = el('button', { class: 'primary', type: 'submit', text: 'Boka passet' });

    const form = el('form', {},
      slot.note ? el('p', { class: 'note', text: slot.note }) : null,
      el('p', { text: 'Ange ditt 4-siffriga medlemsnummer. Först till kvarn gäller.' }),
      el('label', { for: 'memberNumber', text: 'Medlemsnummer' }),
      input, error,
      el('div', { class: 'actions' }, btn)
    );

    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!/^\d{4}$/.test(input.value)) { error.textContent = 'Fyll i exakt 4 siffror.'; return; }
      run(btn, error, async () => {
        try {
          await api('POST', '/api/book', { day, memberNumber: input.value });
        } catch (err) {
          await load(); // datumet kan ha blivit taget under tiden
          throw err;
        }
        await load();
        openModal({
          eyebrow: 'Klart',
          title: 'Du är bokad!',
          content: [
            el('p', { text: `Du är reservvakt ${niceDay(day).toLowerCase()}. Skriv gärna in det i din kalender.` }),
            slot.note ? el('p', { class: 'note', text: slot.note }) : null,
            el('div', { class: 'actions' }, el('button', { class: 'secondary', type: 'button', text: 'Stäng', onclick: closeModal })),
          ].filter(Boolean),
        });
      });
    });

    openModal({ eyebrow: 'Ledigt pass', title: niceDay(day), content: form });
  }

  // ---------- Admin ----------

  function noteForm(day, slot, submitText) {
    const input = el('input', {
      id: 'note', type: 'text', maxlength: '200',
      placeholder: 't.ex. 22:00–06:00', value: slot?.note || '',
    });
    const error = el('p', { class: 'error' });
    const btn = el('button', { class: 'primary', type: 'submit', text: submitText });
    const form = el('form', {},
      el('label', { for: 'note', text: 'Anteckning (syns för medlemmar, frivillig)' }),
      input, error,
      el('div', { class: 'actions' }, btn)
    );
    form.addEventListener('submit', e => {
      e.preventDefault();
      run(btn, error, async () => {
        await api('PUT', `/api/admin/slots/${day}`, { note: input.value });
        closeModal();
        await load();
      });
    });
    return { form, error };
  }

  function adminDialog(day) {
    const slot = state.slots.get(day);

    if (!slot) {
      const { form } = noteForm(day, null, 'Öppna datumet');
      openModal({ eyebrow: 'Stängt datum', title: niceDay(day), content: [
        el('p', { text: 'Öppna datumet så blir det rött och medlemmar kan boka det.' }),
        form,
      ]});
      return;
    }

    const error = el('p', { class: 'error' });

    const closeBtn = el('button', { class: 'danger', type: 'button', text: 'Stäng datumet (gör grått)' });
    closeBtn.addEventListener('click', () => {
      if (slot.memberNumber && !confirm(`Datumet är bokat av ${slot.memberNumber}. Stänga ändå? Bokningen tas bort.`)) return;
      run(closeBtn, error, async () => {
        await api('DELETE', `/api/admin/slots/${day}`);
        closeModal();
        await load();
      });
    });

    if (slot.memberNumber) {
      const cancelBtn = el('button', { class: 'secondary', type: 'button', text: 'Avboka (gör ledigt igen)' });
      cancelBtn.addEventListener('click', () => {
        if (!confirm(`Avboka medlem ${slot.memberNumber}? Datumet blir ledigt för andra.`)) return;
        run(cancelBtn, error, async () => {
          await api('POST', `/api/admin/slots/${day}/cancel`);
          closeModal();
          await load();
        });
      });
      const bookedAt = slot.bookedAt
        ? new Date(slot.bookedAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' })
        : '';
      const { form } = noteForm(day, slot, 'Spara anteckning');
      openModal({ eyebrow: 'Bokat', title: niceDay(day), content: [
        el('label', { text: 'Medlemsnummer' }),
        el('p', { class: 'big-num', text: slot.memberNumber }),
        bookedAt ? el('p', { class: 'muted', text: 'Bokades ' + bookedAt }) : null,
        form,
        error,
        el('div', { class: 'actions' }, cancelBtn, closeBtn),
      ].filter(Boolean)});
      return;
    }

    const { form } = noteForm(day, slot, 'Spara anteckning');
    openModal({ eyebrow: 'Ledigt', title: niceDay(day), content: [
      el('p', { text: 'Datumet är öppet för bokning.' }),
      form,
      error,
      el('div', { class: 'actions' }, closeBtn),
    ]});
  }

  function loginDialog() {
    const input = codeInput('adminCode');
    const error = el('p', { class: 'error' });
    const btn = el('button', { class: 'primary', type: 'submit', text: 'Logga in' });
    const form = el('form', {},
      el('label', { for: 'adminCode', text: 'Admin-kod' }),
      input, error,
      el('div', { class: 'actions' }, btn)
    );
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!/^\d{4}$/.test(input.value)) { error.textContent = 'Fyll i 4 siffror.'; return; }
      run(btn, error, async () => {
        const { token } = await api('POST', '/api/admin/login', { code: input.value });
        state.token = token;
        sessionStorage.setItem(TOKEN_KEY, token);
        delete overlay.dataset.locked;
        closeModal();
        startAdmin();
      });
    });
    overlay.dataset.locked = '1';
    $('modalClose').classList.add('hidden');
    openModal({ eyebrow: 'Admin', title: 'Logga in', content: form });
  }

  function logout() {
    state.token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    grid.replaceChildren();
    $('adminList').classList.add('hidden');
    $('logoutBtn').classList.add('hidden');
    loginDialog();
  }

  function startAdmin() {
    $('modalClose').classList.remove('hidden');
    $('adminList').classList.remove('hidden');
    $('logoutBtn').classList.remove('hidden');
    load();
  }

  // ---------- Start ----------

  if (isAdmin) {
    document.body.classList.add('is-admin');
    document.title = 'Admin – Reservvakt';
    $('eyebrow').textContent = 'Admin';
    $('eyebrow').classList.add('admin');
    $('lead').textContent = 'Klicka på ett grått datum för att öppna det. Klicka på ett rött eller bokat datum för att ändra, avboka eller stänga.';
    $('logoutBtn').addEventListener('click', logout);
    if (state.token) startAdmin(); else loginDialog();
  } else {
    load();
  }
})();
