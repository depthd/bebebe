// DOM HUD: meters, participants, toasts, interaction prompt, hotbar, phone, end screen.
import { TUNE } from '../config.js';
import { ITEMS } from '../game/game.js';
import { iconURL, iconImg, hasRealIcon } from './icons.js';
import { moodFace, moodState } from '../world/faces.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// round portraits for the HUD, cut from the same mood pictures the heads use
const avatars = {};
function avatar(who, state) {
  const st = moodState(who, state) ?? 'default';
  const key = `${who}_${st}`;
  if (key in avatars) return avatars[key];
  avatars[key] = null;
  moodFace(who, st).then((f) => {
    const n = 96, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const src = f.canvas, k = Math.max(n / src.width, n / src.height) * 1.08; // fill the circle, chin may crop
    g.drawImage(src, (n - src.width * k) / 2, n * 0.04, src.width * k, src.height * k);
    avatars[key] = c.toDataURL();
  });
  return null;
}
// fun 0..100 -> ring colour, red through amber to green
const funColor = (v) => `hsl(${Math.round(Math.max(0, Math.min(100, v)) * 1.15)} 75% 55%)`;

export function createHUD({ onBuy }) {
  const el = {
    hud: $('hud'), night: $('night'), time: $('time'), room: $('room'), courier: $('courier-chip'),
    energy: $('bar-energy'), ofun: $('bar-ofun'), othirst: $('othirst'), handName: $('hand-name'), total: $('bar-total'), hut: $('bar-hut'), noise: $('bar-noise'), anger: $('anger'), people: $('people'), toasts: $('toasts'),
    prompt: $('prompt'), hotbar: $('hotbar'), doorAlert: $('door-alert'), blackout: $('blackout'),
    phone: $('phone'), phoneTime: $('phone-time'), phoneMoney: $('phone-money'),
    tabCam: $('tab-cam'), tabShop: $('tab-shop'), cam: $('phone-cam'), camView: $('cam-view'), camWho: $('cam-who'),
    shop: $('phone-shop'), shopList: $('shop-list'), shopTotal: $('shop-total'), orders: $('orders'),
    slide: $('slide'), slideKnob: $('slide-knob'), slideFill: $('slide-fill'), slideText: $('slide-text'),
  };
  let cache = {};
  const set = (key, node, html) => {
    if (cache[key] === html) return;
    cache[key] = html;
    node.innerHTML = html;
  };

  // ---- phone shop: one page — every item with − / +, the total, one slide buys it all (one courier)
  const items = TUNE.shop.filter((s) => !s.soon);
  const cart = Object.fromEntries(items.map((it) => [it.id, 0]));
  let money = 0;
  $('ico-cam').src = iconURL('camera');
  $('ico-shop').src = iconURL('cart');
  const total = () => items.reduce((sum, it) => sum + cart[it.id] * it.price, 0);
  const renderShop = () => {
    el.shopList.innerHTML = items
      .map((it) => `<div class="shop-row${cart[it.id] ? ' in' : ''}" data-id="${it.id}">${iconImg(it.icon, '')}<div class="info"><b>${esc(it.title)}</b><small>${esc(it.note ?? '')}</small><span class="price">${it.price} ₽</span></div><div class="qty"><button type="button" data-d="-1">−</button><span>${cart[it.id]}</span><button type="button" data-d="1">+</button></div></div>`)
      .join('');
    updateSlide();
  };
  const updateSlide = () => {
    const sum = total(), poor = sum > money;
    el.shopTotal.innerHTML = sum ? `Итого <b>${sum} ₽</b> · останется ${money - sum} ₽` : `Баланс ${money} ₽ — выбери, что заказать`;
    el.shopTotal.classList.toggle('poor', poor);
    el.slide.classList.toggle('no', poor || !sum);
    el.slideText.textContent = !sum ? 'Корзина пуста' : poor ? 'Не хватает денег' : `Сдвинь → купить всё за ${sum} ₽`;
  };
  el.shopList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    cart[id] = Math.max(0, Math.min(9, cart[id] + Number(b.dataset.d)));
    renderShop();
  });
  // slide-to-buy: drag the knob to the other end
  el.slideKnob.style.backgroundImage = `url(${iconURL('cart', { bare: true })})`;
  let drag = null;
  const maxX = () => el.slide.clientWidth - el.slideKnob.offsetWidth - 10;
  const setKnob = (x, anim = false) => {
    el.slideKnob.style.transition = el.slideFill.style.transition = anim ? 'transform 0.25s, width 0.25s' : 'none';
    el.slideKnob.style.transform = `translateX(${x}px)`;
    el.slideFill.style.width = `${x + 30}px`;
  };
  el.slideKnob.addEventListener('pointerdown', (e) => {
    if (!total() || total() > money) return;
    drag = { x0: e.clientX };
    el.slideKnob.setPointerCapture(e.pointerId);
  });
  el.slideKnob.addEventListener('pointermove', (e) => drag && setKnob(Math.max(0, Math.min(maxX(), e.clientX - drag.x0))));
  el.slideKnob.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const x = e.clientX - drag.x0;
    drag = null;
    if (x >= maxX() * 0.9) {
      onBuy({ ...cart });
      for (const id in cart) cart[id] = 0;
      renderShop();
      el.slide.animate([{ background: 'rgba(127,212,138,0.6)' }, { background: '' }], 500);
    }
    setKnob(0, true);
  });
  renderShop();

  const tab = (which) => {
    el.tabCam.classList.toggle('on', which === 'cam');
    el.tabShop.classList.toggle('on', which === 'shop');
    el.cam.hidden = which !== 'cam';
    el.shop.hidden = which !== 'shop';
  };
  el.tabCam.addEventListener('click', () => tab('cam'));
  el.tabShop.addEventListener('click', () => tab('shop'));

  el.olegAva = $('oleg-ava');
  const paint = (node, m, self = false) => {
    const ava = self ? node : node.firstElementChild;
    ava.style.setProperty('--v', `${Math.max(0, Math.min(100, m.fun)).toFixed(0)}%`);
    ava.style.setProperty('--c', funColor(m.fun));
    node.classList.toggle('bad', m.bad);
    const url = avatar(m.id, m.face);
    const img = ava.firstElementChild;
    if (url && img.getAttribute('src') !== url) img.src = url;
  };

  return {
    el,
    reset() {
      cache = {};
    },
    // progress of a hands-on action, under the crosshair
    setUse(h) {
      const u = $('use');
      u.hidden = !h;
      if (!h) return;
      u.classList.toggle('top', !!h.top); // close-ups: keep the middle of the screen free
      set('useLabel', $('use-label'), esc(h.label));
      $('use-bar').parentElement.hidden = h.progress === null;
      $('use-bar').style.width = `${Math.round((h.progress ?? 0) * 100)}%`;
    },
    // the phone's camera rectangle in canvas pixels (for the scissored render), or null
    camRect() {
      if (el.phone.hidden || el.cam.hidden) return null;
      return el.camView.getBoundingClientRect();
    },
    update(game, { roomName, target, actions }) {
      const st = game.state;
      el.night.textContent = `НОЧЬ ${game.night}`;
      el.time.textContent = game.clock;
      el.room.textContent = roomName ?? '';
      // the courier: when he comes and with what, right under the clock
      const atDoor = game.visitor?.type === 'courier';
      const order = game.orders.find((o) => !o.done);
      el.courier.hidden = !atDoor && !order;
      el.courier.classList.toggle('here', atDoor);
      if (atDoor) el.courier.textContent = `🛵 Курьер у двери! Открой (${Math.ceil(game.visitor.left)} c)`;
      else if (order) el.courier.textContent = `🛵 Курьер через ${game.gameMinutes(order.eta)} мин: ${order.title}`;
      el.total.style.width = `${st.totalFun}%`;
      el.total.parentElement.classList.toggle('low', st.totalFun < 25);
      el.hut.style.width = `${st.hut}%`;
      el.hut.parentElement.classList.toggle('low', st.hut < 25);
      el.noise.style.width = `${game.noiseLevel * 100}%`;
      el.noise.parentElement.classList.toggle('hot', game.noiseLevel > 0.75);
      el.anger.textContent = st.anger ? `×${st.anger}` : '';
      el.energy.style.width = `${game.oleg.energy}%`;
      el.energy.parentElement.classList.toggle('low', game.oleg.energy < 20);
      el.ofun.style.width = `${game.oleg.fun}%`;
      el.ofun.parentElement.classList.toggle('low', game.oleg.fun < 25);
      el.othirst.hidden = game.oleg.thirst < TUNE.olegThirst.from; // Oleg wants a drink

      // who needs Oleg: face, a ring for his fun, and a "!" when something is wrong (what exactly — look at him)
      const mates = [
        ...game.friends.map((f) => ({ id: f.id, name: f.name, fun: f.fun, bad: !!f.problem, face: f.faceState() })),
        { id: 'cat', name: 'Кот', fun: game.cat.gone ? 0 : game.cat.fun, bad: !!(game.cat.gone || game.cat.problem), face: 'default' },
      ];
      if (el.people.childElementCount !== mates.length) {
        el.people.innerHTML = mates.map((m) => `<div class="mate" data-id="${m.id}"><div class="ava"><img alt=""><i class="badge">!</i></div><span class="name">${esc(m.name)}</span></div>`).join('');
      }
      mates.forEach((m, i) => paint(el.people.children[i], m));
      paint(el.olegAva, { id: 'oleg', fun: game.oleg.fun, bad: false, face: 'default' }, true);

      set('toasts', el.toasts, game.toasts.slice(-2).map((t) => `<div class="toast ${t.kind}">${t.room ? `<small>${esc(t.room)}</small>` : ''}${esc(t.text)}</div>`).join(''));

      if (game.talkLocked) {
        const k = game.talk;
        const left = Math.max(0, Math.ceil((k.dur ?? 6) * 0.5 - (st.t - k.start)));
        target = { name: `Слушаешь: ${k.friend.name}` , info: () => `уйти можно через ${left} с` };
        actions = [];
      }
      let p = '';
      if (target) {
        p += `<div class="what">${esc(target.name)}</div>`;
        const info = target.info?.();
        if (info) p += `<div class="info">${esc(info)}</div>`;
        for (const a of actions) p += `<div class="act"><kbd>${a.key}</kbd>${esc(a.text)}</div>`;
      }
      set('prompt', el.prompt, p);

      // a real (Qwen) icon if there is one, otherwise the emoji
      const pic = (it) => (hasRealIcon(it) ? iconImg(it, '') : `<span class="emo">${ITEMS[it].icon}</span>`);
      set('hotbar', el.hotbar, game.inv.slots
        .map((it, i) => `<div class="slot ${i === game.inv.sel ? 'sel' : ''}"><span class="k">${i + 1}</span>${it ? pic(it) : ''}</div>`)
        .join(''));
      el.handName.textContent = game.inv.selectedItem() ? ITEMS[game.inv.selectedItem()].name : '';

      el.doorAlert.hidden = !game.visitor || !el.phone.hidden;
      el.blackout.hidden = !(game.oleg.blackout > 0);

      if (!el.phone.hidden) {
        el.phoneTime.textContent = game.clock;
        set('money', el.phoneMoney, `${iconImg('money', '')}${st.money} ₽`);
        if (money !== st.money) {
          money = st.money;
          updateSlide();
        }
        el.camWho.textContent = game.visitor ? `Стучит: ${game.visitor.name}. Открой дверь в прихожей` : 'У двери никого';
        el.camWho.classList.toggle('busy', !!game.visitor);
        set('orders', el.orders, game.orders
          .map((o) => `<div class="order">${iconImg(o.icon ?? 'cart', '')}<div class="bar"><i style="width:${(100 * (1 - Math.max(0, o.eta) / o.total)).toFixed(0)}%"></i></div><span>~${game.gameMinutes(Math.max(0, o.eta))} мин</span></div>`)
          .join(''));
      }
    },
  };
}
