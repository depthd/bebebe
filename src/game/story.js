// The story around the nights (docs/CONCEPT.md, «Сюжет»): a title card before every night, a short scene after
// each won night (and one more before the fifth), the truth after the fifth, and the credits that never end.
// A scene takes the camera like the close-ups do and gives everything back when it ends: the light, the sky,
// whoever it hid, the props it brought. Any key or click moves the lines on, Esc skips the scene, M ends the credits.
// Nothing here may stop the game: a scene that throws or runs too long just ends, and the night goes on.
import * as THREE from 'three';
import { makePerson, makeBottle } from '../world/figures.js';
import { SPOTS, CAT_SPOTS } from '../world/layout.js';
import { particles } from '../world/particles.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SKIP = Symbol('skip'); // thrown into a scene that is being skipped
const FOV = 62; // a bit narrower than the game's 80: reads as a film
const smooth = (k) => k * k * (3 - 2 * k);
const sharp = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// the birthday is 30 September; four nights it is that day again, the fifth is the day after
export const dateOf = (night) => (night >= 5 ? { day: 1, month: 10, text: '1 октября', short: '01.10' } : { day: 30, month: 9, text: '30 сентября', short: '30.09' });

// the line under the date on each night's card (the fifth has only the date: the PC scene said the rest)
const INTRO = ['У Олега днюха. Пацаны уже едут.', 'Опять?..', 'Пацаны снова стучат.', 'Да сколько можно.', ''];

// ---------- times of day ----------
// sky dome (zenith, high, horizon, below it), the sun if it's up (a direction), the moonlight turned into
// whatever lights this hour, the sky light, how bright the lamps still are, and the building across the yard
const LOOKS = {
  // early grey morning, the lamps still on
  morning: { sky: ['#56657c', '#8794a5', '#b9b5ad', '#3a3a3c'], key: ['#aeb9ca', 0.5], hemi: ['#a6b2c4', '#2c2824', 0.6], lamps: 0.8, facade: { wall: '#5d626b', dark: '#2b3039', lit: 0.16, glint: 0 } },
  // dawn: a low warm sun to the right of the yard
  dawn: { sky: ['#6e95c6', '#b6c4d4', '#ffc28c', '#4a4038'], sun: [0.9, 0.17, -0.4], key: ['#ffb27a', 1.7], hemi: ['#ffd8b8', '#3a2c22', 0.8], lamps: 0.35, facade: { wall: '#a39486', dark: '#3c4250', lit: 0.05, glint: 0.2 } },
  // the next evening
  dusk: { sky: ['#1b1c3e', '#3f3a6c', '#c26e58', '#26201e'], key: ['#8f86c8', 0.3], hemi: ['#5c5c92', '#1a1418', 0.35], lamps: 0.55, facade: { wall: '#2b2d3a', dark: '#14161e', lit: 0.42, glint: 0 } },
};

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// painted for a sphere around the flat: u = the direction round, v = from the zenith down
function skyTexture({ sky: [top, high, horizon, below], sun }) {
  return canvasTexture(512, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, top);
    grad.addColorStop(0.28, high);
    grad.addColorStop(0.49, horizon);
    grad.addColorStop(0.515, below);
    grad.addColorStop(1, below);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    if (!sun) return;
    const x = (((Math.atan2(sun[2], -sun[0]) / (2 * Math.PI)) % 1) + 1) % 1 * w;
    const y = (h / 2) * (1 - Math.asin(sun[1]) / (Math.PI / 2));
    const glow = g.createRadialGradient(x, y, 0, x, y, 120);
    glow.addColorStop(0, 'rgba(255,246,226,1)');
    glow.addColorStop(0.07, 'rgba(255,228,176,0.95)');
    glow.addColorStop(0.3, 'rgba(255,176,112,0.45)');
    glow.addColorStop(1, 'rgba(255,150,100,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
  });
}

// the panel building across the yard at this hour (the night one is textures.cityFacade)
function facadeTexture({ wall, dark, lit, glint }) {
  return canvasTexture(1024, 512, (g, w, h) => {
    g.fillStyle = wall;
    g.fillRect(0, 0, w, h);
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cols = 20, rows = 10, cw = w / cols, rh = h / rows;
    g.fillStyle = 'rgba(0,0,0,0.14)'; // panel seams
    for (let j = 1; j < rows; j++) g.fillRect(0, j * rh - 1, w, 2);
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const r = rnd();
        g.fillStyle = r < lit ? `hsl(${35 + rnd() * 12},${70 + rnd() * 20}%,${55 + rnd() * 15}%)` : r < lit + glint ? '#ffd9ae' : dark;
        g.fillRect(i * cw + cw * 0.25, j * rh + rh * 0.3, cw * 0.5, rh * 0.45);
      }
  });
}

// ---------- props ----------

// somebody's glass, half full
function makeGlass() {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: '#e4eef0', transparent: true, opacity: 0.38, roughness: 0.08, side: THREE.DoubleSide, depthWrite: false });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.11, 16, 1, true).translate(0, 0.055, 0), glass));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 16).translate(0, 0.004, 0), glass));
  const drink = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.029, 0.05, 16).translate(0, 0.025, 0), new THREE.MeshStandardMaterial({ color: '#c47a26', transparent: true, opacity: 0.88, roughness: 0.2 }));
  drink.position.y = 0.008;
  g.add(drink);
  g.userData.drink = drink;
  return g;
}

// the man in the black suit: black on black, a white shirt and a tie, dark glasses; bat up unless calm
function makeSuit({ calm = false } = {}) {
  const fig = makePerson({ name: '', shirt: '#121316', pants: '#0d0e10', skin: '#d6ad8a', hair: '#0b0b0d', style: 'sprite', label: false });
  const shirt = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.075, 0.555), new THREE.Vector2(0.075, 0.555), new THREE.Vector2(0, 0.3)])),
    new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.8 }),
  );
  shirt.position.z = 0.107;
  const tie = new THREE.Mesh(new THREE.PlaneGeometry(0.032, 0.24).translate(0, 0.43, 0), new THREE.MeshStandardMaterial({ color: '#08080a', roughness: 0.5 }));
  tie.position.z = 0.109;
  fig.rig.spine.add(shirt, tie);
  // dark glasses over the drawn eyes (faces.js placeholder: eyes at 4..6 and 10..12 of 16, rows 6..8)
  const head = fig.rig.neck.children.find((o) => o.isSprite);
  const cv = head?.material.map?.image;
  if (cv?.getContext) {
    const g = cv.getContext('2d'), u = cv.width / 16, v = cv.height / 16;
    g.fillStyle = '#060607';
    g.beginPath();
    g.roundRect(u * 2.8, v * 5.2, u * 4.6, v * 3.3, u * 0.9);
    g.roundRect(u * 8.6, v * 5.2, u * 4.6, v * 3.3, u * 0.9);
    g.fill();
    g.fillRect(u * 7.2, v * 5.8, u * 1.6, v * 0.7);
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(u * 3.7, v * 5.9, u * 1.3, v * 0.5);
    g.fillRect(u * 9.5, v * 5.9, u * 1.3, v * 0.5);
    head.material.map.needsUpdate = true;
  }
  if (!calm) fig.setLoop('batRaise');
  return fig;
}

// the desktop on Oleg's monitor the next evening: the date, big
function drawDesktop(pc) {
  const g = pc.ctx, w = pc.canvas.width, h = pc.canvas.height;
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#24557f');
  bg.addColorStop(1, '#0d1f33');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.textAlign = 'center';
  // icons down the left
  ['КС', 'Апгрейдер', 'Корзина'].forEach((name, i) => {
    g.fillStyle = ['#e0a21b', '#7fd48a', '#9aa4b0'][i];
    g.fillRect(34, 30 + i * 120, 64, 64);
    g.fillStyle = '#fff';
    g.font = '20px "PT Sans", sans-serif';
    g.fillText(name, 66, 120 + i * 120);
  });
  g.fillStyle = '#fff';
  g.font = '700 150px "JetBrains Mono", monospace';
  g.fillText('19:47', w / 2, h * 0.43);
  g.font = '68px "Russo One", sans-serif';
  g.fillText('1 октября', w / 2, h * 0.6);
  // a reminder that came a day late
  g.fillStyle = 'rgba(12,16,24,0.85)';
  g.fillRect(w - 380, h - 190, 360, 110);
  g.fillStyle = '#f2b33d';
  g.font = '22px "Russo One", sans-serif';
  g.textAlign = 'left';
  g.fillText('Календарь', w - 360, h - 152);
  g.fillStyle = '#fff';
  g.font = '24px "PT Sans", sans-serif';
  g.fillText('Вчера: днюха Олега', w - 360, h - 112);
  // taskbar
  g.fillStyle = 'rgba(8,12,18,0.9)';
  g.fillRect(0, h - 56, w, 56);
  g.fillStyle = '#fff';
  g.textAlign = 'right';
  g.font = '22px "PT Sans", sans-serif';
  g.fillText('19:47', w - 18, h - 31);
  g.fillText('01.10', w - 18, h - 8);
  pc.tex.needsUpdate = true;
}

// ---------- the scenes ----------
// each gets `s` (the helpers below) and plays out with awaits; skipping throws out of the await it is in

// after night 1: the flat at six in the morning, everyone gone; drift through the mess to the bed
async function emptyFlat(s) {
  s.cut();
  s.look('morning');
  s.empty();
  s.mess();
  s.clock = '06:12';
  s.cam({ pos: [4.15, 1.58, 6.7], at: [5.6, 0.8, 3.4] });
  s.fade(0, 1.4);
  s.move({ pos: [5.3, 1.56, 5.95], at: [6.6, 0.9, 3.0] }, 5.5);
  await s.line('06:12. Пацаны разъехались.');
  s.sway(0.6);
  s.drunk(0.3, 2.5);
  s.move({ pos: [7.15, 1.5, 5.7], at: [9.8, 1.0, 4.0] }, 5);
  await s.line('В хате срач, в голове вертолёты.');
  s.move({ pos: [9.0, 1.42, 4.95], at: [10.45, 0.5, 2.1] }, 4);
  await s.line('Ладно. Спать.');
  s.move({ pos: [9.75, 0.95, 3.7], at: [10.45, 0.55, 1.9] }, 3.5);
  await s.fade(1, 2.4);
}

// after night 2: the same morning again; at the window, then the room, the cat on the sofa
async function dejaVu(s) {
  s.cut();
  s.look('morning');
  s.empty();
  s.mess();
  s.clock = '06:12';
  s.place(s.game.cat?.figure.root, CAT_SPOTS.catSofa, [4.9, 1.0]);
  s.game.cat?.figure.showName(false); // a new night makes a new cat: nothing to put back
  s.cam({ pos: [5.15, 1.62, 0.8], at: [5.3, 2.1, -8] });
  s.fade(0, 1.6);
  s.move({ pos: [5.2, 1.62, 0.62], at: [4.6, 2.0, -8] }, 5);
  await s.line('Странно. Будто это всё уже было.');
  s.move({ pos: [5.0, 1.6, 1.1], at: [7.0, 0.75, 3.1] }, 3);
  await s.line('Те же тосты, те же пацаны, тот же кот.', { sec: 3.6 });
  s.move({ pos: [5.05, 1.58, 1.25], at: [6.9, 0.65, 3.4] }, 3);
  await s.line('Не, бред. Спать.');
  await s.fade(1, 1.8);
}

// empty bottles on the floor in the morning: kind, x, z, which way it rolled
const MESS = [['beer', 4.85, 4.55, 0.4], ['beer', 6.35, 2.3, 2.1], ['vodka', 6.5, 4.45, -0.7], ['beer', 5.05, 2.45, 1.2], ['beer', 4.6, 5.6, 2.8]];

// where Oleg sits on the balcony at dawn, and where the glass stands on the rail
const SEAT = [5.4, 1.16, -1.2];
const RAIL = [6.3, 1.05, -1.62];

// after night 3: dawn on the balcony, somebody's glass on the rail; he drinks it and is gone
async function glass(s) {
  s.cut();
  s.look('dawn');
  s.empty();
  s.clock = '06:31';
  const cup = s.prop(makeGlass());
  cup.position.set(...RAIL);
  s.cam({ pos: SEAT, at: [5.6, 3.4, -14] });
  s.fade(0, 2);
  s.move({ pos: [5.42, 1.17, -1.22], at: [7.6, 3.1, -14] }, 6);
  await s.line('Рассвет. Сижу на балконе, кайфую.', { sec: 3.4 });
  s.move({ pos: [5.5, 1.18, -1.25], at: [RAIL[0], RAIL[1] + 0.02, RAIL[2]] }, 1.8);
  await s.line('О. Чей-то недопитый стакан.');
  s.move({ pos: [5.9, 1.2, -1.36], at: [RAIL[0], RAIL[1] + 0.02, RAIL[2]] }, 2.2);
  await s.line('Не пропадать же добру.');
  s.clear();
  await s.drink(cup);
  s.drunk(1, 2.2);
  s.sway(1.2);
  await s.wait(1.4);
  await s.fade(1, 1.8);
  await s.wait(0.6);
}

// after night 4: dawn on the balcony again, no glass; someone behind him
async function bat(s) {
  s.cut();
  s.look('dawn');
  s.empty();
  s.clock = '06:31';
  s.cam({ pos: SEAT, at: [5.2, 3.4, -14] });
  s.fade(0, 2);
  s.move({ pos: [5.42, 1.17, -1.22], at: [6.6, 3.1, -14] }, 6);
  await s.line('Опять рассвет. Опять балкон.', { sec: 3.2 });
  s.move({ pos: [5.5, 1.18, -1.25], at: [RAIL[0], RAIL[1] + 0.02, RAIL[2]] }, 1.8);
  await s.line('Стакана нет. Интересно.');
  s.clear();
  s.move({ pos: [5.45, 1.17, -1.22], at: [5.8, 2.8, -14] }, 2.4);
  const man = s.suit([6.4, -0.74], [SEAT[0], SEAT[2]]);
  s.door('balcony', true);
  await s.wait(1.2);
  s.sfx('creak');
  await s.wait(1.1);
  s.sfx('steps');
  await s.wait(1.1);
  s.sfx('whoosh');
  await s.move({ pos: [5.38, 1.12, -1.2], at: [man.position.x, 1.9, man.position.z] }, 0.32, { ease: sharp });
  await s.line('Ты кто бл—', { sec: 1.1 });
  s.sfx('bonk');
  s.cut();
  s.clear();
  await s.wait(1.8);
}

// before night 5: he never went to bed; the PC the next evening, the date on the screen, a knock
async function pcScene(s) {
  const pc = s.game.pc;
  s.cut();
  s.look('dusk');
  s.empty();
  s.clock = '19:47';
  drawDesktop(pc);
  s.after(() => pc.draw());
  const { pos, look } = pc.cam, n = pc.normal;
  const back = (d, up) => [pos.x + n.x * d, pos.y + up, pos.z + n.z * d];
  s.cam({ pos: back(0.75, 0.3), at: [look.x, look.y - 0.04, look.z] });
  s.fade(0, 1.6);
  s.move({ pos: back(0.5, 0.2), at: [look.x, look.y, look.z] }, 6);
  await s.line('Не спал весь день. Сидел за компом.');
  await s.line('Ничего не случилось.');
  s.move({ pos: back(0.12, 0.02), at: [look.x, look.y + 0.01, look.z] }, 3.5);
  await s.line('Число сменилось: 1 октября. Днюха была вчера.', { sec: 4 });
  s.clear();
  s.sfx('knock');
  await s.wait(1.1);
  s.sfx('knock');
  s.move({ pos: back(0.3, 0.12), at: [7.75, 1.35, 5.6] }, 1.2);
  await s.wait(0.6);
  await s.line('…Но пацаны всё равно пришли.');
  await s.fade(1, 1.2);
}

// who stands / sits where for the truth: two on the sofa, two standing at its ends, all facing Oleg
const CIRCLE = { alexey: { p: [6.95, 1.62] }, lyokha: { p: [6.95, 4.35] }, kirill: 'sofaA', temych: 'sofaB' };
const EYE = [4.35, 1.62, 3.0];

// after night 5 is won: dawn, the four of them, the confession; and someone on the balcony
async function truth(s) {
  await s.fade(1, 1); // the night's last frame goes dark first
  s.look('dawn');
  s.clock = '06:00';
  const center = [6.9, 1.3, 2.98];
  const guys = s.gather(CIRCLE, EYE, center);
  s.cam({ pos: EYE, at: center });
  s.fade(0, 1.6);
  s.move({ pos: [4.5, 1.62, 3.0], at: center }, 2.6);
  await s.wait(1.1);
  await s.line('Пацаны. Что за хуйня происходит?', { who: 'Олег' });
  await s.say(guys.alexey, 'Ну… короче, мы тебя наебали.', { face: 'happy', play: 'laugh' });
  await s.say(guys.lyokha, 'Хотели ещё разок набухаться, вот и всё.', { face: 'happy', play: 'talk' });
  s.turn(center);
  await s.line('Пять раз?', { who: 'Олег' });
  await s.say(guys.kirill, 'В смысле пять? Только сегодня.', { face: 'default', play: 'talk' });
  await s.say(guys.temych, '…', { sec: 2.2 });
  s.turn(center);
  await s.line('А что тогда было… в те разы?', { who: 'Олег', sec: 3.6 });
  s.clear();
  await s.wait(1.4);
  // silence; a slow push to the balcony window, and for a moment somebody stands out there
  const man = s.suit([5.55, -1.08], [5.0, 1.8], { calm: true });
  man.visible = false;
  s.move({ pos: [4.95, 1.6, 1.75], at: [5.55, 1.45, -1.1] }, 6, { ease: smooth });
  await s.wait(3.4); // the window is in the middle by now
  man.visible = true;
  await s.wait(1.5);
  man.visible = false;
  await s.wait(1.3);
  await s.fade(1, 2);
  await s.card('', 'Продолжение следует…', { sec: 3.2, big: true });
}

const SCENES = { after1: emptyFlat, after2: dejaVu, after3: glass, after4: bat, before5: pcScene, truth };

// ---------- credits ----------
const CAST = [
  ['Олег', 'именинник'],
  ['Алексей, Лёха, Кирилл, Темыч', 'пацаны (играли себя)'],
  ['Кот', 'кот'],
  ['Тип в чёрном костюме', '???'],
  ['Алексей Котлов', 'сын космического злодея'],
  ['Соседка снизу', 'стучала по батарее'],
  ['Участковый', 'взял своё'],
  ['Курьер', 'довёз не всё'],
  ['Claude', 'только пишет, рисует, тестирует'],
  ['Модели', 'Poly Haven (CC0)'],
];
const JOKES = [
  ['Пятая бутылка', 'в роли себя'], ['Шашлык', 'пережарен'], ['Сосед сверху', 'не участвовал, но слышал'], ['Тапок', 'каскадёр'],
  ['Изолента', 'держала всё'], ['Мангал', 'спецэффекты'], ['Пельмени', 'кейтеринг'], ['Люстра', 'свет'], ['Колонка', 'звук'],
  ['Ванна', 'гримёрка'], ['Унитаз', 'психологическая поддержка'], ['Диван', 'принял всех'], ['Торт', 'не дожил до титров'],
  ['Аниме на телефоне', 'культурная программа'], ['Вейп', 'дым-машина'], ['Мышка кота', 'пропала без вести'],
  ['Холодильник', 'держался до последнего'], ['Продавщица из «Продукты 24»', 'всё видела'], ['Бабушки у подъезда', 'пресс-служба'],
  ['Батарея', 'передавала сообщения соседке'], ['Ковёр', 'смотрел на всех'], ['Фикус', 'выжил'], ['Стенка', 'хранила хрусталь'],
  ['Похмелье', 'приехало без приглашения'], ['Недопитый стакан', 'улика'], ['Бита', 'реквизит'], ['Мама Олега', 'ничего не знает'],
  ['Огурец', 'закусь'], ['Шпроты', 'массовка'], ['Майонез', 'держал салат'], ['Микроволновка', 'грела всё по второму кругу'],
  ['Будильник', 'не прозвенел'], ['Тосты', 'одни и те же'], ['Тридцатое сентября', 'в роли себя (четыре раза)'], ['Кот', 'ещё раз кот'],
];
const HEADS = ['Также в ролях', 'Массовка', 'Каскадёры', 'Кейтеринг', 'Особая благодарность', 'Съёмочная группа', 'Без них ничего бы не было', 'Также в эпизодах', 'Звук и свет'];
const EXTRAS = ['Пьяный', 'Пустая бутылка', 'Пельмень', 'Окурок', 'Пластиковый стаканчик', 'Носок', 'Чебурек', 'Крышка от пива', 'Таракан', 'Шпротина', 'Салфетка', 'Табуретка', 'Тост', 'Икота', 'Сосед'];
const ROLES = ['массовка', 'каскадёр', 'дублёр', 'в роли себя', 'озвучка', 'второй план', 'на подхвате', 'реквизит', 'без слов', 'эпизод', 'спецэффекты', 'стоял рядом'];

// line after line, forever
function* creditLines() {
  yield { title: '5 ночей на хате у Олега' };
  yield { head: 'В ролях' };
  for (const c of CAST) yield { c };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let h = 0;
  for (let i = 0; i < JOKES.length; i++) {
    if (i % 9 === 0) yield { head: HEADS[h++ % HEADS.length] };
    yield { c: JOKES[i] };
  }
  for (let n = 1 + Math.floor(Math.random() * 20), i = 0; ; i++) {
    if (i % 12 === 0) yield { head: HEADS[h++ % HEADS.length] };
    n += 1 + Math.floor(Math.random() * 40);
    yield { c: [`${pick(EXTRAS)} №${n}`, pick(ROLES)] };
  }
}

// ---------- the runner ----------

export function createStory({ scene, camera, game, apt, sfx }) {
  const el = {
    root: $('story'), line: $('story-line'), card: $('story-card'), date: $('story-date'), text: $('story-text'),
    credits: $('credits'), roll: $('credits-roll'), note: $('credits-note'), skip: $('credits-skip'),
  };
  const out = { black: 0, drunk: 0, clock: null };
  const view = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, fov: FOV };
  let run = null;
  let cardT = null;

  // a promise the scene can wait on; skipping rejects it (marked handled: nobody has to wait on it)
  function hold(r, w) {
    const p = new Promise((res, rej) => Object.assign(w, { res, rej }));
    p.catch(() => {});
    r.waits.push(w);
    return p;
  }
  function release(r, w) {
    const i = r.waits.indexOf(w);
    if (i < 0) return;
    r.waits.splice(i, 1);
    w.res();
  }

  function start(kind, fn, id = kind) {
    if (run) finish(run);
    const r = { kind, id, t: 0, waits: [], tweens: {}, hooks: [], undo: [], figs: [], doors: new Set(), sway: 0, view: false, done: false };
    run = r;
    out.black = out.drunk = 0; // a scene says how it starts: a cut to black, or a fade from the game
    out.clock = null;
    r.promise = new Promise((res) => (r.resolve = res));
    Promise.resolve()
      .then(() => fn(helpers(r), r))
      .catch((e) => e !== SKIP && console.error(e))
      .finally(() => finish(r));
    return r.promise;
  }

  function finish(r) {
    if (r.done) return;
    r.done = true;
    for (const w of r.waits.splice(0)) w.rej(SKIP);
    for (const fn of r.undo.reverse()) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
    if (run === r) run = null;
    out.drunk = 0;
    r.resolve();
  }

  function setLine(text, who = null) {
    if (!text) {
      el.line.classList.remove('on');
      el.line.textContent = '';
      return;
    }
    el.line.innerHTML = (who ? `<em>${esc(who)}</em>` : '') + esc(text);
    el.line.classList.remove('on');
    void el.line.offsetWidth; // restart the fade-in
    el.line.classList.add('on');
  }

  function showCard(date, text, big) {
    clearTimeout(cardT);
    el.date.textContent = date;
    el.text.textContent = text;
    el.card.classList.toggle('big', big);
    el.card.classList.remove('out');
    el.card.hidden = false;
  }
  function hideCard() {
    if (el.card.hidden) return;
    el.card.classList.add('out'); // fades over whatever comes next
    clearTimeout(cardT);
    cardT = setTimeout(() => (el.card.hidden = true), 700);
  }

  const aim = (pos, at) => {
    const dx = at[0] - pos[0], dy = at[1] - pos[1], dz = at[2] - pos[2];
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  };

  function tween(r, channel, dur, apply, ease = smooth) {
    const old = r.tweens[channel];
    if (old) release(r, old.wait);
    const w = {};
    r.tweens[channel] = { t: 0, dur: Math.max(1e-3, dur), apply, ease, wait: w };
    return hold(r, w);
  }

  function helpers(r) {
    const s = {
      game,
      set clock(v) {
        out.clock = v;
      },
      // the camera: jump to a shot, or glide there ({ pos, at } in world coordinates)
      cam(shot) {
        if (!r.view) {
          r.view = true;
          const fov = camera.fov;
          r.undo.push(() => {
            camera.fov = fov;
            camera.updateProjectionMatrix();
          });
          el.root.hidden = false;
          el.root.classList.add('on');
          r.undo.push(() => {
            el.root.classList.remove('on');
            el.root.hidden = true;
            setLine(null);
          });
        }
        view.pos.set(...shot.pos);
        Object.assign(view, aim(shot.pos, shot.at), { fov: shot.fov ?? FOV });
      },
      move(shot, sec, { ease = smooth } = {}) {
        const from = { pos: view.pos.clone(), yaw: view.yaw, pitch: view.pitch, fov: view.fov };
        const to = aim(shot.pos, shot.at), toPos = new THREE.Vector3(...shot.pos), fov = shot.fov ?? view.fov;
        const dyaw = wrap(to.yaw - from.yaw);
        return tween(r, 'view', sec, (e) => {
          view.pos.lerpVectors(from.pos, toPos, e);
          view.yaw = from.yaw + dyaw * e;
          view.pitch = from.pitch + (to.pitch - from.pitch) * e;
          view.fov = from.fov + (fov - from.fov) * e;
        }, ease);
      },
      // look somewhere else from where the camera is
      turn(at, sec = 0.9) {
        return s.move({ pos: view.pos.toArray(), at }, sec);
      },
      fade(to, sec) {
        const from = out.black;
        return tween(r, 'black', sec, (e) => (out.black = from + (to - from) * e));
      },
      cut() {
        delete r.tweens.black;
        out.black = 1;
      },
      drunk(to, sec) {
        const from = out.drunk;
        return tween(r, 'drunk', sec, (e) => (out.drunk = from + (to - from) * e));
      },
      sway(a) {
        r.sway = a;
      },
      wait(sec) {
        return hold(r, { until: r.t + sec });
      },
      // a subtitle; a key or a click moves on early
      line(text, { who = null, sec = Math.min(4.6, Math.max(2.3, 1.1 + text.length * 0.065)) } = {}) {
        setLine(text, who);
        return hold(r, { until: r.t + sec, line: true });
      },
      clear() {
        setLine(null);
      },
      // a black card with a date and a line
      async card(date, text, { sec = 2.8, big = false } = {}) {
        showCard(date, text, big);
        r.undo.push(hideCard);
        await hold(r, { until: r.t + sec, line: true });
        hideCard();
      },
      sfx(name) {
        try {
          sfx?.[name]?.();
        } catch {
          /* no sound is fine */
        }
      },
      every(fn) {
        r.hooks.push(fn);
      },
      after(fn) {
        r.undo.push(fn);
      },
      // a thing for this scene only (materials marked userData.shared stay, like everywhere)
      prop(obj) {
        scene.add(obj);
        r.undo.push(() => {
          scene.remove(obj);
          obj.traverse((o) => {
            if (!o.isMesh) return;
            o.geometry.dispose();
            for (const m of [o.material].flat()) if (!m.userData.shared) m.dispose();
          });
        });
        return obj;
      },
      // the morning after: empties on the floor round the table
      mess() {
        for (const [kind, x, z, a] of MESS) {
          const b = makeBottle(kind);
          b.traverse((o) => o.material && (o.material.userData.shared = true)); // goods.js shares them
          b.rotation.set(0, a, Math.PI / 2);
          b.position.set(x, 0.035, z);
          s.prop(b);
        }
      },
      // the man in the black suit at (x, z), facing a point
      suit([x, z], [tx, tz], opts) {
        const fig = makeSuit(opts);
        fig.root.position.set(x, 0, z);
        fig.root.rotation.y = Math.atan2(tx - x, tz - z);
        scene.add(fig.root);
        r.figs.push(fig);
        r.undo.push(() => {
          scene.remove(fig.root);
          fig.dispose();
        });
        return fig.root;
      },
      // move something for the scene (the cat), put back after
      place(obj, spot, [lx, lz]) {
        if (!obj) return;
        const p = obj.position.clone(), rot = obj.rotation.clone(), vis = obj.visible;
        r.undo.push(() => {
          obj.position.copy(p);
          obj.rotation.copy(rot);
          obj.visible = vis;
        });
        obj.position.set(spot.p[0], spot.y ?? 0, spot.p[1]);
        obj.rotation.set(0, Math.atan2(lx - spot.p[0], lz - spot.p[1]), 0);
        obj.visible = true;
      },
      door(id, open) {
        const d = apt.doors[id];
        if (!d) return;
        const was = d.open;
        d.setOpen(open);
        r.doors.add(d);
        r.undo.push(() => {
          d.setOpen(was);
          d.update(10); // snap
        });
      },
      // a light of another hour: sky, sun, the building across, lamps and their glow (all put back after)
      look(name) {
        const L = LOOKS[name], n = apt.night;
        if (!L || !n) return;
        const keep = {
          bg: scene.background, map: n.facade.material.map,
          moon: [n.moon.color.clone(), n.moon.intensity, n.moon.position.clone()],
          hemi: [n.hemi.color.clone(), n.hemi.groundColor.clone(), n.hemi.intensity],
          lamps: apt.lights.map((l) => l.intensity),
          halos: [],
        };
        const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), new THREE.MeshBasicMaterial({ map: skyTexture(L), side: THREE.BackSide, depthWrite: false }));
        scene.add(sky);
        const facade = facadeTexture(L.facade);
        n.facade.material.map = facade;
        n.facade.material.needsUpdate = true;
        n.moon.color.set(L.key[0]);
        n.moon.intensity = L.key[1];
        if (L.sun) n.moon.position.copy(n.moon.target.position).addScaledVector(new THREE.Vector3(...L.sun).normalize(), 20);
        n.hemi.color.set(L.hemi[0]);
        n.hemi.groundColor.set(L.hemi[1]);
        n.hemi.intensity = L.hemi[2];
        apt.lights.forEach((l) => (l.intensity *= L.lamps));
        apt.group.traverse((o) => {
          if (!o.isSprite || o.material.blending !== THREE.AdditiveBlending) return;
          keep.halos.push([o, o.material.opacity]);
          o.material.opacity *= L.lamps;
        });
        r.undo.push(() => {
          scene.remove(sky);
          sky.geometry.dispose();
          sky.material.map.dispose();
          sky.material.dispose();
          scene.background = keep.bg;
          n.facade.material.map = keep.map;
          n.facade.material.needsUpdate = true;
          facade.dispose();
          n.moon.color.copy(keep.moon[0]);
          n.moon.intensity = keep.moon[1];
          n.moon.position.copy(keep.moon[2]);
          n.hemi.color.copy(keep.hemi[0]);
          n.hemi.groundColor.copy(keep.hemi[1]);
          n.hemi.intensity = keep.hemi[2];
          apt.lights.forEach((l, i) => (l.intensity = keep.lamps[i]));
          for (const [o, a] of keep.halos) o.material.opacity = a;
        });
      },
      // nobody home: the guys and whoever was at the door hidden, the drops in the air gone
      empty() {
        const figs = [...game.friends.map((f) => f.figure), game.visitor?.figure, ...(game.leaving ?? []).map((l) => l.figure)];
        for (const fig of figs) {
          if (!fig) continue;
          const root = fig.root, was = root.visible;
          root.visible = false;
          r.undo.push(() => (root.visible = was));
        }
        particles.clear();
      },
      // the four of them at their places (CIRCLE), facing Oleg; whatever they were doing is dropped
      gather(places, eye, center) {
        r.center = center;
        const guys = {};
        for (const f of game.friends) {
          const spot = typeof places[f.id] === 'string' ? SPOTS[places[f.id]] : places[f.id];
          if (!spot) continue;
          guys[f.id] = f;
          const fig = f.figure;
          if (f.rag?.active) {
            f.rag.restore?.();
            f.rag.disable?.();
          }
          fig.root.visible = true;
          fig.setFall?.(0);
          fig.setLean?.(0, 0);
          fig.setTint?.('#ffffff');
          fig.setStatus?.(null);
          fig.showName?.(false);
          fig.setLoop(null);
          fig.setFace?.('default');
          fig.setPose(spot.pose ?? 'stand', spot.y ?? 0);
          fig.root.position.set(spot.p[0], 0, spot.p[1]);
          const [lx, lz] = spot.pose ? spot.look : [eye[0], eye[2]];
          fig.root.rotation.set(0, Math.atan2(lx - spot.p[0], lz - spot.p[1]), 0);
          r.figs.push(fig);
        }
        for (const v of [game.visitor, ...(game.leaving ?? [])]) if (v?.figure) v.figure.root.visible = false;
        particles.clear();
        return guys;
      },
      // a friend says his line: a bubble over him, the subtitle with his name, the camera leans to him
      async say(f, text, { face = null, play = null, sec } = {}) {
        if (!f) return s.line(text, { sec });
        const fig = f.figure, p = fig.root.position, head = fig.pose === 'sit' ? 1.3 : 1.7;
        const c = r.center ?? [p.x, head, p.z];
        s.turn([c[0] + (p.x - c[0]) * 0.45, c[1] + (head - c[1]) * 0.45, c[2] + (p.z - c[2]) * 0.45]);
        if (face) fig.setFace?.(face);
        if (play) fig.play(play);
        const dur = sec ?? Math.min(4.6, Math.max(2.3, 1.1 + text.length * 0.065));
        fig.say(text, dur + 0.4);
        await s.line(text, { who: f.name, sec: dur });
      },
      // drinking the glass: it comes up to his face, the head goes back, two gulps
      drink(cup) {
        const from = cup.position.clone(), hand = new THREE.Vector3(), q = new THREE.Quaternion(), tilt = new THREE.Quaternion();
        const x = new THREE.Vector3(1, 0, 0), drink = cup.userData.drink;
        let t = 0;
        const w = {};
        const done = hold(r, w);
        s.every((dt) => {
          if (t > 2.6) return;
          t += dt;
          hand.set(0, -0.07 + 0.03 * smooth(Math.min(1, Math.max(0, (t - 0.7) / 0.8))), -0.24);
          camera.localToWorld(hand);
          const k = smooth(Math.min(1, t / 0.7));
          cup.position.lerpVectors(from, hand, k);
          const a = 0.25 * k + 1.5 * smooth(Math.min(1, Math.max(0, (t - 0.7) / 1.3)));
          cup.quaternion.copy(q.identity()).slerp(camera.quaternion, k).multiply(tilt.setFromAxisAngle(x, a));
          drink.scale.y = Math.max(0.04, 1 - smooth(Math.min(1, Math.max(0, (t - 1.0) / 1.2))));
          if (t >= 2.4 && cup.visible) {
            cup.visible = false;
            release(r, w);
          }
        });
        const skipped = () => {}; // a skipped scene drops these quietly
        s.wait(0.7).then(() => {
          s.sfx('whoosh');
          s.move({ pos: view.pos.toArray(), at: [view.pos.x - Math.sin(view.yaw) * 2, view.pos.y + 2.2, view.pos.z - Math.cos(view.yaw) * 2] }, 1.3);
        }, skipped);
        s.wait(1.15).then(() => s.sfx('gulp'), skipped);
        s.wait(1.75).then(() => s.sfx('gulp'), skipped);
        return done;
      },
    };
    return s;
  }

  // the camera from the scene's view, with breathing and (drunk) sway on top
  function applyView(r) {
    const T = r.t, w = r.sway;
    camera.position.copy(view.pos);
    camera.position.x += Math.sin(T * 0.9) * 0.05 * w;
    camera.position.y += Math.sin(T * 1.3) * 0.03 * w;
    camera.rotation.set(
      view.pitch + Math.sin(T * 1.6) * 0.004 + Math.sin(T * 1.1) * 0.05 * w,
      view.yaw + Math.sin(T * 0.6) * 0.07 * w,
      Math.sin(T * 0.8) * 0.09 * w,
    );
    if (camera.fov !== view.fov) {
      camera.fov = view.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  function tick(r, dt) {
    r.t += dt;
    for (const [ch, tw] of Object.entries(r.tweens)) {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.apply(tw.ease(k));
      if (k >= 1) {
        delete r.tweens[ch];
        release(r, tw.wait);
      }
    }
    for (const w of [...r.waits]) if (w.until !== undefined && r.t >= w.until) release(r, w);
    if (r.view) applyView(r);
    for (const h of r.hooks) h(dt, r.t);
    for (const f of r.figs) f.update(dt, {});
    for (const d of r.doors) d.update(dt);
    if (r.roll) roll(r, dt);
  }

  // ---------- credits: up the screen forever ----------
  function credits() {
    return start('credits', async (s, r) => {
      el.roll.innerHTML = '';
      el.note.hidden = true;
      el.credits.hidden = false;
      r.undo.push(() => {
        el.credits.hidden = true;
        el.roll.innerHTML = '';
      });
      r.roll = { y: innerHeight * 0.85, lines: creditLines(), v: 46 };
      r.endW = {};
      await hold(r, r.endW);
      await s.wait(1.6); // «Моё недовольство учтено.» stays a moment
    });
  }
  function addLine(r) {
    const { value: l } = r.roll.lines.next();
    const p = document.createElement(l.c ? 'p' : 'h2');
    if (l.title) {
      p.className = 'title';
      p.textContent = l.title;
    } else if (l.head) p.textContent = l.head;
    else p.innerHTML = `<b>${esc(l.c[0])}</b><i>—</i><span>${esc(l.c[1])}</span>`;
    el.roll.appendChild(p);
  }
  function roll(r, dt) {
    const R = r.roll;
    R.y -= R.v * dt;
    while (el.roll.childElementCount < 400 && R.y + el.roll.offsetHeight < innerHeight + 200) addLine(r);
    // lines gone over the top leave; the rest stays where it was
    for (let first = el.roll.firstElementChild; first && R.y + first.offsetHeight < -40; first = el.roll.firstElementChild) {
      R.y += first.offsetHeight;
      first.remove();
    }
    el.roll.style.transform = `translateY(${R.y.toFixed(1)}px)`;
  }
  // M: the displeasure is noted, then the credits go
  function creditsSkip(r) {
    if (r.skipping) return;
    r.skipping = true;
    el.note.hidden = false;
    release(r, r.endW);
  }

  el.skip?.addEventListener('click', () => run?.kind === 'credits' && creditsSkip(run));

  return {
    get active() {
      return !!run;
    },
    get black() {
      return out.black;
    },
    get drunk() {
      return out.drunk;
    },
    get clock() {
      return run?.kind === 'scene' ? out.clock : null;
    },
    has: (id) => !!SCENES[id],
    // a card or a scene the night comes after (not the truth: the credits and the end card want the mouse free)
    get leadsToPlay() {
      return !!run && (run.kind === 'card' || (run.kind === 'scene' && run.id !== 'truth'));
    },
    // a scene by id (after1..after4, before5, truth); resolves when it's over, however it ended
    scene(id) {
      const fn = SCENES[id];
      if (!fn) return Promise.resolve();
      return start('scene', fn, id);
    },
    // the card before night n
    card(n) {
      return start('card', async (s) => {
        out.black = 1;
        await s.card(dateOf(n).text, INTRO[n - 1] ?? '');
      });
    },
    credits,
    // 'next' (any key, a click), 'skip' (Esc), 'm'
    input(kind) {
      const r = run;
      if (!r) return;
      if (r.kind === 'credits') {
        if (kind === 'm' || kind === 'skip') creditsSkip(r);
        return;
      }
      if (kind === 'skip') return finish(r);
      const w = r.waits.find((x) => x.line);
      if (w) release(r, w);
    },
    update(dt) {
      const r = run;
      if (!r) return;
      try {
        if (r.kind !== 'credits' && r.t > 90) throw new Error(`story: the ${r.kind} ran too long`);
        tick(r, dt);
      } catch (e) {
        console.error(e);
        finish(r);
      }
    },
  };
}
