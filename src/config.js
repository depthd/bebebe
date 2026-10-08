// All balance numbers live here. Rates are per real second unless noted.
// Target: a night lasts ~3 minutes, Oleg runs around non-stop calming everyone down.
export const TUNE = {
  nightSeconds: 180, // 22:00 -> 06:00
  nights: 5,
  warmup: { calm: 6, ramp: 25, min: 0.35 }, // first seconds are calmer, then trouble ramps up over `ramp` seconds

  // Every night is its own setup.
  //   pace: how fast everything burns (boredom, thirst, hunger, bladder, Oleg's thirst, the grill, drinking)
  //   trouble: how often problems start (crying, hogging, falling asleep, fire...)
  //   money / table / fridge: what Oleg starts with; from night 1 the table runs dry by mid-night without the courier
  //   events: which party events can happen (toast, quarrel, fire)
  NIGHTS: [
    { pace: 0.95, trouble: 0.9, money: 3500, table: { beer: 6, vodka: 3, food: 2 }, fridge: { beer: 2, vodka: 1, food: 0, pelmeni: 1 }, events: ['toast'] },
    { pace: 1.2, trouble: 1.5, money: 3600, table: { beer: 6, vodka: 2, food: 2 }, fridge: { beer: 2, vodka: 1, food: 0, pelmeni: 1 }, events: ['toast', 'quarrel'] },
    { pace: 1.35, trouble: 2.0, money: 3800, table: { beer: 4, vodka: 3, food: 1 }, fridge: { beer: 2, vodka: 0, food: 0, pelmeni: 1 }, events: ['toast', 'quarrel', 'fire'] },
    { pace: 1.55, trouble: 2.6, money: 4000, table: { beer: 4, vodka: 2, food: 1 }, fridge: { beer: 1, vodka: 1, food: 0, pelmeni: 1 }, events: ['toast', 'quarrel', 'fire'] },
    { pace: 1.75, trouble: 3.2, money: 4200, table: { beer: 4, vodka: 2, food: 1 }, fridge: { beer: 1, vodka: 0, food: 0, pelmeni: 1 }, events: ['toast', 'quarrel', 'fire'] },
  ],

  start: {
    totalFun: 70,
    hut: 100,
    // money, fridge (bottles / ready food / raw packs) and table (servings / plates): per night, see NIGHTS
    friendFun: 75,
    catFun: 80,
  },

  totalFun: {
    follow: 0.08, // how fast total fun drifts toward the average of everyone's fun
    zeroDrain: 2.5, // per participant whose fun hit zero
  },

  fun: {
    boredom: 0.5, // everyone loses this much fun per second (x night pace)
    music: 0.7, // bonus in the living room while music plays
    olegBoredom: 0.6, // Oleg gets bored fast on his own: he has to party, not just clean up
    helpBonus: 8, // Oleg's fun for solving someone's problem
  },

  // Beer: pricier, gets you drunk slowly, the fun lasts (buzz). Vodka: cheap, drunk fast -> chaos sooner.
  drink: {
    beer: { fun: 10, drunk: 5, buzz: 0.5, buzzTime: 15, servings: 2 }, // one serving from the table
    vodka: { fun: 14, drunk: 16, servings: 5 },
    plate: { fun: 8, drunk: -8 },
    plateEvery: 9,
    noBooze: 1.0, // extra fun loss for drinkers at an empty table
    plates: 3, // one food item on the table
  },
  // handing a whole bottle / plate to someone (or drinking it yourself)
  give: {
    beer: { fun: 18, drunk: 8, buzzTime: 20 },
    vodka: { fun: 22, drunk: 30 },
    food: { fun: 12, drunk: -15 },
  },

  // Pelmeni: cheap, but cook them on the stove and take them off in time or they burn
  stove: { cookTime: 15, burnAfter: 10, burnHut: 5 },

  oleg: { drunkDecay: 0.8, blackoutAt: 95, blackoutSeconds: 4 },

  // Oleg's strength: every real action costs some, it comes back by itself; food and a drink give a boost
  energy: { max: 100, regen: 1.8, fromFood: 35, fromBeer: 12, fromVodka: 6 },
  // Oleg wants a drink too: thirst grows, and when it's high his fun melts; a drink (Q) quenches it
  olegThirst: { rate: 1.4, from: 45, drain: 2.6, beer: 55, vodka: 80 }, // rate x night pace
  cost: {
    takeBottle: 6, comfort: 6, lead: 8, fan: 6, wake: 10, pat: 8, shower: 14, repair: 14, mop: 10,
    cook: 12, drain: 6, petCat: 4, catRescue: 5,
  },
  // photos on Oleg's phone: catch a moment (someone puking, dancing, asleep...) — each kind once a night,
  // 3 shots a night, then "память заполнена"
  photo: { perNight: 3, fun: 8, friendFun: 6, range: 7, cone: 0.32 },

  // hands-on actions (hold the left mouse button): strength spent per second / per pat
  hands: { hoseLength: 4.6, sprayRange: 3.2, sprayCost: 5, soak: 0.28, scrubCost: 4, scrubRate: 0.0022, patCost: 3, pats: 5, shakeCost: 5, shakeRate: 0.004, wakeHold: 0.4 },
  // mini-games slow the world down instead of pausing it
  minigame: { timeScale: 0.35 },

  bladder: { base: 0.3, waitMax: 18, sip: 7 },

  // the guys get thirsty and hungry and go to the table by themselves; an empty table = a "!"
  // sipAt / eatAt: at the table he only takes a sip / a plate once he's this thirsty / hungry
  needs: { thirst: 1.0, hunger: 0.55, goAt: 55, wantAt: 90, sip: 35, plate: 45, give: 70, sipAt: 40, eatAt: 35 }, // x night pace

  // Oleg's PC: the upgrader site keeps a cut (edge), buys back skins for less (sell);
  // fun for the guy spinning (per second) and for the ones watching a win / a loss; КС duel
  pc: { edge: 0.9, sell: 0.85, playFun: 0.8, winFun: 10, loseFun: 3, csKills: 6, csWin: 15, csWatch: 10, watchFun: 0.7 },

  // partying with the guys: Oleg near friends (within near m, same room) gets withFriends fun per friend
  // per second and each of them hostBonus; away from everyone longer than missAfter s and they miss him
  // (missDrain each); a drink next to them = cheers (cheers fun for all); T = dance (dance s, needs music)
  vibe: { near: 3.5, withFriends: 0.35, hostBonus: 0.35, missAfter: 25, missDrain: 0.4, cheers: 6, cheersCd: 12, dance: 5, danceFun: 8, danceCost: 8 },

  // balance: each guy is an inverted pendulum. Gravity tips him (g), muscles pull back (kp, kd; weaker
  // drunk), drunk shoves (noise, x drunk^2); leaning past stepAt he catches himself with a step, past
  // fallAt he goes down. Pushes (Oleg, bumps, puddles) are kicks to this, not instant falls.
  balance: { g: 9.8, kp: 42, kd: 9, noise: 2.4, stepAt: 0.17, stepLen: 0.22, fallAt: 0.48 },

  // the physical guys (world/robot.js, `?phys=new`; tune live in lab.html). Joints are servos: `strength`
  // scales every joint's torque limit, `speed` how fast a joint chases its target (1/s). Walking is
  // stepping: a step every `stepTime` s, the foot put where the body is falling (`placeGain`: how far past
  // that point, to stop for sure), `walkSpeed` m/s. Drunk (x drunk 0..1): weaker joints (`weak`), steps late
  // (`late` s) and off target (`sloppy` m), the sense of up wanders (`wander` rad); `fallAt` = torso tilt
  // (rad) that counts as down, `lie` s on the floor before getting up, `retry` = chance the first try fails.
  // `assist`: the only help from outside, N·m that stand the upper body up while the feet press on the floor
  // (0 = none, he's on his own)
  robot: {
    strength: 1, speed: 14, stepTime: 0.36, stepHeight: 0.09, stepWidth: 0.1, placeGain: 0.05, walkSpeed: 1.0,
    crouch: 0.02, ankle: 2.5, assist: 80, weak: 0.45, late: 0.25, sloppy: 0.12, wander: 0.22, fallAt: 1.0, lie: [1.2, 2.4], retry: 0.6,
  },

  // drunk physics: bodies push each other apart; running into a drunk guy knocks him over (knockOver:
  // speed/5 x (0.35 + drunk) above it); two drunks (drunk sum > bumpDrunk) bumping may fall (bumpFall);
  // puddles are slippery (slip + drunk/200); a fall makes the others laugh (laugh fun each);
  // Oleg drunk above olegTripAt trips while running (olegTrip per second at 100%), slips on puddles (olegSlip)
  chaos: { radius: 0.24, bumpDrunk: 90, bumpFall: 0.35, knockOver: 0.5, slip: 0.45, laugh: 3, olegTripAt: 45, olegTrip: 0.3, olegSlip: 0.35 },

  // the flat lives on its own (living.js): TV fun per volume step for the guys in the living room, its noise;
  // extra noise per music volume step above 1; how often the guys mess with the TV / music / window
  living: { tvFun: 0.08, tvNoise: 0.8, musicLoud: 1.5, musicFun: 0.35, prankEvery: [22, 40] },

  // party events (which ones run on a night: NIGHTS[n].events)
  events: {
    every: [28, 45], // seconds between events (x night pace)
    toastWindow: 16, toastReach: 2.6, toastFun: 14, toastOlegFun: 12, toastMiss: 8,
    quarrelDrunk: 35, quarrelTime: 15, separate: 1.2, fightNoise: 20, fightFun: 15,
    fireNotBefore: 40, fireChance: 0.01, fireGrow: 0.03, fireHut: 1.2, fireNoise: 2, fireBurnout: 15, fireDisaster: 25,
    splashRadius: 1.4, splashPower: 0.55, fillTime: 2,
  },

  // "Коч!" chain: someone yells, others pick it up with a fading chance
  // balconyChance: the first one goes to yell it out of the balcony window (opens it, balconyNoise extra)
  koch: { balconyChance: 0.35, balconyNoise: 10, firstAfter: 25, every: [35, 60], chance: 0.85, decay: 0.8, max: 6, fun: 5, olegFun: 2, noise: 6 },

  // "Потрещать": he tells a recorded story; Oleg is stuck listening for `lock` of it (0.5 = first half)
  talk: { fun: 18, olegFun: 6, cooldown: 30, lock: 0.5 },

  hut: {
    puddle: 0.3, // per puddle per second
    broken: 0.1, // per broken thing per second
    smash: 8, // one-off when Lyokha breaks something
    repair: 5,
    clean: 3,
    peed: 6,
    music: 0.05,
    policeBreakIn: 35,
  },

  // Neighbours react to accumulated noise / smell / smoke (the "палево" meter), not to every single thing.
  // Knock -> open and calm them: the meter drops, but their anger stacks, so next time they come sooner.
  // Ignore them -> they call the police right away. Every police visit costs more.
  noise: {
    decay: 1.5,
    sources: {
      music: 3, // per second while the music plays
      cry: 2, // Alexey crying
      puke: 1, // Lyokha puking
      smell: 0.3, // per puddle
      smoke: 0.8, // grill burning on the balcony
      smash: 1.5, // Lyokha smashing (plus a one-off on every broken thing)
      cough: 0.5,
      cat: 1, // locked cat meowing
      openDoor: 5, // front door open while the party is loud
    },
    smashHit: 15,
    neighborAt: 60,
    angerStep: 12,
    calm: 40,
    cooldown: 20,
  },
  police: { bribe: 800, bribeGrowth: 0.5, angerLimit: 4 },
  visitors: { patience: 12, courierPatience: 15, knockEvery: 3 },

  delivery: { min: 15, max: 30 }, // seconds; not opening the door = courier leaves, money is gone

  // "Продукты 24" across the yard: per item, cheaper than the courier (a beer bottle = 2 servings)
  store: { beer: 90, vodka: 200, pelmeni: 120, chips: 60 },

  shop: [
    { id: 'beer', icon: 'beer', title: 'Пиво ×4', note: 'держит долго, пьянит медленно', price: 600, gives: { beer: 4 } },
    { id: 'vodka', icon: 'vodka', title: 'Водка 0,5', note: 'дёшево, пьянит быстро', price: 300, gives: { vodka: 1 } },
    { id: 'pizza', icon: 'pizza', title: 'Пицца', note: 'готовая, сразу на стол', price: 500, gives: { food: 1 } },
    { id: 'pelmeni', icon: 'pelmeni', title: 'Пельмени', note: 'дёшево, но варить и сливать самому', price: 180, gives: { pelmeni: 1 } },
    { id: 'pills', title: 'Таблетки от ЗПП', note: 'скоро', price: 600, gives: { pills: 1 }, soon: true },
  ],

  drinkEvery: { alexey: 4, lyokha: 5, temych: 7, kirill: 7 },
  drunkMult: { alexey: 0.7, lyokha: 1.6, temych: 1, kirill: 0.8 },

  grill: { decay: 3.5, lowAt: 25, shashlikEvery: 20, shashlikPlates: 2, smokeAfter: 4, draftChance: 0.02 },
  vape: { coughAfter: 10 },
  lyokha: { warnBefore: 15, wastedAt: 75, sober: 30, pukeEvery: 10, smashEvery: 6 },
  alexey: { hogChance: 0.06, hogDrainEvery: 1.5, cryChance: 0.03 },
  kirill: { sleepChance: 0.05 },

  cat: {
    boredom: 0.7,
    heldFun: 1.5, // calms down in Oleg's hands
    pet: 20, // quick but small
    toyPlay: 25, // seconds of play
    throwSpeed: 4.5, // m/s, LMB with the mouse in hand
    noticeRange: 9, // a mouse on the floor this close and he goes after it
    run: 2.6, // m/s chasing it
    toyFun: 2.5, // per second while playing
    balconyPull: 2.5, // how much more the cat wants the balcony when the door is open
    climbAfter: 10, // seconds on the balcony before it climbs the railing
    fallAfter: 8, // seconds on the railing before it falls
    fallPenalty: 40, // total fun lost when the cat falls
    lockedDrain: 4,
  },
};

// Birthday screen after night 5 — replace with your own words.
export const BIRTHDAY = {
  title: 'С ДНЁМ РОЖДЕНИЯ, ОЛЕГ!',
  lines: ['Ты пережил пять ночей на своей же хате.', 'Хата цела (почти). Кот жив. Мы тебя любим.', '— Алексей, Лёха, Кирилл, Темыч'],
};
