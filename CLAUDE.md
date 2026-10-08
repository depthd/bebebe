# 5 ночей на хате у Олега

Browser 3D game (three.js + Vite, vanilla JS), a birthday gift. FNAF × Who's Your Daddy set in a real 2-room khrushchevka. Game design lives in `docs/CONCEPT.md`; keep it in sync when mechanics change. All player-facing text is Russian.

## Commands

- `npm install`, then `npm run dev` (http://localhost:5173)
- `npm run build` builds to `dist/`, which works from any subfolder (`base: './'`)
- `npm run plan` regenerates `docs/plan.svg` from the layout data
- Pushes to the default branch build and deploy to GitHub Pages (`.github/workflows/pages.yml`)
- `npm run shots -- <name>` saves eye-level screenshots of 14 fixed views (every room, landing, yard, shop) to `shots/<name>/`, plus 2x2 contact sheets. Run it before and after any visual change and compare the sheets; a top-down look does not count as seeing the result.

## Map of the code

- `src/world/layout.js` is the single source of truth for geometry: rooms, walls, openings, diagonal bath wall, furniture footprints, nav graph, friend and cat spots, toy hiding places, door camera.
  - Everything is authored in **plan coordinates** (as on the BTI drawing), then stretched by `SCALE` (the real size felt cramped in first person) and mirrored on export (`MIRROR = true`). Never hand-mirror or hand-scale numbers.
  - Furniture keeps its real size: whatever touches a wall on the drawing stays against it after scaling (`fitFurniture`). Spots with `on: '<furnitureId>'` move with that furniture.
  - +X is right on the drawing, +Z is down (away from the windows), meters.
- `src/world/outside.js` is outside the flat (he lives on the 2nd floor): stairs down from the landing, lobby, the yard, the "Продукты 24" kiosk; `heightAt(x, z)` gives the floor height (the player follows it), `zoneName()` the place name. `src/game/shop.js`: shelves, the till, the cashier. `src/game/living.js`: TV channels, music/TV volume, the balcony sash, the guys' pranks. `src/game/pc.js`: Oleg's PC (upgrader, КС duel).
- `src/world/apartment.js` builds walls with openings, wallpaper linings (only where a wall face exists), floors, windows, and the hinged doors (`doors.balcony/bath/entrance`).
- `src/world/furniture.js`: each item is built in a local frame (u along the wall, v from the wall to the front, y up). Colliders come from layout footprints.
- `docs/FACES.md` is the face-picture plan: an action shot per state (head + hands + props, like Kirill drinking), optional second frame for a 2-frame loop (`<who>_<action>[_2].png`), Qwen prompt, priorities.
- `src/world/faces.js` maps each guy to a face photo in `src/assets/faces/` (with a crop) or draws a placeholder face. Voices: `src/assets/voice/<who>_<kind>_<N>.mp3` (kinds: monolog = the talk action, koch = chain shout, booze, quote, vapeloop; who = event for non-attributed) are picked up automatically and played by `audio.voices.play(key, { pos })` with distance falloff; `Friend.voice(kind)` follows the friend.
- `src/world/skins.js` puts clothes from an unfolded skin sheet (`src/assets/skins/`, Minecraft/Roblox-style front/back/side views) onto the box body; pieces are pixel rects on the sheet.
- `src/world/ragdoll.js`: active ragdolls on cannon-es. Standing/walking guys are 11 rigid parts on ball joints; PD motors (sized by the parts' reduced inertia, torque-limited) chase the joint rotations `anim.js` computes, a "cerebellum" keeps pelvis/torso upright and at height, the whole body is pulled to the logical `friend.pos`; drunk = weaker motors + a slow sway force. `Friend.animate` restores the rig's own state before `rig.update` and captures the targets after it; `Game.update` steps the physics and `rag.sync()` draws the rig from the bodies. Sitting/lying = physics off.
- `src/world/anim.js` is the body: rig (pelvis, spine, neck, hips/knees, shoulders/elbows, hands with props), layered clips (base walk/idle/sit/lie → loop → one-shot → drunk layer), two-bone IK to named anchors (mouth, eye, knee, hair...), all smoothed. `friends.js` picks the clip in `Friend.animLoop()` and the face in `faceState()`; one-shots via `figure.play('drink'|'eat'|'talk'|...)`. `particles.js`: vomit, tears, vapor, smoke, Z.
- Mood faces: any `src/assets/faces/<who>_<state>.(png|jpg|webp)` is picked up automatically (`import.meta.glob`), white background flood-filled away and auto-cropped (`faces.js`).
- `src/world/figures.js` has the people: a 3D body with a flat Doom-style billboard head that always faces the camera (`sprite`, the only style in the game; the old cube heads are still reachable with `?heads=box` for debugging), the cat, name sprites, puddles, toy, bottles, and broken marks. `textures.js` has procedural canvas textures (no image assets).
- `src/game/friends.js` has the characters: activities, problems, and the actions Oleg can take on them. `game.js` runs the night: meters, noise and neighbours, visitors and courier, stove, grill, inventory, and the interactable targets.
- `src/game/interact.js`: hands-on actions in the 3D world (hold LMB): the hand shower on its hose, scrubbing puddles with the rag, patting a coughing guy, shaking a sleeper awake, throwing the cat's mouse, filling the bucket at the tub and throwing the water. `src/game/events.js`: party events (toast, quarrel/fight, balcony fire); which ones run is per night in `TUNE.NIGHTS`. `src/game/cooking.js`: the pelmeni close-up (camera flies to the pot; salt, stir, drain over the sink with spilling). `src/world/viewmodel.js`: first-person hands holding the selected item. `src/world/mirror.js`: bathroom mirror (Reflector) with Oleg's own body. Photo mode (C) lives in `main.js` + `game.takePhoto`.
- `src/ui/icons.js`: icons from `src/assets/icons/<name>.png` (made in Qwen, list in `docs/ICONS.md`), code-drawn placeholders until a file exists.
- `src/config.js` holds **all balance numbers**. Tune there, not in code. Each night has its own setup in `TUNE.NIGHTS` (pace, trouble, money, stock, events); `game.pace` / `game.diff` / `game.hasEvent()` read it.
- `src/main.js` does renderer, modes (menu/play/orbit/end), input, raycast targeting, and the door-camera render copied into the phone. `player.js` is FPS movement with collisions and drunk sway. `fx.js` is post-processing (MSAA target, drunk vision, a light night grade, grain, vignette). `filters.js`: "Oleg's eyes", full-screen looks after the output pass (pixels, PS1, VHS, bodycam, CRT, noir, Game Boy, soap, sharpen, cartoon, film, night vision), one shader with a mode uniform, V cycles, remembered in localStorage; some come with DOM screen texts (`#filter-ov`). `world/lightpool.js`: the scene's point lights stay hidden and a fixed pool of 6 real ones is handed to the lamps nearest the camera (and in view), so the light count, and the shaders, never change. `audio.js` is synthesized sounds and music. `ui/hud.js` is the DOM HUD (portraits with fun rings cut from the mood faces) and phone; the title screen runs the party live behind the menu (`attract` in `main.js`).

## Conventions

- Interactable = any Object3D with `userData.target = { name, info?(), actions() -> [{ key: 'E'|'R'|'T', text, run }] }`.
- Keys are read via `e.code`, so a Russian keyboard layout works.
- Textures are canvas-generated and sounds are synthesized. The only real assets are in `src/assets/` (birthday paintings, face photos, skin sheets, voices); they are imported with `?inline`, so the build stays a single page with no extra requests.

## Debugging

URL params:
- `?perf` (or the Ё / Backquote key) shows the performance meter; `?bench` runs the one-minute benchmark (`src/perf.js`) and ends with a copyable report.
- `?view=top` or `?view=orbit` opens the dollhouse view.
- `?heads=box` shows the old cube heads (debug only; the game always uses flat sprite heads).
- `?play` starts without pointer lock. Add `x`, `z`, `yaw`, `pitch` (degrees) to place Oleg, `t=SECONDS` to fast-forward the sim, `phone` to open the phone, `night=N` to pick a night, `eye=METERS` to move the camera up (e.g. `eye=6&pitch=-89` for a close top-down look).

`window.__game`, `window.__player`, `window.__spots`, `window.__three` are exposed. Force a clip on a friend with `f.debugLoop = 'puke'` (null = none, delete to go back to normal). Headless Chromium for screenshots is at `/opt/pw-browsers/chromium`; launch it with `--use-angle=swiftshader --enable-unsafe-swiftshader`. It renders at about 1–2 fps, so wait a few seconds between steps.
