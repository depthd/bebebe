// What the walls and doors between Oleg and a sound do to it (audio.js plays it so). No raycasts: the flat's
// rooms (layout.js) and the places outside (outside.js) are nodes, the openings between them are links, each
// open or shut right now; the quietest way round is the way the sound comes. A shut door takes the top end
// off (the bass of the party still thumps through), every opening on the way a little more.
import { roomAt, FURNITURE, WALLS, CENTER } from './layout.js';
import { zoneAt } from './outside.js';

// a link: what a sound loses going through it, in dB and in octaves of top end (the lowpass comes down)
// (20 kHz down 2 octaves = 5 kHz: round a corner the hi-hat dulls; 4+ octaves: only the bass and the low chords).
// Along a way the dB add up, the octaves add as a root of squares: the most shut thing on the way muffles most.
const OPEN = { db: 3, oct: 2 };
const PASS = {
  doorway: () => OPEN,
  passage: () => ({ db: 2, oct: 1.2 }), // the wide opening from the living room to the hall
  door: (open) => (open ? OPEN : { db: 14, oct: 4.4 }), // an interior door: the bass gets through
  entrance: (open) => (open ? OPEN : { db: 20, oct: 5.2 }), // the padded front door
  glazing: (open) => (open ? { db: 3, oct: 1 } : { db: 12, oct: 3.8 }), // the balcony's single glass, its sash
  window: () => ({ db: 22, oct: 4.8 }), // the rooms' windows onto the yard: always shut
};
// [space, space, kind, what opens it (apt.doors id, or 'sash')]
const LINKS = [
  ['bedroom', 'living', 'doorway'],
  ['living', 'kitchen', 'doorway'],
  ['living', 'hall', 'passage'],
  ['hall', 'bath', 'door', 'bath'],
  ['hall', 'stairs', 'entrance', 'entrance'],
  ['living', 'balcony', 'door', 'balcony'],
  ['balcony', 'yard', 'glazing', 'sash'],
  ['bedroom', 'yard', 'window'],
  ['living', 'yard', 'window'],
  ['kitchen', 'yard', 'window'],
  ['stairs', 'yard', 'doorway'], // the entrance door downstairs stands open
  ['yard', 'shop', 'doorway'],
];
// the echo of a space: which one and how much is sent to it (audio.js makes the impulses; a normalized
// convolver gives back about -12 dB of what it gets, so 1.6 here is an echo about 8 dB under the sound itself)
export const ECHO = { bath: ['tile', 1.6], stairs: ['stairwell', 1.5], yard: ['open', 0.8], balcony: ['open', 0.3] };

// which space a point is in; y = floor height (the yard under the balcony is not the balcony)
export function spaceAt(x, z, y = 0) {
  const room = y > -2 ? roomAt(x, z) : null;
  if (room) return room.id === 'landing' ? 'stairs' : room.id;
  const zone = zoneAt(x, z);
  if (zone === 'Продукты 24') return 'shop';
  if (zone === 'Подъезд') return 'stairs';
  if (zone === 'Двор' || y < -2) return 'yard';
  return null; // in a wall or a doorway: the caller keeps the last one
}

// from the listener's space: the quietest way to every other space (Dijkstra over a dozen links), { db, oct }
// isOpen(id) -> is that door / the balcony sash open now
export function routes(from, isOpen) {
  const best = { [from]: { db: 0, oct: 0, sq: 0 } };
  const todo = [from];
  while (todo.length) {
    todo.sort((a, b) => best[b].db - best[a].db);
    const s = todo.pop();
    for (const [a, b, kind, id] of LINKS) {
      if (a !== s && b !== s) continue;
      const t = a === s ? b : a;
      const p = PASS[kind](id ? isOpen(id) : true);
      const db = best[s].db + p.db;
      if (best[t] && best[t].db <= db) continue;
      const sq = best[s].sq + p.oct * p.oct;
      best[t] = { db, oct: Math.sqrt(sq), sq };
      if (!todo.includes(t)) todo.push(t);
    }
  }
  return best;
}

// where the fixed sounds come from: the stereo in the stenka, the front door from inside and from the landing
const stenka = FURNITURE.find((f) => f.id === 'stenka');
const east = WALLS.find((w) => w.openings.some((o) => o.kind === 'entrance'));
const entr = east.openings.find((o) => o.kind === 'entrance');
const doorX = (east.x0 + east.x1) / 2, doorZ = (entr.at[0] + entr.at[1]) / 2, inside = Math.sign(CENTER.x - doorX);
export const PLACES = {
  stereo: [(stenka.x0 + stenka.x1) / 2, (stenka.z0 + stenka.z1) / 2, 0],
  doorIn: [doorX + inside * 0.6, doorZ, 0],
  doorOut: [doorX - inside * 0.6, doorZ, 0],
};
