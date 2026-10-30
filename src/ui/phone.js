// The phone (F) as a phone: a status bar, a home screen with the apps, the texts and the photos.
// hud.js wires the door camera and the shop into it; this file switches between the apps, keeps the SMS (the
// night's story texts, the courier, the guys texting from the next room) and shows the gallery.
// It only reads the game: nothing here changes a number.
import wallpaper from '../assets/art/mushrooms.webp?inline';
import { TUNE } from '../config.js';
import { dateOf } from '../game/story.js';
import { sfx } from '../audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const NOSTORY = new URLSearchParams(location.search).has('nostory'); // the story's texts are story: not with ?nostory
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

// ---------- who texts, and what ----------
const CONTACTS = {
  lyokha: { name: 'Лёха' },
  alexey: { name: 'Алексей' },
  kirill: { name: 'Кирилл' },
  temych: { name: 'Темыч' },
  mama: { name: 'Мама', glyph: '♥', bg: '#d9508a' },
  shop: { name: 'Продукты 24', glyph: '🛵', bg: '#e0822d' },
};
// the night's first texts: word for word the same for four nights (déjà vu); the fifth is the day after
const OPENING = (night) => (night >= 5
  ? [['mama', 'Сынок, как вчера отметили?'], ['lyokha', 'Олег, мы всё равно едем']]
  : [['lyokha', 'Олег, мы выезжаем 🍻'], ['mama', 'Сынок, с днём рождения! Не пейте много']]);
// the guys text him from the next room: two or three a night, at random times
const BANTER = [
  ['lyokha', 'Олег, сделай музон погромче'],
  ['lyokha', 'Я в туалете. Бумаги нет. Спаси'],
  ['lyokha', 'го ещё по одной'],
  ['alexey', 'Где открывашка?'],
  ['alexey', 'Кот на меня как-то не так смотрит'],
  ['alexey', 'Олег ты где, без тебя не чокаемся'],
  ['kirill', 'Шашлык почти всё, неси тарелку'],
  ['kirill', 'Кто взял мою картонку для мангала'],
  ['kirill', 'Олег, у тебя соседи нормальные вообще?'],
  ['temych', 'Сука. Пацаны, на следующей неделе также…'],
  ['temych', 'Скинь потом фотки'],
  ['temych', 'Олег, ты лучший'],
];
// one more a night that only fits that night
const NIGHTLY = {
  2: ['alexey', 'Олег, ты чего такой загруженный?'],
  3: ['kirill', 'Ты чё, не выспался? Лицо как будто третий день подряд'],
  4: ['temych', 'Олег, всё нормально, не гони'],
  5: ['lyokha', 'Ну давай, последний раз 🙏'],
};

// the app icons: white glyphs on a coloured tile, like any phone
const GLYPH = {
  cam: '<svg viewBox="0 0 24 24"><path d="M3.5 7h10A2.5 2.5 0 0 1 16 9.5v.6l4.3-2.5c.6-.3 1.2.1 1.2.7v7.4c0 .6-.6 1-1.2.7L16 13.9v.6a2.5 2.5 0 0 1-2.5 2.5h-10A2.5 2.5 0 0 1 1 14.5v-5A2.5 2.5 0 0 1 3.5 7z" fill="#fff"/><circle cx="4.6" cy="9.8" r="1.2" fill="#ff4a2c"/></svg>',
  shop: '<svg viewBox="0 0 24 24"><path d="M9 9.5V7a3 3 0 0 1 6 0v2.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M5.2 8.5h13.6l-1.1 11a2 2 0 0 1-2 1.8H8.3a2 2 0 0 1-2-1.8z" fill="#fff"/><circle cx="9" cy="11.5" r="1" fill="#e0822d"/><circle cx="15" cy="11.5" r="1" fill="#e0822d"/></svg>',
  sms: '<svg viewBox="0 0 24 24"><path d="M12 3.5c5.2 0 9.5 3.4 9.5 7.7s-4.3 7.7-9.5 7.7c-1 0-2-.1-2.9-.4L4.5 20.6l1.2-3.8C3.7 15.4 2.5 13.4 2.5 11.2 2.5 6.9 6.8 3.5 12 3.5z" fill="#fff"/></svg>',
  gallery: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5" fill="#fff"/><circle cx="8.3" cy="9.3" r="1.9" fill="#f2b33d"/><path d="M4.5 17.5l4.6-4.8 3.2 3.2 2.9-3 4.3 4.6z" fill="#7a5cff"/></svg>',
};
export const appIcon = (id) => `<i class="app-ico ${id}">${GLYPH[id]}</i>`;

export function createPhone({ avatar }) {
  const el = {
    phone: $('phone'), display: $('phone-display'), time: $('phone-time'), date: $('phone-date'), bat: $('phone-bat'), batPct: $('phone-bat-pct'),
    homeTime: $('home-time'), homeDate: $('home-date'), notes: $('home-notes'), badge: $('sms-badge'),
    apps: { home: $('app-home'), cam: $('phone-cam'), shop: $('phone-shop'), sms: $('phone-sms'), gallery: $('phone-gallery') },
    smsTitle: $('sms-title'), smsBody: $('sms-body'), galleryBody: $('gallery-body'), banner: $('phone-banner'),
    note: $('sms-note'), noteWho: $('sms-note-who'), noteText: $('sms-note-text'),
  };
  el.display.style.setProperty('--wallpaper', `url(${wallpaper})`);
  for (const i of document.querySelectorAll('#phone [data-ico], #sms-note [data-ico]')) i.outerHTML = appIcon(i.dataset.ico);
  el.badge = $('sms-badge'); // the icon it sat in was just replaced

  let cache = {};
  const set = (key, node, html) => {
    if (cache[key] === html) return false;
    cache[key] = html;
    node.innerHTML = html;
    return true;
  };
  const text = (node, s) => node.textContent !== s && (node.textContent = s);

  // ---- which app is up: home, cam, shop, sms (a thread, or the list), gallery (a photo, or the grid)
  let app = 'home', thread = null, viewer = null;
  const visible = () => !el.phone.hidden;
  function open(which, opts = {}) {
    if (which !== app) {
      thread = null;
      viewer = null;
    }
    app = which;
    if ('thread' in opts) thread = opts.thread;
    el.display.dataset.app = which;
    for (const [id, node] of Object.entries(el.apps)) node.hidden = id !== which;
    if (which === 'sms' && thread) threads[thread].unread = 0;
    cache.sms = cache.gallery = null;
    render();
  }
  function back() {
    if (app === 'gallery' && viewer !== null) viewer = null;
    else if (app === 'sms' && thread) thread = null;
    else if (app !== 'home') return open('home');
    cache.sms = cache.gallery = null;
    render();
  }
  el.phone.addEventListener('click', (e) => {
    const t = e.target.closest('[data-app], [data-thread], [data-photo], .app-back, #phone-back, #phone-home, #phone-banner');
    if (!t) return;
    sfx.click();
    if (t.id === 'phone-home') return open('home');
    if (t.id === 'phone-back' || t.classList.contains('app-back')) return back();
    if (t.dataset.app) return open(t.dataset.app);
    if (t.dataset.thread) return open('sms', { thread: t.dataset.thread });
    if (t.dataset.photo) {
      viewer = viewer === null ? Number(t.dataset.photo) : null;
      cache.gallery = null;
      return render();
    }
    if (t.id === 'phone-banner' && el.banner.dataset.from) return open('sms', { thread: el.banner.dataset.from });
  });

  // ---- the texts: kept across the nights (the same «мы выезжаем» piles up in Лёха's chat, all on 30.09)
  const threads = {}; // from -> { from, msgs: [{ text, time, date, session }], unread, last }
  let seq = 0, session = 0, plan = [], watched = [], seenOrders = new WeakSet(), lastState = null, game = null;
  const unread = () => Object.values(threads).reduce((n, th) => n + th.unread, 0);
  function receive(from, body) {
    const th = (threads[from] ??= { from, msgs: [], unread: 0, last: 0 });
    th.msgs.push({ text: body, time: game.clock, date: dateOf(game.night).text, session });
    if (th.msgs.length > 40) th.msgs.splice(0, th.msgs.length - 40);
    th.last = ++seq;
    const reading = visible() && app === 'sms' && thread === from;
    if (!reading) th.unread++;
    sfx.sms();
    const who = CONTACTS[from].name;
    if (visible()) {
      if (reading) return;
      el.banner.dataset.from = from;
      el.banner.innerHTML = `${appIcon('sms')}<span><b>${esc(who)}</b><span>${esc(body)}</span></span>`;
      flash(el.banner, 3200);
    } else {
      el.noteWho.textContent = `SMS: ${who}`;
      el.noteText.textContent = body;
      flash(el.note, 3600);
    }
  }
  const timers = new Map();
  function flash(node, ms) {
    node.hidden = false;
    node.classList.remove('in');
    void node.offsetWidth; // restart the slide-in
    node.classList.add('in');
    clearTimeout(timers.get(node));
    timers.set(node, setTimeout(() => (node.hidden = true), ms));
  }

  // a new night: its texts at their times (in the night's own seconds, so pauses and scenes don't count)
  function newNight() {
    session++;
    watched = [];
    const n = game.night, len = TUNE.nightSeconds;
    plan = NOSTORY ? [] : OPENING(n).map(([from, body], i) => ({ at: 2 + i * 5, from, body }));
    const lines = shuffle(BANTER).slice(0, 2 + (Math.random() < 0.5 ? 1 : 0));
    if (NIGHTLY[n]) lines[0] = NIGHTLY[n];
    let at = 0;
    for (const [from, body] of shuffle(lines)) {
      at = Math.max(at + 20, 30 + Math.random() * (len - 60));
      if (at < len - 12) plan.push({ at, from, body });
    }
    plan.sort((a, b) => a.at - b.at);
    el.note.hidden = el.banner.hidden = true;
  }

  function tick(g) {
    game = g;
    if (g.state !== lastState) {
      lastState = g.state;
      newNight();
    }
    const t = g.state.t;
    while (plan.length && plan[0].at <= t) {
      const m = plan.shift();
      receive(m.from, m.body);
    }
    // the courier: an order is placed (a new one, not one more thing into the open order), then he's here
    for (const o of g.orders) {
      if (seenOrders.has(o)) continue;
      seenOrders.add(o);
      watched.push(o);
      receive('shop', `Курьер: заказ в пути, ~${g.gameMinutes(Math.max(0, o.eta))} мин`);
    }
    for (const o of watched) if (o.done) receive('shop', 'Курьер у подъезда');
    watched = watched.filter((o) => !o.done && g.orders.includes(o));
  }

  // ---- drawing
  const ava = (from) => {
    const c = CONTACTS[from], url = c.glyph ? null : avatar(from, 'default');
    return url ? `<i class="sms-ava"><img src="${url}" alt=""></i>` : `<i class="sms-ava" style="background:${c.bg ?? '#3d7bd9'}">${esc(c.glyph ?? c.name[0])}</i>`;
  };
  const sorted = () => Object.values(threads).sort((a, b) => b.last - a.last);
  function renderSms() {
    if (!thread) {
      text(el.smsTitle, 'Сообщения');
      const list = sorted();
      return set('sms', el.smsBody, list.length
        ? list.map((th) => {
          const m = th.msgs.at(-1);
          return `<button type="button" class="sms-row${th.unread ? ' new' : ''}" data-thread="${th.from}">${ava(th.from)}<b>${esc(CONTACTS[th.from].name)}</b><time>${m.time}</time><span>${esc(m.text)}</span>${th.unread ? `<em>${th.unread}</em>` : ''}</button>`;
        }).join('')
        : '<p class="app-empty">Сообщений нет</p>');
    }
    const th = threads[thread];
    th.unread = 0;
    text(el.smsTitle, CONTACTS[thread].name);
    let html = '', last = null;
    for (const m of th.msgs) {
      if (m.session !== last) html += `<div class="sms-day">${esc(m.date)}</div>`; // every night its own day — the same day
      last = m.session;
      html += `<div class="sms-msg">${esc(m.text)}<time>${m.time}</time></div>`;
    }
    if (set('sms', el.smsBody, html)) el.smsBody.scrollTop = el.smsBody.scrollHeight;
  }

  // this night's photos, and the album of the nights before (game.album: oldest first), the newest on top
  function photos() {
    const tonight = game?.state.photos ?? [];
    const a = game?.album, all = Array.isArray(a) ? a : [];
    const before = all.filter((p) => p?.img && !tonight.some((q) => q === p || q.img === p.img)).reverse();
    return { tonight, before };
  }
  function renderGallery() {
    const { tonight, before } = photos(), list = [...tonight, ...before];
    const key = `${tonight.length}|${before.length}|${viewer}|${list.at(-1)?.img?.length ?? 0}`;
    if (cache.galleryKey === key && cache.gallery) return;
    cache.galleryKey = key;
    cache.gallery = true;
    if (viewer !== null && list[viewer]) {
      const p = list[viewer];
      el.galleryBody.innerHTML = `<button type="button" class="gal-view" data-photo="${viewer}"><img src="${p.img}" alt=""><b>${esc(p.caption ?? '')}</b><small>${viewer < tonight.length ? `сегодня · ${dateOf(game.night).short}` : esc([p.night && `ночь ${p.night}`, p.date].filter(Boolean).join(' · ') || 'раньше')}</small></button>`;
      return;
    }
    const tile = (p, i) => `<button type="button" class="gal-tile" data-photo="${i}"><img src="${p.img}" alt=""><span>${esc(p.caption ?? '')}</span>${i >= tonight.length && p.date ? `<small>${esc(p.date)}</small>` : ''}</button>`;
    const cap = TUNE.photo.perNight;
    let html = `<div class="gal-head">Сегодня <small>${tonight.length}/${cap}</small></div>`;
    html += tonight.length ? `<div class="gal-grid">${tonight.map(tile).join('')}</div>` : '<p class="app-empty">Пусто. Нажми C и лови момент: кто-то блюёт, танцует, спит, рыдает…</p>';
    if (before.length) html += `<div class="gal-head">Раньше</div><div class="gal-grid">${before.map((p, i) => tile(p, tonight.length + i)).join('')}</div>`;
    el.galleryBody.innerHTML = html;
  }

  function render() {
    if (!game) return;
    const n = unread();
    el.badge.hidden = !n;
    text(el.badge, String(n));
    if (app === 'home') {
      const fresh = sorted().filter((th) => th.unread).slice(0, 3);
      set('notes', el.notes, fresh.map((th) => {
        const m = th.msgs.at(-1);
        return `<button type="button" class="home-note" data-thread="${th.from}">${appIcon('sms')}<span><b>${esc(CONTACTS[th.from].name)}${th.unread > 1 ? ` <small>+${th.unread - 1}</small>` : ''}</b><span>${esc(m.text)}</span></span><time>${m.time}</time></button>`;
      }).join(''));
    }
    if (app === 'sms') renderSms();
    if (app === 'gallery') renderGallery();
  }

  return {
    open, back,
    get app() {
      return app;
    },
    reset() {
      cache = {};
    },
    // every HUD update (0.1 s), the phone up or not: the texts arrive in the pocket too
    update(g) {
      tick(g);
      if (!visible()) return;
      el.note.hidden = true; // the text is on the screen now
      // the status bar: the clock, the date (30.09 four times, then 01.10), the battery running down over the night
      const d = dateOf(g.night);
      text(el.time, g.clock);
      text(el.date, d.short);
      const pct = Math.round(86 - 72 * Math.min(1, g.state.t / TUNE.nightSeconds));
      text(el.batPct, `${pct}%`);
      el.bat.style.width = `${pct}%`;
      el.bat.parentElement.classList.toggle('low', pct <= 20);
      if (app === 'home') {
        text(el.homeTime, g.clock);
        text(el.homeDate, d.text);
      }
      render();
    },
  };
}
