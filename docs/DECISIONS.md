# Decisions and features log

Every change and every feature gets an entry here, in the same commit or pull request as the change (the user's rule, 29 Oct 2026).
Newest first. Each entry says **what** changed, **why** (the decision and who made it), **where** (files), and **status** (branch / PR, on `main`, live or not).
Technical detail for continuing the work lives in `docs/HANDOFF.md`; this file is the plain record.

Live game: https://haarklous-online.server-smoke.workers.dev · Source: https://github.com/jonatsl/haarklous-online · Unreal version: https://github.com/jonatsl/haarklous-ue5

## Features (what the game has now)

On `main`:
- Open world around Haarklous plass 17A, Torshov: real buildings and streets (OpenStreetMap), real ground heights (Kartverket), optional aerial photos; walkable out to about 540 m, drawn properly everywhere you can walk.
- Your 4th-floor apartment (your kitchen + bedroom design) and stairwell; the street door and stairs work without the mission; eight neighbouring stairwells.
- Walking (3.5 m/s), running, crouch (tap ○), prone (hold ○), jump (✕); PS4 controller (USB / Bluetooth) plus keyboard and mouse; look sensitivity setting.
- Vehicles: Honda CBF600S motorcycle and 7 more motorcycles, 30 cars, excavator, helicopter, two-seat plane; hands on bars / wheel / sticks.
- Cars and motorcycles follow gravity (9.81 m/s²) and fly over crests and bumps taken fast (PR #5).
- FPV drone (hold △), photo camera with gallery (tap △), wristwatch (D-pad ↑), map (touchpad).
- Minigames: two disc golf holes, petanque against Arne; hostage-rescue mission (start at the red ring by the entrance); stay home after the mission.
- Firepit with benches, beer crate and woodpile (fire size shared online); beer and aquavit in the apartment (30 s drunk each).
- Joker and Kiwi shops at their real places with a cashier; money in kroner (start 500 kr, earned from the mission, minigames and bottle deposit), Norwegian beer hours, a bag of bought items (PR #6).
- Three hidden stashes with 30-second boosts: 3× running speed, 3× jump height or bullet time.
- Construction site (140 × 90 m, two gates) with seven machines: dozer, 30 t excavator, wheel loader, articulated hauler, 8x4 tipper, mobile crane, tower crane; diggable soil that keeps its volume; R3 / V changes the machine view (PR #8).
- Paintball course next to the site: lobby, admin, teams up to 6 v 6, team deathmatch with respawns or in rounds, capture the flag, paint or reball (PR #8).
- Multiplayer on Cloudflare (lobby codes, up to 12 players), passengers in motorcycle / cars / helicopter / plane, text chat with quick chat, lobby-wide voice chat.
- Soundtrack: 2.5-minute open-world loop plus one loop per minigame and the mission; ambient sound by location.

Live site: still runs the older branch `feat/ue5-features` (no jumps, no shops yet) until `main` is deployed.

## Log

### 2026-10-29 · One version again: the Unreal features join `main`
- **What:** the branch `feat/ue5-features` (construction site, paintball, 12 players per lobby, walking 3.5 m/s, see `docs/UE5-PARITY.md`) is merged with `main` (vehicle jumps, shops, stashes, far-away fix). The two versions had grown apart; now one branch has everything. Small fixes while merging: the cashier keeps their own shirt colour with the 12 slot colours; the map shows the shops, the site and the paintball course; the multiplayer screen says "up to 12 players".
- **Why:** the user's goal (29 Oct 2026): both repos should have the same features and fixes. The fixes for the Unreal issues (paintball, street lamps, sculpture) need the paintball code, which was only on `feat/ue5-features`.
- **Where:** merge of `feat/ue5-features` into `feat/align-with-ue5`; conflicts solved in `game-main.js` (ground, obstacles, map markers, test handle), `game-avatars.js`, `index.html`, `style.css`.
- **Checked:** Node tests 35/35. In the game: walked into Joker and paid for two items (36,80 kr), joined the paintball lobby, started and left a game (hold △), drove a site machine; no console errors.
- **Status:** PR #8 (branch `feat/align-with-ue5`), waiting for the user's OK to merge. After the merge `feat/ue5-features` is no longer needed.

### 2026-10-29 · Joker and Kiwi shops, cashier and money
- **What:** the two real grocery shops near Haarklous plass are in the game at their OpenStreetMap places: Joker Torshov (node 1506608498, shop front about 120 m south-west of the flat, in building 888) and Kiwi Torshov (node 2476542841, about 250 m north, in building 156). Each shop is cut into the ground floor of its building (the building outline gets a 10 × 10 m notch, the facade above is rebuilt). Inside: glass front with sliding doors and the brand sign, opening hours on the door, fridges, shelves, firewood sacks, a bottle-return machine and a till with a cashier who greets you and turns toward you. 12 products with real Norwegian prices (Kiwi about 5 % cheaper). □ puts an item in the basket, □ at the till pays. Money in kroner: start 500 kr, shown top right; earn it from the hostage rescue (400), disc golf (par 50, birdie 100, eagle 200), petanque wins (150) and bottle deposit (2 kr per bottle, also for the beers in the flat and the crate). Bought items go in a bag (D-pad ↓ / ↓): drinks, food (sobers you up), Red Bull (15 s of 3× speed), firewood for the firepit (+3 logs).
- **Why:** the user asked for both shops at their real places, buying items, a cashier and a money system. Norwegian rules chosen: beer only Mon–Fri 08–20 and Sat 08–18 (by the PC clock), never on Sunday (the cashier takes it back); 2 kr deposit (every drink sold is 0.5 l or smaller; bigger bottles would be 3 kr). Opening hours are shown but not enforced, so the shops can always be visited. Leaving with unpaid items sets off the alarm and the items go back (no stealing). Money is saved in the browser per player, not shared online.
- **Where:** `game-shops.js` (new: shops, products, notch, wallet), `game-main.js` (prompts, basket, paying, bag, earning, HUD), `game-minigames.js` and `case-game.js` (rewards), `game-avatars.js` (shirt colour), `game-audio.js` (coin, till, alarm, bottle machine, door sounds), `index.html`, `style.css`, `README.md`, `tests/shops.test.cjs`.
- **Checked:** walked in through both doors, took all 8 kinds of shelf, fridge and floor items by aiming and pressing □, paid at the till, beer refused on a Sunday and after 18 on a Saturday, card declined, alarm on leaving, bottle return, bag (open, choose, use, close, long list scrolls), firewood on the firepit (+3), reward notice. Extra frame time in front of the shop about 3 ms. Node tests 28/28.
- **Status:** PR https://github.com/jonatsl/haarklous-online/pull/6, merged into `main` on 29 Oct 2026 (the user approved). Not live yet: the live site runs `feat/ue5-features`. Same feature for the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/5.

### 2026-10-29 · Cars and motorcycles jump over crests (gravity 9.81 m/s²)
- **What:** cars and motorcycles have real up-and-down movement. Where the ground falls away faster than gravity (9.81 m/s²) can pull the vehicle down, it flies on a ballistic path until it lands. No grip, steering or brakes in the air; the nose follows the flight path; landing gives a thud and a short dip of the view (crash sound on hard landings). In the air only obstacles at the vehicle's height block it. The excavator still hugs the ground.
- **Why:** the user's wish: vehicles should jump "when physics says so", with gravity 9.81 m/s². Millimetre hops over the 4 m height grid are ignored for control (more than 0.06 s and 3 cm needed) so steering stays normal on ordinary roads.
- **Where:** `game-vehicles.js` (`Vehicle.settle`, `clear`, `land`; car and motorcycle `update`), `README.md`.
- **Checked:** grass hump at local (392, −392): car 50 km/h stays down; car 90 km/h flies 0.57 s / 14 m (matches a hand calculation); motorcycle 110 km/h flies 0.68 s / 21 m; measured gravity 9.80–9.83 m/s².
- **Status:** PR https://github.com/jonatsl/haarklous-online/pull/5. Same feature for the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/4.

### 2026-10-29 · This log
- **What:** `docs/DECISIONS.md` records every change and feature; `AGENTS.md` tells every session to keep it up to date.
- **Why:** the user asked to keep track of every change and feature in a decisions file.
- **Status:** PR #5.

### 2026-10-28 · Issues #1 and #2 merged into `main`
- **What:** PR #3 (far-away buildings and ground) and PR #4 (stashes) merged; issues #1 and #2 closed.
- **Why:** the user asked to implement the two issues and approved the merges.
- **Status:** on `main`. The live site runs `feat/ue5-features`, which has the stashes but not yet the far-away fix.

### 2026-10-28 · Features ported from the Unreal version
- **What:** construction site (seven machines, diggable soil that keeps its volume), paintball, 12 players per lobby, walking speed 3.5 m/s.
- **Why:** the user's goal: feature parity with the Unreal project, in the web style (never its graphics). Record: `docs/UE5-PARITY.md` on that branch.
- **Where:** `game-site.js`, `site-models.js`, `site-data.js`, `game-paintball.js`, `paintball-*.js`, `cloud/src/index.js`, `game-main.js`.
- **Status:** branch `feat/ue5-features` (no PR yet), deployed live.

### 2026-10-26 · Hidden stashes with 30-second boosts (issue #2)
- **What:** three crates (a neighbour's top-floor stairwell, the courtyard behind the building, a bush in the park north of the block), each with lines and a syringe; □ gives a random 30 s boost: 3× running speed, 3× jump height or bullet time (the world, including the mission's hostiles, at 0.35× speed). Items come back after 90 s.
- **Why:** issue #2. "Something else" was chosen as bullet time because it also matters in the mission.
- **Where:** `game-stash.js`, `game-main.js`, `case-game.js` (`ctx.timeScale`), `game-audio.js` (`sniff`, `needle`, `muffle`).
- **Status:** PR #4, merged.

### 2026-10-26 · Buildings and ground drawn properly far from home (issue #1)
- **What:** everything you can walk to (±540 m) is drawn in the near pass: buildings and trees in 270 m tiles, ground out to the edge on the same 4 m grid you walk on. The far layer only fills the distance.
- **Why:** issue #1: beyond about 280–300 m the far layer (which clips anything closer than 15 m) made buildings see-through and the ground go missing.
- **Where:** `surroundings.js`. Speed measured about the same as before.
- **Status:** PR #3, merged.

### 2026-10-25 · Voice chat for the whole lobby; GitHub repo
- **What:** voice is no longer by distance: everyone in the lobby hears everyone at full volume. Fixed voice that never arrived when someone turned the mic on after joining (one two-way audio channel per pair; the mic only swaps the track). Source moved to the private repo `jonatsl/haarklous-online`.
- **Why:** the user's wish (voice) and request (repo).
- **Where:** `game-voice.js`, `game-multiplayer.js`.

### 2026-10-24 · Rename to "Haarklous online"; home without the mission
- **What:** the online game is called Haarklous online (Worker `haarklous-online`; the old address was removed). The street door opens normally; the mission starts from a red ring by the entrance; leaving a mission keeps you where you are (at home if you are in the flat).
- **Why:** the user's wishes.
- **Where:** `index.html`, `cloud/wrangler.toml`, `game-net.js`, `game-main.js`.

### 2026-10-24 · Multiplayer, chat, passengers, firepit, more vehicles
- **What:** Cloudflare Worker + Durable Object lobbies (codes in the settings, join by code or `?lobby=CODE`), avatars, text chat and quick chat, voice chat, one passenger in motorcycle / car / helicopter / plane (plane made a two-seater), firepit with benches, beer and logs, 25 more cars and 7 more motorcycles placed the same way for every player.
- **Why:** the user's goal (Cloudflare, no GitHub at the time, no own domain).
- **Where:** `cloud/`, `game-net.js`, `game-multiplayer.js`, `game-avatars.js`, `game-voice.js`, `game-fire.js`, `game-main.js`.

### 2026-10-24 · Soundtrack
- **What:** procedural music: a 2.5-minute calm open-world loop and one loop each for disc golf, petanque and the mission; music volume in the settings.
- **Where:** `game-music.js`.

### 2026-10-24 · Helicopter, plane, FPV drone, wristwatch, gear menu
- **What:** helicopter and plane flown with Mode 2 sticks (Battlefield / RC style), FPV drone (angle and acro modes), hold-△ menu for camera or drone, wristwatch on D-pad ↑.
- **Where:** `game-aircraft.js`, `game-watch.js`, `game-main.js`, `game-audio.js`.

### 2026-10-24 · Fixes from play-testing
- Motorcycle leans into the turn and its bars turn the right way; you can ride again after getting off (a vehicle no longer collides with its own parked outline); L2 reverses the bike.
- Car: open cabin, steering wheel tilted the right way, hands at ten and two that turn with the wheel.
- Disc golf disc always comes to rest; birds less frequent and almost silent indoors.

### 2026-10-24 · Open-world game
- **What:** the apartment viewer became an open-world game: neighbourhood, stairwells, mission, motorcycle, cars, excavator, disc golf, petanque, drinks, camera, map, ambient sound. Old viewer files were moved to `C:\Users\Lenovo\Documents\haarklous-plass-archive-2026-10-24`.
- **Why:** the user's goal.
