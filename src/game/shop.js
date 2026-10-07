// "Продукты 24" across the yard: cheaper than the courier, but Oleg has to walk there himself and the
// party is left alone. Take things off the shelves (they go into your hands: 4 slots is the limit),
// pay at the till. The cashier won't let you out with unpaid stuff.
import { TUNE } from '../config.js';
import { STREET } from '../world/outside.js';
import { makePerson } from '../world/figures.js';

const GOODS = {
  beer: { item: 'beer', name: 'пиво' },
  vodka: { item: 'vodka', name: 'водку' },
  pelmeni: { item: 'pelmeni', name: 'пельмени' },
  chips: { item: 'food', portion: 0.5, name: 'сухарики' },
};

export class Shop {
  constructor(game, out) {
    this.game = game;
    this.out = out;
    this.unpaid = [];
    for (const s of out.shelves) {
      const g = GOODS[s.id];
      const target = {
        name: `Полка: ${s.label}`,
        info: () => `${this.price(s.id)} ₽ · плати на кассе`,
        actions: () => [{ key: 'E', text: `Взять ${g.name} (${this.price(s.id)} ₽)`, run: () => this.take(s.id) }],
      };
      s.mesh.userData.target = target;
      s.goods.traverse((o) => (o.userData.target = target));
    }
    this.cashier = makePerson({ name: 'Продавщица', shirt: '#b34a72', pants: '#3a3340', hair: '#7a3b1e', style: 'sprite' });
    this.cashier.root.position.set(out.cashier[0], STREET, out.cashier[1]);
    this.cashier.root.rotation.y = 0; // faces the door (towards the building, +z)
    this.cashier.root.traverse((o) => (o.userData.target = {
      name: 'Продавщица',
      info: () => (this.unpaid.length ? `К оплате: ${this.total()} ₽` : 'Бери с полок или проси бутылку с витрины за ней'),
      actions: () =>
        this.unpaid.length
          ? [{ key: 'E', text: `Оплатить ${this.total()} ₽`, run: () => this.pay() }]
          : [
              { key: 'E', text: `Пиво, пожалуйста (${this.price('beer')} ₽)`, run: () => this.buyNow('beer') },
              { key: 'R', text: `Водку (${this.price('vodka')} ₽)`, run: () => this.buyNow('vodka') },
            ],
    }));
    game.dynamic.add(this.cashier.root);
    this.nagT = 0;
  }

  price(id) {
    return TUNE.store[id];
  }

  total() {
    return this.unpaid.reduce((s, u) => s + u.price, 0);
  }

  reset() {
    this.unpaid = [];
    this.out.shopDoor.enabled = false;
  }

  take(id) {
    const g = GOODS[id];
    if (!this.game.inv.add(g.item, g.portion ?? 1)) return;
    this.unpaid.push({ item: g.item, price: this.price(id) });
    this.game.sfx.click();
  }

  // dropped (G) in the shop: back on the shelf
  putBack(item) {
    const i = this.unpaid.findIndex((u) => u.item === item);
    if (i < 0) return false;
    this.unpaid.splice(i, 1);
    return true;
  }

  // straight from the shelf behind her: paid on the spot
  buyNow(id) {
    const g = this.game, price = this.price(id);
    if (g.state.money < price) return g.toast(`Не хватает: нужно ${price} ₽`, 'bad');
    if (!g.inv.add(GOODS[id].item, 1)) return;
    g.state.money -= price;
    g.state.stats.spent += price;
    g.sfx.ding();
  }

  pay() {
    const g = this.game, sum = this.total();
    if (g.state.money < sum) return g.toast(`Не хватает: нужно ${sum} ₽`, 'bad');
    g.state.money -= sum;
    g.state.stats.spent += sum;
    this.unpaid = [];
    g.sfx.ding();
  }

  update(dt, olegPos) {
    const inShop = this.out.inShop(...olegPos);
    this.out.shopDoor.enabled = inShop && this.unpaid.length > 0;
    this.nagT -= dt;
    if (this.out.shopDoor.enabled && this.nagT <= 0) {
      // walking out without paying: she yells
      const [x, z] = olegPos, d = this.out.shopDoor;
      if (Math.hypot(x - (d.x0 + d.x1) / 2, z - (d.z0 + d.z1) / 2) < 1.3) {
        this.nagT = 4;
        this.game.toast(`Сначала оплати на кассе: ${this.total()} ₽`, 'warn');
      }
    }
    this.cashier.update(dt);
  }
}
