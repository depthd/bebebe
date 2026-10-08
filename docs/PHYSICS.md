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

## The plan

The new controller lives behind `?phys=new` until it is better than the old one in every way; the plain
URL keeps the old physics.

1. **The body is the truth.** No teleports: the logical position follows the pelvis. Full-height furniture
   colliders. Seats are reached from an approach point in front of them; sitting down and standing up
   blend over half a second instead of jumping.
2. **Legs carry the weight.** No external lift, pull or upright torque. Feet are separate bodies on ankles.
   Joint motors sized for the load. Everything the controller does is an action/reaction pair between body
   parts, so the only thing that holds him up or moves him is the floor under his feet.
3. **Stepping.** Foot placement from the capture point (where he has to step to stop): standing, a shove
   makes him step; walking is falling forward and catching it. Drunk = late, sloppy steps and a wandering
   sense of up, so stumbles and falls come by themselves.
4. **Getting up** is a struggle animation from the pose he lies in (the first try may fail), never a lift.
5. **Gameplay hooks**: shoving, guys bumping into each other, the lab page (`lab.html`, also `?lab`) to tune
   the feel with sliders.

Every step: before/after numbers from the measuring harness (teleports, penetration, falls, feet load,
physics ms) and a video.

## Status

- [ ] lab page + harness
- [ ] controller: standing on own legs
- [ ] controller: stepping and walking
- [ ] falls and getting up
- [ ] game integration behind `?phys=new`
- [ ] measurements, videos, report
