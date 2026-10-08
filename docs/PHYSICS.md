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

Lab numbers (fixed 1/30 s frames, like a weak laptop):

| | result |
|---|---|
| standing still | 0 falls, 0 steps, feet carry 100% |
| walking straight 6 s | 0 falls (4 guys) |
| walking round 90° corners | 0–1 falls per 4 guys × 12 s |
| shoved 0.6 m/s, random direction | about half catch it with stumbling steps |
| shoved 1.4–1.8 m/s | down almost always |
| turning on the spot | the turn works, then he tends to drift backwards and fall |

In the game with `?phys=new`: no teleports (none exist any more), nobody inside the furniture, real falls
and get-ups. **But sober guys still fall about 4 times a minute each while moving around the flat**, mostly on
direction changes and when bumping into each other or Oleg. That is why it stays behind the flag.

Cost: physics 2.1 ms per frame vs 1.6 ms for the old ragdolls (headless, 4 guys, 30 fps).

## Next

- Backward and turning recovery (the weakest part): steps backwards rarely catch the fall.
- Fewer falls when sober, then tune drunk to fall often again (the gameplay point).
- Guys steering around each other (they walk into each other now).
- Then: gameplay hooks (Oleg catching, pushing a guy into another), and switching the default.
