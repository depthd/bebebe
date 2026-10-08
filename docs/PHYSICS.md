# Physics of the guys: the rework

What the guys should feel like: crooked robots learning to walk. Their own legs hold them up, they
stumble, catch themselves with a step, and really go down when shoved or drunk. Physics is gameplay,
not decoration.

## What was wrong (measured in headless Chromium, before the rework)

- An invisible force on the pelvis held 84–98% of a standing guy's weight; the feet carried almost nothing.
  With all joint motors off he still stood.
- Walking: both feet in the air 36–57% of the time, the touching foot sliding at ~1.5 m/s. A pull on every
  body part dragged him along to the logical point, 0.9–1.3 m behind it.
- 15 shoves, including Oleg running into a drunk one: no falls.
- Teleports by design: the body reset to the logical point when it lagged more than 1.6 m (drunk walkers:
  about one per guy every 3 s), plus 0.6–1.6 m jumps on every sit/stand switch.
- Furniture colliders were 0.8 m tall (the wardrobe is 2.5 m): heads and shoulders went through. Seat spots
  are inside the furniture, so a guy standing up was created inside the sofa and thrown out at 15 m/s.

## The new bodies (`src/world/robot.js`, `?phys=new`)

- 13 boxes: pelvis, torso, head, thighs, shins, **feet on ankles**, upper and lower arms.
- Every joint is a **servo**: a rate motor that turns the joint towards its target as fast as `speed`
  allows, up to a torque limit (his strength). Solved by the physics solver itself, so stiff joints don't
  explode the way the old hand-made spring torques did.
- **Nothing pulls or lifts him.** Every controller push is between two of his own parts; the floor under his
  feet is what holds him up and moves him. Feet carry 100% of the weight standing.
- **Standing**: the hips keep the pelvis level, the knees hold the height, and the ankles roll the body over
  the feet. Gravity is compensated, and an ankle never pushes harder than its foot can before rocking onto its
  heel, toe or edge (the toe gives more room than the heel).
- **Stepping**: when the capture point (where his falling body would stop if a foot were put there) leaves
  the feet, a foot goes to where that point will be when it lands. The loaded foot can't lift, so the other
  one goes, crossing over if it has to (that's a stumble). **Walking is the same on purpose**, the foot
  landing a bit short of the capture point so the body rolls on. A sharp turn is walked as an arc.
- **Drunk**: weaker and slower joints, late steps (he reacts to where his body was), sloppy foot placement,
  a sense of up that wanders off (he leans, then has to catch it).
- **Falling** is real (the torso past ~57°); on the floor the joints go slack. **Getting up** is played from
  the pose he lies in (face down: push up, kneel, a foot forward, up; face up: sit up, tuck, squat, up); the
  first try may sag back down. No lift, no snap.
- One helping hand, documented as such: `TUNE.robot.assist`, a capped torque (80 N·m) that stands the upper
  body up, only while his feet press on the floor, fading when drunk. It holds no weight and can't save a guy
  whose feet aren't under him.

In the game (`friends.js`), the body is the truth: the logical position follows the pelvis, the path only
tells the body where to walk (`steer`); a body that gets stuck tries the next path point and finally counts as
arrived. Seats and beds are reached at a free `approach` point next to them, and sitting down / standing up
slides the figure over half a second (`startBlend`). Furniture colliders are as tall as the furniture is
drawn (both physics modes).

Tuning: `lab.html` (also `?lab`): the four guys on an empty floor, sliders over `TUNE.robot`, shoves, click to
walk, Oleg on WASD. Measuring: `npm run robot` (see CLAUDE.md).

## Status (night of 8–9 Oct)

Lab numbers (fixed 1/30 s frames, like a weak laptop; `npm run robot`):

| | result |
|---|---|
| standing still | 0 falls, 0 steps, feet carry 100% |
| walking straight, zigzag, round 90° corners | 0 falls (4 guys each) |
| shoved 0.6 m/s in each of 4 directions | 0 falls, 2–4 stumbling steps |
| shoved backwards 0.6–1.8 m/s (one guy each) | 1 of 4 goes down (was 4 of 4) |
| random shoves 0.6–1.8 m/s, 16 per guy | 8 of 58 go down (was 18 of 43) |
| walking speed | about 0.4 m/s asked 1.0: a shuffle |

In the game with `?phys=new` (start of night 1, sober, 3 seeded runs × 90 s, 4 guys): **5 falls**, down from 39
at the start of the night and 13 before the last fix. No teleports (none exist any more), nobody inside the
furniture, real falls and get-ups. What's left: bumping into a wall or each other while turning, and a guy
who is already a bit drunk.

What made the difference, in order:

1. Quicker steps (0.26 s) and arms that pass through furniture (a gesture over the table no longer shoves
   him off his feet).
2. A catching foot gets over its spot first and then comes down; it used to land 0.1 m short of where it
   was going, every time.
3. A step back goes 6 cm further (he stands on the middle of the foot, not on the heel he can't push with).
4. In double support the ankles no longer fight gravity along the line between the feet: a staggered stance
   holds that by itself, and fighting it rolled him off a good stance after every step back. Together, 2–4
   ended the endless backward shuffle that was most of the "falls out of nowhere".
5. Standing spots next to furniture keep 0.5 m clear, so a step forward doesn't put a knee into the table.

Cost: physics 1.8–2.5 ms per frame vs 1.6 ms for the old ragdolls (headless, 4 guys, 30 fps).

## Next

- Walking is slow (a robot shuffle). `stride` > 1 lands walking steps further back and speeds him up: 1.5 is
  about +25% in the lab, but in the game it doubles the falls (10 vs 5), and 2.2 overshoots its goal. Kept at 1.
- Drunk still falls often, as it should: half drunk, each guy goes down twice in 26 s of walking about; fully
  drunk, twice in 18 s.
- Guys turning next to walls and each other.
- Then: gameplay hooks (Oleg catching, pushing a guy into another), and switching the default.
