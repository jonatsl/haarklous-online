# Decisions and features log

Every change and every feature gets an entry here, in the same commit or pull request as the change (the user's rule, 29 Oct 2026).
Newest first. Each entry says **what** changed, **why** (the decision and who made it), **where** (files), and **status** (branch / PR, on `main`, live or not).
Technical detail for continuing the work lives in `docs/HANDOFF.md`; this file is the plain record.

Live game: https://haarklous-online.server-smoke.workers.dev · Source: https://github.com/jonatsl/haarklous-online · Unreal version: https://github.com/jonatsl/haarklous-ue5

## Features (what the game has now)

On `main`:
- Open world around Haarklous plass 17A, Torshov: real buildings and streets (OpenStreetMap), real ground heights (Kartverket), optional aerial photos; walkable out to about 760 m (540 m before PR #13), drawn properly everywhere you can walk.
- Your 4th-floor apartment (your kitchen + bedroom design) and stairwell; the street door and stairs work without the mission; eight neighbouring stairwells.
- Walking (3.5 m/s), running, crouch (tap ○), prone (hold ○), jump (✕); PS4 controller (USB / Bluetooth) plus keyboard and mouse; look sensitivity setting.
- Vehicles: Honda CBF600S motorcycle and 7 more motorcycles, 30 cars, excavator, helicopter, two-seat plane, Caravan jump plane; hands on bars / wheel / sticks.
- Cars and motorcycles follow gravity (9.81 m/s²) and fly over crests and bumps taken fast (PR #5).
- FPV drone (hold △), photo camera with gallery (tap △), wristwatch (D-pad ↑), map (touchpad).
- A waypoint you set on the map (✕ or a click) and a purple pin on screen that leads you there until you are within 7 m (issue #41); an optional round minimap in the bottom-left corner like GTA IV's, turned on in the pause menu (issue #42).
- Minigames: the real Muselunden DiscGolfPark (12 holes, PR #13) and two disc golf holes in Torshovdalen (you walk from hole to hole, and the minimap shows the course, your lie and the way to the next tee, issue #60), petanque against Arne; hostage-rescue mission (start at the red ring by the entrance); stay home after the mission.
- Firepit with benches, beer crate and woodpile (fire size shared online); beer and aquavit in the apartment (30 s drunk each).
- Joker and Kiwi shops at their real places with a cashier; money in kroner (start 500 kr, earned from the mission, minigames and bottle deposit), Norwegian beer hours, a bag of bought items (PR #6).
- Three hidden stashes with 30-second boosts: 3× running speed, 3× jump height or bullet time.
- Torshovoksen, the bull on Oksefontenen at Hegermanns plass, at its real place (issue #20).
- Real weather from MET Norway: clouds, fog, rain, sleet and snow, wind (issue #23).
- Skydiving: a jump flight to 3000 m every 8 minutes for the whole lobby, or the Caravan jump plane flown by a player or by the game's pilot (alone too: fly it up and jump); freefall, canopy, landing (issue #22).
- HODET N.N., Marianne Heske's 7 m bronze doll's head, at its real place at the north end of Torshovdalen, with its stone steps (PR #12).
- Construction site (140 × 90 m, two gates, in the south-west of Torshovdalen since PR #12) with seven machines: dozer, 30 t excavator, wheel loader, articulated hauler, 8x4 tipper, mobile crane, tower crane; diggable soil that keeps its volume; R3 / V changes the machine view (PR #8).
- Paintball course on the valley floor between the sculpture and the site (since PR #12): lobby, admin, teams up to 6 v 6, team deathmatch with respawns or in rounds, capture the flag, paint or reball (PR #8).
- Multiplayer on Cloudflare (lobby codes, up to 12 players), passengers in motorcycle / cars / helicopter / plane, text chat with quick chat, lobby-wide voice chat.
- Player accounts (optional): create an account or log in with email and password in the pause menu; your account name is your lobby name (PR #34, Better Auth + Supabase).
- Soundtrack: 2.5-minute open-world loop plus one loop per minigame and the mission; ambient sound by location.
- Gamle Oslo, Ensjø and the way there: real streets, ground heights and about 7,900 buildings south of the old world (3.4 × 3.4 km, down Trondheimsveien to Bjørvika); churches, MUNCH, the Opera (walkable roof) and tall chimneys modelled; a timed Ensjø → Rathkes gate run (PR #48, issue #38).
- Kayaking down Akerselva from three put-ins (Bjølsen, Sagene, Grünerløkka) to Vaterland: the real river, its falls and bridges (issue #45).
- Schous plass: playable table tennis against Ola; Deichman Grünerløkka with thousands of books, *The Inner Game of Tennis* and a readable *Moby-Dick*, and a librarian who shushes runners and loud voices (issues #44, #47).
- Rathkes gate 1: the gate, the passage and the backyard with door 1C, ready for the second flat (issue #44, preparation).
- Klatreverket Torshov at its real place (Myrens verksted 3K) in its real building: 14 m hall, 7 m overhanging competition wall, Galleriet, autobelay tower, bouldering on three floors, the training room with the Moonwall; reception with the real prices and rental; climb with L2 / R2 (bouldering, top rope with Siri belaying, lead with clips, autobelay), pump, falls on the rope, the brattkort test and belaying Siri.
- The ground round Myrens verksted and Akerselva (district patch 'myrens').
- Jobs that earn money, from a phone (D-pad → / P) or the JOBB signs by Joker and Kiwi: food delivery from real cafés, restaurants and the shops to real street doors, and taxi with passengers who tip for smooth, fast driving; a friend riding along gets half (issue #56).
- E-scooters on the pavements (10 kr + 3 kr a minute, 20 km/h, left where you get off – for everyone online) and Oslo city bikes and e-bikes in the 40 real Oslo Bysykkel docks around Torshov, Myrens and Grünerløkka, at the real prices; the map shows the free bikes at each dock (issue #57).
- A large catacomb under Torshovdalen with three entrances about 100 m apart (marked ☠ on the map): torch-lit bone galleries with real-looking skulls, dark quarry tunnels where you use your torch (□ / L1 / Q), and a map that is wiped underground and fills in with what you see (PR #50, issue #43).
- Logged in, your progress is your account's and is there on any PC or browser: money and bottles, the bag, photos (an album of up to 60), badges, best scores, Klatreverket ticks, the catacomb map and your settings; it saves by itself. The first log-in on a browser with its own progress asks whether to move it into the account. Without an account it stays in the browser as before (issue #54, PR #70).
- Badges and a photo hunt in the pause menu (R1 / B): 16 badges from playing and ten places to photograph (Torshovoksen, HODET N.N., Deichman Grünerløkka, Klatreverket, the catacomb's rotunda, Muselunden, MUNCH, the Opera, Rathkes gate 1, your street door); each new badge pays 50–300 kr; best scores for the minigames, the mission, skydiving and the runs; an orange landing target for skydivers at the airstrip (issue #58, PR #70).

Live site: runs `main` (Worker version a75a02dc, deployed 3 Nov 2026 after PR #70; `main` builds byte-for-byte to the live page), so everything above is online.

On branch `feat/heli-drone-physics` ([PR #75](https://github.com/jonatsl/haarklous-online/pull/75), issue #73, not merged yet):
- Helicopter and drone flight closer to the real thing: the rotor's lift tilts with pitch and bank, so tilting takes lift away from climbing and turns it into speed; add collective or thrust to keep your height (issue #73).

## Log

### 2026-11-03 · Helicopter and drone: tilting costs lift (issue #73)
- **What:**
  - **Helicopter:**
    - Full collective now gives 1.4 × the helicopter's weight in rotor thrust, not 1.85 ×. Level, it climbs about 8 m/s (an H125 climbs 8.5–10 m/s); before it was over 16 m/s.
    - The thrust tilts with the helicopter, as before, but now the spare lift is small enough that you feel it. Holding W (full collective), the climb drops as you pitch forward: about half at 30°, none at 45°, and steeper it sinks. The lift goes into speed instead. Banking costs the same as pitching.
    - At centre collective, level, it still hovers; tilted, it sinks unless you add collective.
    - A little more air drag at speed: the top speed flying level is now about 285 km/h, the H125's never-exceed speed. Before it could reach about 430 km/h.
  - **FPV drone (angle mode):**
    - Before, the drone added thrust for the tilt by itself, so it never lost height. Now it doesn't: tilted, only part of the thrust holds it up, so it sinks (about 1.4–1.6 m/s at full tilt) unless you push thrust up. With thrust up it climbs while it flies forward.
    - Centred and level it still holds its height. Acro mode was already like this.
  - Help texts (README, start and pause screens, the ANGLE message) say so.
- **Why:** the user's issue #73: "When changing roll and pitch the helicopter should also lose altitude … when holding down w and pitching forward it should climb less altitude". The user asked to implement it and to merge and deploy (3 Nov 2026).
  - Decided here: no extra lift from forward speed (a real helicopter gets some, "translational lift"), because the issue asks for pitching forward to climb less.
- **Where:** `game-aircraft.js` (helicopter lift and drag, drone thrust), `game-main.js` (ANGLE message), `README.md`, `index.html`, `docs/HANDOFF.md`, new test `tests/flight.test.cjs`.
- **Checked:**
  - Node tests 132/132 (4 new). Run against the old physics the new tests fail (16.6 m/s climb; the drone did not sink at full tilt).
  - In the game (simulated controller, frames stepped by hand): the helicopter climbed 7.8 m/s at full collective level; held about 55° nose down it sank 3.1 m/s at full collective and 7.6 m/s at centre, at about 260 km/h; let go, it levelled and stopped sinking. The drone hovered at 0.0 m/s, sank 1.4 m/s at full tilt (69 km/h) and climbed 3.9 m/s with thrust up while tilted. No script errors.
  - Not checked: a real DualShock 4, mouse flying on the user's PC.
- **Status:** branch `feat/heli-drone-physics`, [PR #75](https://github.com/jonatsl/haarklous-online/pull/75), not merged, not live.

### 2026-11-03 · `main` is live (PR #70, saved progress, badges and the photo hunt)
- **What:** saved progress for accounts, badges and the photo hunt (PR #70, issues #54 and #58) are merged into `main` (93d4f27) and deployed (Cloudflare Worker version a75a02dc).
  - Deployed from this session's own clean worktree at the merge commit, with `cloud/` packages installed by `npm ci`.
  - The deploy added the new Durable Object `Profile` (migration v3) that keeps each account's progress and photos. The Supabase database did not change.
- **Why:** the user said "Merge and deploy" (3 Nov 2026).
- **Checked:**
  - `node --test tests/*.cjs`: 128 pass on the merged `main`.
  - `main` builds byte-for-byte to the committed `haarklous-game.html`, and the live page is byte-for-byte the build. `/weather` answers 200.
  - On the live server `/api/progress` and `/api/photos` answer 401 "Not logged in" without a login (so the login check runs and the test login of `wrangler dev` is not there).
  - The live game loads with no console errors; the badges list (26) and the ten photo places are there.
  - Not checked: saving with a real account on the live server (Claude does not log in to real accounts), a real DualShock 4.
- **Status:** live.

### 2026-11-03 · Accounts save your progress; badges and a photo hunt (issues #54 and #58)
- **What:**
  - **Saved progress (issue #54):**
    - Logged in, these are saved to your account: money and empty bottles, the bag, your photos, badges, best scores (disc golf, petanque, table tennis, paintball, the mission, skydiving, kayak, the run, Klatreverket), the catacomb map and your settings (look sensitivity, music volume, minimap).
    - Log in on another PC or browser and everything is there.
    - It saves by itself every 20 s when something changed, when the tab is hidden and when it closes. The account box in the pause menu says when it last saved.
    - The first time you log in on a browser that has progress of its own, the game asks whether to move it into the account. Yes: money, bottles and the bag add up, the better best score wins, and badges, climbing ticks, the catacomb map and photos join. No: it stays in the browser and comes back when you log out, and you are not asked again.
    - Logging out saves once more and brings back the browser's own progress.
    - Photos go to the account's own album, at most 60 per player. A full album says so; delete old photos in the gallery (✕ / Delete twice, which also works without an account).
    - Without an account nothing changes: everything stays in the browser.
  - **Badges and the photo hunt (issue #58):**
    - A list in the pause menu (button *Badges and best scores*, R1 on the controller, B on the keyboard; B while walking opens it directly).
    - 16 badges from playing: the hostage mission, a hole in one, all 12 holes at Muselunden, beating Arne at petanque, winning a paintball game against other players, landing within 10 m of the skydiving target, climbing a route and passing the brattkort at Klatreverket, kayaking down Akerselva, beating Ola at table tennis, the Ensjø → Rathkes gate run, going down into the catacomb, opening Moby-Dick, throwing a log on the firepit, flying 50 m up, and finding every photo-hunt place.
    - The photo hunt: Torshovoksen, HODET N.N., Deichman Grünerløkka, Klatreverket Torshov, the Rotunda of bones in the catacomb, Muselunden (the basket of hole 1), MUNCH, the Opera, Rathkes gate 1 and your own street door. A photo counts when the place is in the picture (not at the very edge), big enough (go closer or zoom in) and nothing solid is in the way; the street door counts only from the front. Otherwise the game says what was wrong. The list shows your photo, or a hint.
    - Each new badge shows a short message with its icon or photo and pays 50–300 kr.
    - Best scores in the same list.
    - A landing target for skydivers (orange and white circles, 21 m across) on the grass 180 m down the airstrip, ◎ on the map. After landing the game says how far from it you were.
- **Why:** the user's issues #54 ("the game should remember your progress on the server … money and bottle deposit, the items in your bag, your photos, your best scores … your settings … asks if you want to move it into your account … Photos … their own storage, with a limit") and #58 ("achievements … photo hunt … the list shows the photo you took, and a hint … short message on screen and some kroner … saved with your account"). The user asked to implement both (3 Nov 2026).
  - Decided here:
    - Photos and progress live in one Cloudflare Durable Object per account (SQLite storage, free plan), not in the Supabase database, so photos do not fill the 500 MB database and no database change is needed.
    - The photo limit is 60 per player.
    - Graphics quality and aerial imagery stay per PC (they depend on the computer).
    - The street door is the tenth photo place; the "On target" badge needed a target, so one was added at the airstrip.
    - Badges are checked from what is saved (best scores, ticks, times), so progress moved into an account gets its badges too.
- **Where:**
  - `game-progress.js` (new): what progress is, how two copies join, the sync with the server, the account's photo album.
  - `game-badges.js` (new): badges, photo hunt places, the photo check, best scores, the list and the message.
  - `cloud/src/progress.js` (new): the server side; `cloud/src/auth.js` (who is logged in); `cloud/src/index.js` (routes); `cloud/wrangler.toml` (Durable Object `Profile`, migration v3).
  - `game-camera.js`: the album can be the browser's or the account's; delete in the gallery.
  - `game-main.js`: wiring, the question box, the badge checks, the photo hunt places and sight line, the skydiving target, the pause menu.
  - `game-shops.js`, `game-music.js`, `game-map.js`, `game-catacomb.js`, `catacomb-layout.js`, `game-climbing.js`, `game-kayak.js`, `game-route.js`: read their saved value again when an account's progress is loaded.
  - `game-minigames.js`, `game-tabletennis.js`, `case-game.js`: report results for the best scores.
  - `index.html`, `style.css`, `README.md`, `docs/HANDOFF.md`; tests `tests/progress.test.cjs`, `tests/badges.test.cjs`.
- **Checked:**
  - Node tests 113/113 (11 new); 128/128 after merging `main` (jobs and bikes, the disc golf minimap). The merged game starts, the phone (D-pad →) and the badges list (R1) open and close, no script errors.
  - On a local copy of the server (`wrangler dev`, logged in as a test user): saving and loading, bad input refused, the 61st photo refused.
  - In the browser: the question and both answers; 900 + 777 = 1677 kr after moving, the photo moved; a newer save from "another PC" loaded on reload; log-out saved the last change and brought the browser's copy back; deleting a photo in the account album; all ten photo places photographed through the game's own camera path (photos checked by eye); the badges list; a real canopy landing 7.8 m from the target gave "On target" and 150 kr.
  - Not checked: the live server (needs the merge and a deploy), a real DualShock 4, two PCs at the same time (the last save wins).
- **Status:** merged into `main` ([PR #70](https://github.com/jonatsl/haarklous-online/pull/70), 93d4f27) and live (Worker version a75a02dc, 3 Nov 2026). Issues #54 and #58 are closed.

### 2026-11-03 · `main` is live (PR #61, the disc golf course on the minimap)
- **What:** the disc golf course on the minimap and the walk to the next tee (PR #61, issue #60) are merged into `main` (4bfcf20) and deployed (Cloudflare Worker version 4a8eab68).
  - Deployed from this session's own clean worktree at the merge commit, with `cloud/` packages installed by `npm ci`.
  - The jobs, e-scooters and city bikes (PR #62) were already live before this deploy; their "live" entry is in PR #66.
- **Why:** the user said "Merge and deploy" (3 Nov 2026).
- **Checked:**
  - `node --test tests/*.cjs`: 117 pass on the merged `main`.
  - `main` builds byte-for-byte to the committed `haarklous-game.html`, and the live page is byte-for-byte the build.
- **Status:** live. Issue #60 is closed (GitHub closed it when PR #61 was merged).

### 2026-11-03 · Disc golf course layout on the minimap (issue #60)
- **What:**
  - During a disc golf round (Muselunden or Torshovdalen) the round minimap shows the course:
    - the course outline (Muselunden's own outline; for Torshovdalen, which has none, a line round its tees and baskets),
    - every hole's tee with its number, its basket (yellow) and a line from tee to basket,
    - the hole you play bright, the other holes faded,
    - your lie (where your last throw landed) as a pink dot with the metres to the basket.
  - The minimap zooms so the whole hole you play fits (tee, basket and your lie).
  - After each hole you now walk (or run) to the next tee. The minimap shows the way there with a dashed line, and the card counts the metres to the tee. The next hole starts when you are within 3 m of its tee. □ takes you straight there, as the old automatic move did. ○ still ends the round.
  - The big map (touchpad) shows the same layout while a round is on. The course's normal map icons are hidden then.
  - If the minimap is switched off in the pause menu, it turns on by itself during the round and off again afterwards. The saved setting does not change.
  - If you keep R2 held from running when you reach the tee, it does not start a throw; let go of R2 first.
- **Why:** issue #60 (the user asked to implement it, 3 Nov 2026). Before, the game moved you to the next tee by itself; the issue says you walk there and the minimap shows the way, so walking was added.
- **Where:**
  - `game-map.js`: `map.course`, `drawCourse` (minimap and big map), `courseOutline`, `courseRange`; the minimap shows during a round.
  - `game-minigames.js`: the walk between holes (`walk`, `beginHole`), `layout()` for the map, `toLocal`.
  - `game-main.js`: `updateMinigame` lets you walk between holes, `updateGuide` gives the map the round's layout, the scorecard text, the course tag on the map icons.
  - `README.md`, `index.html` (controls text and the minimap setting), `docs/HANDOFF.md`.
  - Tests: `tests/map.test.cjs` (outline, zoom) and `tests/minigames.test.cjs` (walk to the next tee, □, ○, the last hole, the layout).
- **Checked:**
  - `node --test tests/*.cjs`: 107 pass (5 new); 117 pass after merging `main` with the jobs and bikes (PR #62). On the big map the course's icons stay hidden during a round, and the city bike docks keep their zoom labels.
  - In the browser (simulated controller, offline): a real throw on Muselunden hole 1 landed 68 m short and showed as the pink dot with "68 m"; after the hole the walk to tee 2 showed the dashed line and "43 m to the tee"; running onto the tee started hole 2 without a throw; the big map showed the layout; ○ ended the round and the minimap went off again (setting off) or stayed on (setting on); Torshovdalen showed its drawn outline. No script errors.
  - Not checked: on the user's own PC and controller.
- **Status:** merged into `main` ([PR #61](https://github.com/jonatsl/haarklous-online/pull/61), 4bfcf20) and live (Worker version 4a8eab68, 3 Nov 2026). Issue #60 is closed.

### 2026-11-03 · `main` is live (PR #62, jobs, e-scooters and city bikes)
- **What:** delivery and taxi jobs, e-scooters and Oslo city bikes (PR #62, issues #56 and #57) are merged into `main` (9bdda69) and deployed (Cloudflare Worker version a218d9f4).
  - Deployed from this session's own worktree at the merge commit, with `cloud/` packages installed by `npm ci`.
- **Why:** the user said "Merge and deploy" (3 Nov 2026).
- **Checked:**
  - `node --test tests/*.cjs`: 112 pass on the merged `main`.
  - The live page is byte-for-byte the build.
  - The live game loads the 40 city bike docks, the 881 street doors and the phone, with no console errors.
- **Status:** live.

### 2026-11-03 · Delivery and taxi jobs; e-scooters and Oslo city bikes (issues #56 and #57)
- **What:**
  - **Phone:** D-pad → (keyboard → or P) opens a phone on foot or in a vehicle: start or stop a delivery shift, turn taxi on or off, and see the nearest e-scooter and city bike dock (✕ sets the waypoint). □ at the *JOBB* signs beside Joker and Kiwi opens it too.
  - **Delivery (#56):**
    - An order comes in from a real café, restaurant or takeaway near Torshov (22 places from OpenStreetMap) or from Joker / Kiwi. The waypoint, the minimap and a yellow ring show where to go.
    - □ there picks up the order. Then it must go to a real street door: one of 881 OpenStreetMap addresses, with the door on the side that faces its own street. A door with the house number appears on the building.
    - Pay: 35 kr + 7 kr per 100 m, up to 50 % more for being fast, 40 % when the time has run out. On foot, running, by bike, scooter, motorcycle or car.
  - **Taxi (#56):**
    - In a car as the driver, turn on taxi: the roof light comes on. A passenger calls from a street address and waits at the kerb; stop beside them and they get in the back seat and ask for an address in the neighbourhood.
    - Fare 65 kr + 20 kr per km. Smooth and fast driving gives a tip up to a quarter of the fare. Crashes, hard braking and swerving, wrong turns (driving 45 m away from the destination) and drunk driving make the passenger angry (a bar on the job card, comments in a speech bubble) and the tip smaller or nothing.
    - Getting out ends the taxi shift; a passenger in the back leaves without paying.
  - **With friends online (#56):** others see your taxi light and your passenger. A friend who rides along (passenger seat or pillion) sees your job, follows your waypoint and gets half of each payment.
  - **E-scooters (#57):** 48 on the pavements around Torshov and Grünerløkka. □ unlocks one: 10 kr, then 3 kr every started minute. Ride standing, alone, at up to 20 km/h. Getting off ends the ride; the scooter stays there, for the other players too.
  - **City bikes and e-bikes (#57):**
    - The 40 real Oslo Bysykkel docks around Torshov, Myrens and Grünerløkka, from the operator's open data (GBFS, 3 Nov 2026), each with up to 10 of its slots, a name totem and about half full (a third e-bikes).
    - The real prices: 8 kr, then 1 kr (e-bike 2 kr) for every started minute after the first.
    - R2 pedals: about 22 km/h on the flat, 13 km/h up a 3.6 % hill, 7 km/h up 8 %; the e-bike keeps 23 km/h up 3.6 % and 16 km/h up 8 % (its motor stops helping at 25 km/h).
    - Return it to any dock with a free slot (□). Elsewhere □ locks it and the trip goes on; after 15 minutes outside a dock you pay a 250 kr fee for not returning it (the game's own rule). Nobody else can take a bike you have locked.
    - The map shows every dock with the number of free bikes; zoomed in, its name and how many are bikes and e-bikes.
  - **A fix for everyone online:** when a player got off a vehicle, the others dropped the last position update, so the vehicle could stand a little wrong for them. Now it stands exactly where it was left.
- **Why:** the user's issues #56 ("Delivery and taxi jobs") and #57 ("E-scooters and city bikes", with the comment "include some e-bikes too"); the user asked to implement both (3 Nov 2026).
  - The e-scooter price is a typical Oslo price, not one company's, and no company names or logos are used. The 250 kr fee and the 15 minutes are the game's own choice (the issue asks that keeping the bike too long or not returning it costs more).
  - The waiting passenger stands at the kerb, not at their door: some buildings stand 20 m back from the street.
- **Where:** `game-jobs.js`, `jobs-data.js`, `game-rentals.js`, `rides-data.js`, `tools/make-jobs-rides.cjs`, `assets/gbfs/oslo-bysykkel-2026-11-03.json`, `assets/osm/jobs-osm-2026-11-03.json`, `game-main.js` (docks and signs, vehicles, prompts, phone, job card, crew share, online state), `game-vehicles.js` (`onHit`, shared model parts), `game-multiplayer.js` (last position on getting off, cycling speed), `game-avatars.js` (scooter and cycling poses), `game-audio.js` (e-motor, unlock, bell), `game-map.js` (dock labels when zoomed in, legend), `index.html`, `style.css`, `README.md`, `docs/HANDOFF.md`, `tests/jobs-rides.test.cjs`.
- **Checked:**
  - Node tests 112/112 (10 new): prices, dock counting, the docks clear of buildings and streets, seeded scooter places, delivery pay, taxi fare / mood / tip, wrong turns, orders, doors on the street side of their building.
  - In the browser (simulated controller): scooter unlocked (10 kr), top speed exactly 20 km/h, ride ended and paid; city bike taken from a dock (count 7 → 6, map label updated), rolled out of the slot, locked outside a dock (250 kr after 15 min), e-bike returned into a free slot with the right price (3:20 → 14 kr); delivery from the phone: order at Kiwi, door with its number on Siloveien 2, paid 103 kr; taxi: call, boarding, a crash (mood 82 → 48, tip 7 kr), payment, getting out ends the shift. No script errors.
  - Online with two players on a local lobby server: a scooter left by one is exactly there for the other (live and after joining); the other sees the taxi light and the passenger in the back seat; the friend riding along got half of the fare (44 of 87 kr); a locked city bike cannot be taken by the other.
  - Cost: about 6 draw calls per scooter or bike in view (with shadows), 3 per dock.
- **Not checked:** a real DualShock 4, the look and sound on a real screen, real players in different homes.
- **Status:** merged into `main` ([PR #62](https://github.com/jonatsl/haarklous-online/pull/62), 9bdda69) and live (Worker version a218d9f4, 3 Nov 2026). Issues #56 and #57 are closed.

### 2026-11-03 · `main` is live (PR #50, the catacomb)
- **What:** the catacomb (PR #50, issue #43) is merged into `main` (85841c8) and deployed (Cloudflare Worker version cfea339d).
  - Deployed from this session's own worktree at the merge commit, with `cloud/` packages installed by `npm ci`.
  - The first deploy try was blocked by Claude Code's permission check until the user asked for it.
- **Why:** the user said "Merge 50", then "All merged things should be deployed now" (3 Nov 2026).
- **Checked:**
  - `node --test tests/*.cjs`: 102 pass on the merged `main`.
  - The live page is byte-for-byte the build, and `/weather` answers 200.
  - The live game loads the catacomb (66 chunks), Klatreverket, the kayak and the Ensjø run, with no console errors.
- **Status:** live.

### 2026-11-03 · `main` is live (PR #49)
- **What:** Klatreverket Torshov (PR #49, issue #40) is merged into `main` and deployed (Cloudflare Worker version 6b288cd0).
  - Deployed from a clean worktree of the merged `main` (102a042), with `cloud/` packages installed by `npm ci`.
- **Why:** the user said "Merge this then" (3 Nov 2026), answering whether to merge and deploy PR #49.
- **Checked:**
  - `node --test tests/*.cjs`: 93 pass on the merged `main`.
  - The live page is byte-for-byte the build (apart from line endings); `/weather` answers 200.
  - The live game loads with Klatreverket (112 routes), the Gamle Oslo and Myrens ground and the kayak.
- **Status:** live.

### 2026-11-03 · A large catacomb with three entrances (issue #43)
- **What:**
  - **Three entrances, about 100 m apart, marked ☠ on the map:**
    - North: the petanque lawn.
    - West: the west side of Torshovdalen.
    - South: the big lawn north of HODET N.N.
    - The doors are 86–111 m apart.
    - Each is a small stone mausoleum (sign *KATAKOMBENE*, a stone skull, an open iron gate). A straight stone stair (27–35 m long, about 30°, with a half landing) goes down 14–19 m to an entrance hall.
  - **The catacomb:** about 1.5 km of galleries on a 2 m grid, 11 rooms and halls, all connected, so every entrance leads everywhere. About half is lit, half dark.
    - **Lit parts** (85 torches on the walls, with real flickering flames):
      - Bone galleries: stacked long bones with two rows of skulls set in them and one on top, as in Paris.
      - The rotunda, with a pillar of bones ringed with skulls.
      - Two chapels with skull altars and candles, and the hall of skulls with columns.
      - The crypt, with a sarcophagus and candles.
      - Carved tablets: *STANS! HER BEGYNNER DØDENS RIKE* in each entrance hall, *MEMENTO MORI*, and the names of the streets above (like the street plaques in Paris).
    - **Dark parts:** old quarry tunnels with timber props, blind side galleries with loose bones and cobwebs, the collapsed quarry, the quarrymen's room and well.
  - **Torch:** where it is dark the prompt says "□ / L1 Switch on your torch". L1 / Q switches it on and off anywhere underground. It goes off when you come back up.
  - **Map:** underground the map is wiped. It shows only the catacomb cells you have seen (line of sight, further where it is lit or your torch is on), the torches you saw, the rooms' names and the three ways out. The minimap shows the same. What you have seen is kept in this browser.
  - **Sound:** no music underground; dripping water with echo, a low hum, torches crackling, footsteps on stone with echo.
- **Why:**
  - The user's issue #43: "a large catacomb with three entrances … 100 meters between the entrances … marked on the map … real-looking skulls … lit up with real fire sticks on the wall, other darker places a button for torch … the map should be wiped, and a new map should form … based on where you have been".
  - Decided here:
    - "Torch" for the dark parts is a hand torch (a beam of light).
    - The explored map is kept between visits.
    - The entrances stand on open lawns that tests keep clear of paths, trees, lamps, buildings and the other places.
- **How (in short):**
  - The torch light is worked out once, at load, for every corner of the walls, with line of sight in the tunnels, and stored in the geometry. The game adds no three.js lights, so nothing changes for the rest of the world's shaders.
  - Deep down, the world above, the far scene and the sun's shadows are not drawn.
  - Skulls are instanced in three levels of detail (the 32 nearest in full detail).
- **Where:**
  - `catacomb-layout.js`: the plan, stairs, collision, map memory; pure, Node-tested.
  - `game-catacomb.js`: geometry, textures, light, torch, map layer, sound.
  - `catacomb-models.js`: skulls, femurs and the bone-wall texture, made by a helper agent.
  - `game-main.js`: holes in the ground, floors and walls, the prompt, the map layer, the underground rendering.
  - `game-map.js`: draws the layer instead of the street map.
  - `index.html`: scripts and the controls text.
  - `tests/catacomb.test.cjs`.
- **Checked:**
  - Node tests 73/73 (9 new). The new tests walk in through each door and down each stair with the game's collision code. They also check the 100 m spacing, rock cover over every gallery, connectivity and the map memory.
  - In the browser (simulated controller): walked down the north stair to the hall; the map switched; the dark tunnel showed the prompt and □ lit the torch; screenshots of the mausoleum, the ossuary, the rotunda, the crypt and the Sacellum.
  - Underground about 100 draw calls and 0.8 M triangles. On the surface by the mausoleums it is 1.2 k calls and 1.6 M triangles, as before.
  - Not checked: frame rate on the user's PC (the browser pane was hidden), and sound by ear.
- **Status:** merged into `main` ([PR #50](https://github.com/jonatsl/haarklous-online/pull/50), 85841c8) and live (Worker version cfea339d, 3 Nov 2026).

### 2026-11-03 · `main` is live (PR #51)
- **What:** Grünerløkka (PR #51: Akerselva kayak, table tennis at Schous plass, Deichman Grünerløkka and its librarian, Rathkes gate 1) is merged into `main` and deployed (Cloudflare Worker version ddf8bd0a). Issues #44, #45 and #47 are closed.
  - Deployed from this session's own worktree at the merge commit (131d8e5). `main` had not moved since PR #48, so the merge holds only PR #51.
- **Why:** the user asked to make a PR and merge it when done (3 Nov 2026); `AGENTS.md` asks for a redeploy after game changes.
- **Other open PRs:** #49 (Klatreverket, the Myrens patch) and #50 (catacomb) need a routine merge of `main`: PR #51 added lines next to theirs in `game-main.js` (right after the districts are decoded, the floor and obstacle lists, findPrompt, the test handle), `index.html`, `README.md` and this log. When #49 is in, the kayak uses its ground on the Sagene stretch by itself.
- **Checked:** the live page is byte-for-byte the build; `/weather` answers 200; the live game loads the library (12,580 books), the table, the gate and the three kayak racks, with no console errors.
- **Status:** live.

### 2026-11-03 · Grünerløkka: Akerselva kayak, Schous plass, Deichman, Rathkes gate 1 (issues #44, #45, #47)
- **What:**
  - **Kayak on Akerselva (#45):** three racks (Bjølsen 4.7 km, Sagene 2.6 km, Grünerløkka 0.9 km to go). Left stick ↑ / W paddle, ↓ / S back, ←→ / A D turn (the user's wish); look with the right stick / mouse; R3 / V view from behind; □ out on a bank. The real river from OpenStreetMap and Kartverket: course, width, water level, 81 m of drop with ten falls (white water, splash, shake), 46 bridges you can paddle under and walk or drive over. The run ends at Vaterland before the culvert; best times kept; 40 kr a finish, 80 kr a new best. Other players see you in your kayak.
  - **Table tennis at Schous plass (#44):** an outdoor concrete table in the park, played against Ola: real rules (to 11, two serves each, win by two, serve bounces on your side first, net, out, double bounce); R2 swings with timing, the camera aims, L2 smashes; 60 kr for a win. OpenStreetMap has no table mapped there, so the place in the park is my choice.
  - **Deichman Grünerløkka (#44):** the 1914 library hall at its real place (white plaster, small-paned windows, black tiled hip roof, entrance gable with steps, after a photo on Wikimedia Commons), with wall shelves, rows of shelves, about 12,600 plain books, reading tables, Serieteket's comics corner and the librarian's desk. *The Inner Game of Tennis* (W. Timothy Gallwey) is the one book with a printed spine; □ shows its front cover and a short summary. *Moby-Dick* lies on a reading table as a green cloth-bound book; □ opens it at chapter 1: "Call me Ishmael." (public domain text).
  - **The librarian (#47):** glasses, curly hair, a scarf. Run inside – or talk loudly on voice chat there – and she comes at you, shushes you ("Hysj! Ikke løp i biblioteket!") and walks back to her desk; after a shush you can only walk for 5 s. Other players' running and voices count too.
  - **Rathkes gate 1C (#44, preparation):** checked on Google Street View: the way into the backyard is the iron gate under the "1" at the east end of the façade. In the game: that gate (□ opens both leaves), the passage under the building, the backyard and the doors 1B and 1C ("5. etg · kommer"). What the photos are needed for is in `docs/RATHKES-1C.md`.
- **Why:** issues #44, #45 and #47 (the user, 2 Nov 2026), done together at the user's request (3 Nov 2026: "implement issue 44-47 … make sure you note the other ongoing workflows to not collude with them"). #46 is not an issue but the waypoint/minimap PR from another session (already merged).
- **Not copied:** the real cover art of *The Inner Game of Tennis* belongs to its publisher, so the game draws a look-alike typographic cover (title, author, a tennis ball). A photo of the user's own copy can replace it.
- **Working beside the other sessions:** all places are in the Gamle Oslo patch (PR #48), so this branch was built on it and uses its prepare hook (drop or change a decoded building, lower the ground) without touching its files. The river also runs through the Myrens patch of the Klatreverket session (PR #49, widened to x −1200…−688, s −176…560 for this, agreed by message); until that patch is on `main` the kayak draws simple banks there. The river bed stays 6 m and more from the climbing hall.
- **Where:** `game-kayak.js`, `akerselva-data.js`, `tools/make-akerselva.py`, `assets/osm/akerselva-*`, `game-library.js`, `game-tabletennis.js`, `game-rathkes.js`, `game-main.js` (prepare step, modules, `kayak` mode, prompts, `grunerTick`, online state), `game-voice.js` (voice levels), `game-audio.js` (new sounds), `index.html`, `README.md`, `docs/HANDOFF.md`, `docs/RATHKES-1C.md`, `tests/grunerlokka.test.cjs`.
- **Checked:**
  - Node tests 84/84 (13 new): all three runs paddled to Vaterland inside the banks, bed lowering, library paths, the librarian's chase / shush / return, serve order and legal serves, the net, the Rathkes split.
  - In the browser: the library outside and inside, both books (cover; "Call me Ishmael."), the librarian chasing and shushing a runner and walking back, a table-tennis rally with Ola, kayaking from Sagene and Grünerløkka (water, banks, bridges, HUD), the gate opening, the passage and the 1C prompt. No script errors.
- **Not checked:** a real DualShock 4, a real microphone for the loudness check, two real players online.
- **Status:** PR #51 (https://github.com/jonatsl/haarklous-online/pull/51), merged into `main` and live (Worker version ddf8bd0a).

### 2026-11-03 · `main` is live (PR #48)
- **What:** Gamle Oslo, Ensjø and the way there (PR #48) is merged into `main` and deployed (Cloudflare Worker version ea397923).
  - Deployed from this session's own worktree at the PR's last commit. `main` had not moved since PR #46, so the merged `main` builds to the same page.
  - Before that the live page was checked to be exactly `main` (PR #46), so nothing else went live with it.
- **Why:** the user asked to merge and deploy "if possible and not colliding with anything else" (3 Nov 2026).
- **Other open PRs:**
  - PR #49 (Klatreverket) is built on PR #48, so it now shows only its own changes.
  - PR #50 (catacomb) and PR #48 both added lines at the same places in `game-main.js`, `index.html`, `README.md` and this log. They are side by side, not overlapping, so #50 needs a routine merge of `main`.
  - The one link to keep when merging #50: its `cutsGround` check goes into the height of every floor in `groundFloors` (`world.terrainFloors().map(...)`), where #48 had replaced the single `groundFloor`.
- **Checked:**
  - The live page is byte-for-byte the build (apart from line endings).
  - `/weather` and `/api/auth/get-session` answer 200.
  - The live game starts, goes online with a lobby code, and has the district (7,938 buildings, 9 key buildings) and the run's prompt at Ensjø.
  - The only console error is the old missing favicon.
- **Status:** live.

### 2026-11-03 · Klatreverket Torshov: bouldering and rope climbing at the real climbing centre (issue #40)
- **What:**
  - Klatreverket Torshov at its real place, Myrens verksted 3K: OSM way 1031709261 (Kartverket building 80554273), shared in real life with Myrens Treningssenter. The OSM node of the gym is inside it.
  - The building's roof heights are Kartverket's surface model (DOM). The hall wing is 60.2 × 19.8 m, with the eaves 14.5 m above the floor (the floor is at street level by the entrance), so the walls are 14 m like the real ones.
  - Inside, after klatreverket.no:
    - Hallen: 14 m walls with different steepness and top-ropes on about half the routes.
    - Konkurranseveggen: 14 m high, 7 m overhanging, lead only.
    - Galleriet and Kursrommet: 10 m walls with a top-rope on every route.
    - The 2026 autobelay tower: six 14 m lines.
    - Bouldering on three floors: Hula (a roof cave, easier grades), Discorommet (3.5 m walls) with the slab corner, the inner room (harder problems).
    - The training room on the 4th floor: Moonwall 40° with LED problems, Vippevegg, system wall, technique corner, campus ladder, hangboard.
    - Reception with Klatresjappa, the price board, the receptionist, and Siri, your climbing partner.
    - 112 routes and problems, 2,406 holds, set by a seeded generator so every computer in a lobby has the same walls.
  - Real rules and prices:
    - Entry 155 kr before 16 on weekdays, 175 kr after 16 and at weekends.
    - Rent shoes 50, harness 50, chalk 20, all three 100 kr.
    - The autobelay introduction is free and needed before the autobelays.
    - You need climbing shoes on the walls and a harness on the ropes.
    - The brattkort test can only be taken when the climbing staff is on duty: after 17 on weekdays, after 11 at weekends.
    - Norwegian grades for routes, Font grades for boulders.
  - Climbing that you do with your hands:
    - Hold L2 / R2 (the mouse buttons) to grip; let go with one hand, look at the next hold and grip again.
    - Feet find footholds by themselves.
    - Reach depends on the other hand, your feet and how steep the wall is.
    - A pump meter (wall angle, hold size, one hand, feet); shaking out, chalk, jumps for far holds.
    - Off-route holds are noted.
    - Bouldering drops you on the mats.
    - Top rope with Siri belaying; lead with clipping every quickdraw and the anchor (falls twice the distance above the last clip, a ground fall when nothing is clipped); the autobelay lowers you.
    - Ticks (flash / sent / top rope / autobelay) and your best hangboard time are saved in the browser.
  - The brattkort test: three questions, then you belay Siri (take in the rope, brake when she falls, lower her). Passed, you can belay Siri whenever you like.
  - Multiplayer: others see you climbing and hanging on the rope (stances `climb`, `hang`, `belay`).
  - The ground round Myrens: a district patch 'myrens' (x -1200..-688, s -176..560) in the format of PR #48. It also closes the gap along Akerselva between the old world and Gamle Oslo, for the kayak work (issue #45). Klatreverket's prepare step drops its building from the patch and lowers the patch's ground under the hall.
  - A ramp from the street to the door (the doorstep is 16 cm up; walk floors only join within 5 cm).
- **Why:** the user's issue #40 ("Implement the climbing center at torshov and make it possible to go bouldering and normal indoor climbing there. It must be proper interactive.") and goal (2 Nov 2026): "it must be like it is in real life and at its real location."
  - The gym is about 980 m from the address, outside the old ±760 m world, so it needed the district patch format of PR #48 (agreed with the Gamle Oslo session: it made the format, this branch adds the Myrens patch).
  - The routes are not the real gym's routes (those change every Tuesday and Thursday); the rooms, heights, rules and prices are the real ones.
- **Fixed on the way:** `tools/make-district.py` set the height reference from rows outside a patch west of the old grid. The Myrens ground came out 17 m wrong; it now uses the old grid inside the patch's box. Gamle Oslo is unchanged, and the fix is on PR #48 too.
- **Where:** `game-climbing.js` (new), `climbing-data.js` and `tools/make-climbing.py` (new), `myrens-data.js` and `assets/osm/myrens-*` (new, from `tools/fetch-district.py` / `tools/make-district.py`), `game-main.js`, `game-avatars.js`, `game-multiplayer.js`, `index.html`, `style.css`, `tools/make-district.py`, `tests/climbing.test.cjs` (new), `README.md`, `docs/HANDOFF.md`.
- **Checked:**
  - `node --test tests/*.cjs`: 80 pass. New tests:
    - the real building, heights and floor;
    - prices, the staff hours and the opening hours;
    - wall heights and that every wall fits in the building;
    - the same routes on every computer;
    - a climbing robot using the game's own climber reaches the top of all 112 lines, clipping every bolt on lead;
    - top-rope, lead, autobelay and boulder falls; lowering;
    - the prepare step;
    - the belay test passes a careful belayer and fails a careless one.
  - In the browser (simulated controller, offline, about 70 fps in the hall):
    - paid and rented at the reception (255 kr);
    - a Hula boulder sent with L2 / R2 and dropped onto the mat;
    - a Galleriet top-rope sent, taken and lowered;
    - Konkurranseveggen led with 11 / 11 clips and the anchor;
    - a lead fall 1.75 m above the last clip caught after 5.5 m, then climbed on from the rope;
    - autobelay;
    - a Moonwall problem lit and sent;
    - the brattkort test passed;
    - walked from the old world over the seam at x -760 into the Myrens patch, and from the street up the ramp into the lobby.
  - Not checked: a real DualShock 4, real frame rate on the user's PC, two real players climbing together online.
- **Status:** on `main` (PR #49, merged 3 Nov 2026 with the user's OK) and live (Worker version 6b288cd0).

### 2026-11-02 · Gamle Oslo, Ensjø and the way there (issue #38)
- **What:**
  - A new "district patch" of the world south of the old ±800 m square: local x −1600…1792, s 560…4000 (3.4 × 3.4 km), walkable to 40 m inside its edges. It runs from Carl Berner down Trondheimsveien to Sofienberg and Schous plass, and through Rodeløkka, Tøyen, Kampen, Vålerenga, Ensjø, the edge of Helsfyr, Grønland, Gamlebyen and Bjørvika to the fjord.
  - Real ground heights: Kartverket's 2 m terrain model on an 8 m grid. Where it overlaps the old 4 m grid it copies its values exactly, so there is no seam (tested). Real steep places such as Kampen's rock face and the Akerselva ravine are kept.
  - Real streets, paths, tram and rail lines, parks, grass, woods, water, pitches and parking from OpenStreetMap, painted on the ground (or the Esri aerial photo, which loads when you come within 700 m) and drawn on the map and minimap.
  - About 7,900 buildings in their real places: OpenStreetMap footprints, heights from their storey counts (about half have them) or a default per building type. Brick blocks get Torshov's facade and hip roofs, other buildings plaster with windows, tall ones glass bands, halls ribbed metal. Shapes are simple, not exact copies, as the user allowed.
  - Key buildings modelled on their real footprints (`game-landmarks.js`): Sofienberg, Paulus, Kampen, Vålerenga, Grønland, Gamlebyen and Tøyen churches (brick nave with arched windows, steep roof, tower with clocks and spire at the narrow end of the footprint), MUNCH (60 m, the top bends toward the fjord, red sign), the Opera (white roof you can walk up from the plaza to 32 m, glass walls, stage tower) and eight tall chimneys (Freiapipa 50 m, Ringnespipa 40 m …). Oslo Plaza (117 m) and Posthuset (111 m) get their real heights. Sizes and colours are estimates (±20 %).
  - Parks are real but light: the ~9,700 mapped trees with lighter crowns (26 leaf cards instead of 70); far away only within 1.1 km.
  - The fjord: a water surface where the terrain model is at sea level, minus every mapped building and land area (the model is older than the newest quays). You stop at the quay.
  - **Ensjø → Rathkes gate run** (`game-route.js`): green ring outside Ensjø T-bane, □ starts the clock; the chequered ring in Rathkes gate stops it. Any way counts. Best time in the browser (`haarklous-route-v1`), 30 kr per finish, 60 kr for a new best, □ at the finish takes you back to the start.
  - Photos taken in the district are named after the nearest neighbourhood (Ensjø, Kampen, Vålerenga …).
- **Why:**
  - Issue #38: "Make Ensjø part of the game … explore my own part of the city, namely Gamle Oslo … practice the most effective way from Ensjø to Ratkhes".
  - The user (2 Nov 2026): real streets, topography and buildings in the correct positions but not exact copies; some key buildings modelled; parks real and light; the area in between lighter but with real topography; at least the buildings down Trondheimsveien.
  - Trondheimsveien does not reach Gamle Oslo itself: from Sinsen it runs through Carl Berner to Schous plass at Grünerløkka. Gamle Oslo and Ensjø lie south of that, so the patch covers both, and every building in between is in (a test checks there is a building within 45 m of every 100 m of Trondheimsveien).
  - Rathkes gate is on Rodeløkka by Sofienbergparken (not in Torshov), 1.5 km from Ensjø as the crow flies and 55 m lower.
- **How it fits in:**
  - `surroundings-data.js` is not changed (1,040 buildings, 1,057 roads), so the seeded parked vehicles and their numbers online stay the same.
  - New data and code: `tools/fetch-district.py` (OpenStreetMap + Kartverket download into `assets/osm/gamle-oslo-*`), `tools/make-district.py` (writes `gamle-oslo-data.js`, 1.2 MB), `district.js` (decoder, Node-tested), `surroundings.js` (district ground tiles, buildings, trees, sea, imagery, collision, footsteps, traffic sound), `game-landmarks.js`, `game-route.js`.
  - `game-main.js`: the patches are decoded, then built; walk and vehicle worlds get one ground floor per patch through `groundAt`; the map gets the district in the same lists as before.
  - The tools take a name and a box, so other places can be added as more patches (the climbing-gym session plans one for Myrens verksted).
- **Also fixed on the way:** the distant hills ring started 2.6 km from home, which is now inside the world; it now starts 400 m beyond the ground data in each direction, from the apron's own height. The flat land far away now lies 2 m below sea level instead of below Torshov's lowest point, so the fjord does not float above the new sea.
- **Tool fix from the climbing-gym session (issue #40):** `make-district.py` took its height reference from the old grid's rows at s 600–800, which a patch elsewhere does not reach (its Myrens patch came out 17 m off). A patch now uses those rows only when they are inside its box, else the old grid's points inside its box, else the old data's door height. Gamle Oslo's data is byte-for-byte the same.
- **Performance:** in the district a frame has 140–210 draw calls and 0.3–1.3 million triangles (home has about 2,800 calls and 1.2–2.3 million). At home the district adds up to 0.35 million triangles when you look toward it. Timing on this PC was too noisy (other sessions share the GPU) for a reliable fps figure.
- **Checked:**
  - Node tests (`tests/district.test.cjs`, 7 new).
  - In a browser: crossing the old edge on foot along Trondheimsveien, buildings block you, the Opera roof climbed 28.7 m, the run started, timed, finished, paid, saved and sent you back to Ensjø, the aerial photo loads in about 5 s, and the map shows the district.
  - Not checked: a real controller, the frame rate on the user's PC, online play with others in the district.
- **Where:** `tools/fetch-district.py`, `tools/make-district.py`, `assets/osm/gamle-oslo-*`, `gamle-oslo-data.js`, `district.js`, `surroundings.js`, `game-landmarks.js`, `game-route.js`, `game-main.js`, `index.html`, `README.md`, `tests/district.test.cjs`, `docs/HANDOFF.md`.
- **Status:** PR #48, merged into `main` and live (Worker version ea397923, 3 Nov 2026).

### 2026-11-02 · Map waypoint and an optional minimap (issues #41 and #42)
- **What:**
  - **Waypoint (#41):** on the map, ✕ / Space sets a waypoint at the cross in the middle, and a left click sets it where you click. ✕ or a click on it again, □ / E or Delete removes it.
    - The map shows it as a purple pin, with a dashed line from you and the distance.
    - Back in the game a purple pin with the distance stays on the place. When the place is off screen or behind you, the pin waits at the screen edge with a small arrow toward it.
    - Within 7 m it goes away and "Waypoint reached." shows.
  - **Minimap (#42):** pause menu → *Minimap* (or D-pad ↓ in the pause menu). Off at first; the choice is saved in the browser.
    - Round, in the bottom-left corner, dark like GTA IV's: grey roads (big roads lighter), dim buildings, your own building orange, parks dark green, water dark blue.
    - It turns with the camera: the way you look is up, and N on the rim shows north. You are the white arrow, places from the map are coloured dots, players in your lobby are arrows in their colour (on the rim when far away), the waypoint is the purple pin (on the rim when out of range).
    - About 90 m around you on foot; it zooms out with speed and height, up to 300 m. It hides while the photo camera is out.
    - Things that sat in that corner move: the chat moves up; the minigame cards, the mission's health, paintball's team line and the drone's flight data move to the right of it.
  - **Faster big map:** it now draws only what is in view, and keeps the picture while you don't pan or zoom. The Gamle Oslo work (issue #38) will make the map data about ten times bigger.
  - **Ready for the catacomb (issue #43):** a `map.layer` switch agreed with that work. Underground the minimap shows the catacomb's own map, and the waypoint can't be set, its pin is hidden and it waits for you on the surface.
- **Why:**
  - The user's issues: #41 "Add waypoint and follow it" (a purple pointer, clear but not too distracting, until you are within 7 m) and #42 "Add optional minimap" (toggled in the menu, round like GTA IV's, in the same corner).
  - The pin is small (20 px, 88 % opacity) and only shows the distance, so it is clear without being in the way.
  - The minimap draws the map data once into 200 m tiles (at most two new tiles a frame, the 64 last used are kept) and only turns the tiles. Measured: about 0.1 ms a frame.
  - Opening the map now frees the mouse pointer so you can click on the map; closing it takes the pointer back.
- **Where:** `game-map.js` (waypoint, on-screen pin, minimap, faster big map), `game-main.js` (✕ / □ on the map, D-pad ↓ in the pause menu, `updateGuide()` once a frame), `index.html` (pause-menu checkbox, start-screen controls), `style.css`, `tests/map.test.cjs`, `README.md`, `docs/HANDOFF.md`.
- **Checked:**
  - Node tests 64/64, 5 of them new (pin on the screen edge, "behind you" points down, the rim, distance text, minimap range).
  - In the browser with a simulated controller and real mouse clicks:
    - ✕ sets the waypoint at the cross; a click sets it where you click; a click on the pin, ✕ again, □ and Delete remove it.
    - Looking at it, the pin sits on the place (76 m); with the place to your left, the pin is at the left edge with an arrow.
    - Walking up to it removed it at 6.7 m and showed "Waypoint reached."
    - Minimap: on and off with D-pad ↓ and with the checkbox (saved), turns with the camera, zooms out in a car, hides with the photo camera, follows the drone. The chat, the disc golf card and the drone's flight data no longer overlap it.
    - Big map: 0.14 ms a frame when still, 2.7 ms while panning. No script errors.
  - Not checked: a real DualShock 4, and a real mouse with pointer lock (the browser pane cannot lock the pointer).
- **Status:** on `main` (PR #46, merged 2 Nov 2026 with the user's OK) and live (Cloudflare Worker version 82250255).
  - Deployed from this branch's clean worktree (the same code as the merge; `main` had not changed since the branch started), with `cloud/` packages installed by `npm ci`.
  - The live page is byte-for-byte the local build. On the live site the game joined a lobby, loaded the real weather, and showed the minimap and the waypoint pin (63 m, at the screen edge), with no console errors.

### 2026-11-01 · `main` is live (PRs #36 and #37)
- **What:** the game's pilot for the Caravan (PR #36) and the sign-up fix (PR #37) are merged into `main` and deployed (Cloudflare Worker version 43457da0).
  - Deployed from a clean worktree of the merged code (not the shared folder), with `cloud/` packages installed by `npm ci`.
  - In Supabase: the 30 s idle-transaction limit for `haarklous_worker` is set, and the hung sign-up's connection was ended.
- **Why:** the user approved merging both, deploying, and the two database steps (1 Nov 2026).
- **Checked:**
  - The live page is byte-for-byte the local build.
  - `/api/auth/get-session` answers 200 in about 0.6 s.
  - The live game starts, joins a lobby, shows the real weather and the account form, and has the game's pilot. No console errors.
  - A real sign-up is the user's own (Claude does not create accounts on the live site).
- **Status:** live.

### 2026-11-01 · Accounts: sign-up no longer hangs on "Wait…"
- **What:**
  - Creating an account works: the Worker now opens two database connections per request instead of one.
  - The pause menu gives up after 20 s with "The account server did not answer – try again in a moment.", so the button can never stay on "Wait…".
  - The database ends a transaction a stuck request leaves open after 30 s (`idle_in_transaction_session_timeout` for `haarklous_worker`, in `cloud/sql/accounts.sql`).
- **Why:**
  - The user: "i put in my email and password and username but it just says wait".
  - Better Auth (1.7.15) runs sign-up inside a database transaction, which holds a connection from the pool. Inside it, it asks for the password hash, which is a query too (Postgres bcrypt).
  - With a pool of one connection, the hash waited for the transaction's connection and the transaction waited for the hash: every sign-up hung.
  - Log-in has no transaction, which is why the earlier live test (an unknown email) answered.
  - The other session (accounts) checked Supabase: 0 users, and one `haarklous_worker` connection "idle in transaction", the hung sign-up. It had only looked up the email, so nothing was saved.
- **Where:** `cloud/src/auth.js` (pool `max: 2`), `game-account.js` (time limit), `cloud/sql/accounts.sql`, `tests/account.test.cjs`.
- **Checked:**
  - Node tests 57/57, including a new one: a server that never answers gives the "did not answer" message and the form is ready again.
  - Better Auth's code (`api/routes/sign-up.mjs` line 144: `runWithTransaction`, line 214: `password.hash`, both inside) confirms the order.
  - The real sign-up can only be tried on the live site, by the user (Claude does not create accounts there).
- **Status:** on `main` (PR #37, merged 1 Nov 2026 with the user's OK) and live (Worker version 43457da0). The SQL change is applied (`haarklous_worker` has `idle_in_transaction_session_timeout=30s`), and the stuck connection (pid 12455, idle in a transaction for 522 s after the email lookup) was ended. There were 0 users, so nothing was lost.

### 2026-11-01 · Skydiving: the game's pilot, jumping out of the plane you fly, and getting off on the ground
- **What:**
  - **Bug fix:** in a jump seat, □ now gets you off while the plane stands still (the prompt showed, but nothing listened to □ there).
  - **The game's pilot:** in the Caravan's jump seats, △ / F calls a pilot from the game.
    - It waits 10 s for others to board and taxis onto the strip, 26 m from its north end.
    - It waits there while the scheduled jump flight is boarding or rolling ahead, so the two planes stay at least about 200 m apart.
    - Then it flies the scheduled flight's climb to 3000 m and jump run with the green light, and flies home.
    - With nobody aboard it is called off on the ground, or flies home after 30 s in the air (the Caravan reappears at its place).
    - A pilot (white shirt) sits in the left seat on every screen.
  - **Jump from the plane you fly:** in the Caravan's cockpit, ✕ / Space above 300 m hands the controls to the game's pilot and you jump. △ / F hands over and sends you to the back.
    - In the air the game's pilot circles level (radius 650 m, toward home, at least 300 m up). So one player alone can fly up and jump.
  - **Multiplayer:**
    - The computer that calls the game's pilot holds the Caravan's driver seat and sends its position, like a player flying it.
    - If the plane has no pilot in the air (that player left), a jumper's computer takes over within about 2 s.
- **Fixes found while testing with two players:**
  - On other players' screens a plane's "on the ground" flag was eased between updates and never reached "in the air", so jumpers in a Caravan flown by someone else could never jump. It is no longer eased.
  - On other players' screens the jump seat camera trailed the plane by a frame (about 1 m at climb speed, behind the cabin wall in the back seats). It is now placed after the plane has moved.
  - Other players in jump seats now face the tail on your screen too.
  - The Caravan stays visible from far away (it vanished 170 m after you jumped).
  - Planes rolling for take-off now follow the slope of the strip (they floated up to 1.3 m above it).
- **Why:** the user (1 Nov 2026):
  - "i cant exit the plane when having entered it as a jumper when its on the ground."
  - "I also want to be able to choose to have the plane flown by a pilot provided by the game."
  - "If only one player, it should be possible to fly the plane and jump out of it as a skydiver."
  - The pilot uses the scheduled flight's path (sped-up climb) so it is predictable and the same for everyone. It taxis to a hold point behind the scheduled flight's boarding place, because both planes have 16 m wings and the Caravan's parking spot has trees straight ahead.
- **Where:**
  - `game-skydive.js` (`pilotGround`, `pilotOrbit`, `pilotFlight`, `clearToRoll`; `plan` follows the ground).
  - `game-main.js` (the game's pilot, hand-over, □ / △ in the jump seat, the pilot in the left seat, HUD, prompts).
  - `game-multiplayer.js` (the on-ground flag, seat facing, a granted seat counts at once).
  - `game-aircraft.js` (the Caravan's view distance and seat facing).
  - `tests/skydive.test.cjs`, `README.md`, `index.html`, `docs/HANDOFF.md`.
- **Checked:**
  - Node tests 59/59 after merging `main` (with the account tests). New tests:
    - the ground flight: waits, taxis, holds behind the jump flight, takes off, climbs to 3000 m without jumps;
    - the wheels stay on a sloping strip;
    - the taxi never passes the scheduled flight's boarding place;
    - the in-air pilot starts where the plane is and circles level at least 300 m up.
  - In the browser, alone:
    - □ gets you off the Caravan and the boarding jump flight;
    - △ calls the game's pilot: it waits, taxis and rolls, climbs to 1180 m, then 2960 m with the green light; ✕ jumps;
    - with nobody aboard it went home after 30 s;
    - flying it yourself at 600 m, ✕ jumped and the pilot circled at about 620 m;
    - △ in the cockpit on the ground sent you to the back;
    - getting off before take-off called it off.
  - With two players in one lobby:
    - the second player boarded, saw the pilot and the countdown, sat facing the tail, and could jump at 1289 m;
    - when the first player's tab closed at about 1300 m, the second player's computer took over and kept circling.
- **Status:** on `main` (PR #36, merged 1 Nov 2026 with the user's OK) and live (Worker version 43457da0).

### 2026-11-01 · Player accounts with email and password (Better Auth + Supabase)
- **What:** an optional **Account** section in the pause menu: create an account (player name, email, password of at least 8 characters), log in, log out. You stay logged in for 30 days. When logged in, your account name becomes your name in the lobbies. Playing still needs no account, and the offline file shows where accounts work.
  - The Worker runs Better Auth at `/api/auth/*`. Accounts are stored in the Supabase project "Haarklous Online" (ref `sxhqirmecalxcnyojjki`, Ireland), in the schema `game_auth` (tables `user`, `session`, `account`, `verification`).
  - The Worker reaches Supabase through Cloudflare Hyperdrive (`haarklous-db`, query cache off). Workers' own network sockets do not accept Supabase's self-signed certificate.
  - The Worker logs in as its own database role `haarklous_worker`, which can use only `game_auth` and bcrypt. Its random password is made by `cloud/scripts/set-db-secret.mjs`; Postgres only ever sees its SCRAM hash, and nobody has to type or see it.
  - Passwords are hashed by Postgres (bcrypt, cost 10), not by Better Auth's scrypt in JavaScript, which uses more CPU than a free Worker gets.
  - Better Auth's rate limit: 30 tries a minute.
- **Why:** the user asked for "login with email and password using betterauth and supabase" (1 Nov 2026). The user made the Supabase organisation and project and logged the Supabase CLI in. Login is optional so the offline file and friends without an account keep working (our choice).
- **Not yet:** no email is sent, so there is no email check and no "forgot password". That needs an email service (e.g. Resend). Accounts do not save anything yet (progress, money, etc.).
- **Where:** `game-account.js` (new), `index.html`, `style.css`, `game-main.js` (pause menu), `cloud/src/auth.js` (new), `cloud/src/index.js`, `cloud/wrangler.toml` (`nodejs_compat`, Hyperdrive), `cloud/package.json` (better-auth 1.7.15, pg), `cloud/sql/accounts.sql` (applied to Supabase), `cloud/scripts/set-db-secret.mjs`, `tests/account.test.cjs`, `README.md`.
- **Checked:**
  - `node --test tests/*.cjs`: 56 pass (3 of them new, for accounts).
  - In the browser with `wrangler dev`: the pause menu shows the form, the sign-up switch works, a short password is caught, and the server answers "not set up yet" cleanly.
  - Live: `/api/auth/get-session` answers in about 0.4 s. A login with an unknown email is checked against Supabase through Hyperdrive and refused ("Wrong email or password").
  - Claude did not create accounts on the live site. The first real sign-up is the user's own.
- **Setup done (1 Nov 2026):** the user ran `node scripts/set-db-secret.mjs` (Claude Code may not write Cloudflare secrets). Hyperdrive `haarklous-db` is `64f1d3facb554856bbc528594b9df0e8`, and `BETTER_AUTH_SECRET` is set. Wrangler and the Supabase CLI are now dev dependencies in `cloud/`, because npx's download cache broke twice on this PC.
- **Mix-up, fixed the same evening:** another session was working on skydiving (the game's pilot for the Caravan) in the same folder.
  - The first deploy (Worker version a8bb1af2) and the commit "Accounts are live" picked up its unfinished changes.
  - The next commit takes them out of this branch; the skydiving work itself stays untouched on disk.
  - The site was redeployed from a clean copy of the branch (Worker version cacad9aa). The live page is byte-for-byte that clean build.
- **Status:** on `main` (PR https://github.com/jonatsl/haarklous-online/pull/34, merged 1 Nov 2026 at the user's request) and live (Worker version cacad9aa).

### 2026-11-01 · `main` is live (PRs #18, #19, #27–#33)
- **What:** the nine PRs for issues #16, #17 and #20–#26 are merged into `main` and deployed to https://haarklous-online.server-smoke.workers.dev (Cloudflare Worker version 1e8ad84e).
  - The Worker now also has the `Weather` Durable Object (migration v2) for the real weather.
- **Why:** the user approved merging all nine and redeploying (1 Nov 2026). `AGENTS.md`: after changing game files, redeploy so the online version matches.
- **Checked:**
  - The live page is byte-for-byte the local build (`cloud/public/index.html`).
  - `/weather` returns MET Norway's forecast (6 hours; 7.4 °C, fair, at the time).
  - The live game starts, shows the real weather on the pause screen, joins a lobby, and has the jump flight, the Caravan and Torshovoksen. No console errors.
- **Status:** live.

### 2026-11-01 · Skydiving (issue #22)
- **What:** you can go skydiving.
  - A Cessna 208 Caravan jump plane stands at the airstrip in Torshovdalen ("Skydiving" on the map).
  - **Jump flight:** every 8 minutes a jump flight leaves from the north end of the strip. Everybody in the lobby sees the same plane, because its path follows the lobby's shared clock.
    - □ boards while it waits (the prompt counts down).
    - It climbs in a spiral to 3000 m (the climb is sped up, about 2.5 minutes), opens the door and gives a 60-second green light: ✕ / Space jumps.
    - Anyone still on board when it flies off is put back at the airstrip.
  - **Or a player flies the Caravan:** it has the plane's flight model with the Caravan's numbers and automatic take-off flaps. Others board at the door (□) and can jump once it is above 300 m.
  - **Places:** 12 places on two benches, facing the tail; in a lobby your place is your player number.
  - **Freefall:** about 54 m/s belly down, drifted by the real wind.
    - Left stick / W A S D: track forward, back-slide, turn.
    - A beep at 1500 m and "PULL!" at 1000 m; ✕ / Space pulls.
    - The reserve opens by itself at 300 m if you are still falling fast.
  - **Canopy:** opens over 3 s, then about 10 m/s forward and 5 m/s down.
    - Toggles steer, front risers dive, and the flare (↓ / S) slows you for about 3 s and then stalls.
    - Landing: under 3.5 m/s down is soft, under 6 m/s hard, more is a crash (you get up again).
  - R3 / V gives a view from behind you.
  - **Online:** other players see you sitting in the plane, falling belly down and under a canopy in your colour.
- **Why:** the user's issue #22: "Implement skydiving in the game. Jumping from an airplane (find the most popular airplane for skydiving)."
  - The Cessna 208 Caravan is the most common jump plane at drop zones worldwide (turbine, 15+ jumpers, big door).
  - Freefall speed (about 200 km/h belly down), the 3000–4000 m jump height, the pull height of about 1000 m and the automatic reserve opener follow normal sport-parachuting practice.
  - The jump flight lets people skydive without a pilot. The flown Caravan keeps it a multiplayer thing.
- **Where:**
  - `game-skydive.js` (new: jumper physics, flight schedule, canopy model).
  - `game-aircraft.js` (`JumpPlane`, take-off flaps `flapsCl`).
  - `game-main.js` (boarding, jump seat, skydive mode, camera, HUD, map marker, Caravan help).
  - `game-multiplayer.js` (others in the jump flight, freefall and canopy poses).
  - `index.html`, `README.md`, `tests/skydive.test.cjs`, `docs/HANDOFF.md`.
- **Checked:**
  - Node tests 53/53. New: terminal speed; tracking; the AAD; the canopy flare gives a soft landing and no flare a hard one; the flight schedule is continuous and banks the right way.
  - In the browser: boarding, the climb, the green light, the jump, freefall, the canopy and a soft landing with a flare.
  - The Caravan takes off from the strip (about 110 km/h).
  - With two players online: the other player sits in the right seat in the jump flight, falls belly down, then hangs under a canopy.
  - Haze from 3000 m fixed (the near fog now thins as the view gets longer). No console errors.
- **Status:** PR #33 (branch `feat/skydiving`, on top of PR #32), closes #22. For the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/21. Merged into `main` on 1 Nov 2026 and live (the user approved PRs #18, #19 and #27–#33 together).

### 2026-11-01 · Torshovoksen at its real place (issue #20)
- **What:** Oksefontenen, the fountain with "Torshovoksen" (Asbjørg Borgfelt, unveiled 1929), stands in the middle of Hegermanns plass at OpenStreetMap node 331273417 (local −542.0, 204.3).
  - The bronze bull charges with its head low by a rock, tail curled up, facing SSW (bearing 204°) along Mastrups gate.
  - It stands on a two-tier stone pedestal in a raised basin, inside a larger basin on an octagonal paved island, with four stone lizards spouting water.
  - The island is a low step you can stand on; the basin is solid. It is on the map ("Torshovoksen").
- **Why:**
  - The user's issue #20: "The torshov bull is a popular/well known Landmark. Implement it in its real place."
  - Research (Oslo kommune's art collection OKK.00070, OSM, Wikipedia, photos):
    - the official name is Oksefontenen; "Torshovoksen" is its popular name (OSM alt_name; Skeid's supporters "Oksene" are named after it);
    - bronze bull, larvikite basins and plinth;
    - the facing is inferred from photos;
    - the sizes are estimates (±20 %); there are no published measurements.
  - The sculpture is under copyright until 2047 (Norway has no freedom of panorama for artworks), so the model is a simple likeness, not a copy, and no photos are shipped.
- **Where:** `game-sculpture.js` (`createFountain`), `game-main.js` (place, collision, map), `tests/places.test.cjs`, `README.md`, `docs/HANDOFF.md`.
- **Checked:**
  - In the game: the island sits on the street (0.05 m above the centre's ground), and the bull faces 204.0°.
  - Side and close-up screenshots: the fountain, the basins, the water arcs and the bull with its head down and tail up.
  - Node tests 48/48. New: the place matches the OSM node; the island is clear of buildings; the ring road's edge is more than 6 m from the centre.
  - No console errors.
- **Status:** PR #32 (branch `feat/torshovoksen`, on top of PR #31), closes #20. For the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/20. Merged into `main` on 1 Nov 2026 and live (the user approved PRs #18, #19 and #27–#33 together).

### 2026-11-01 · Real weather from MET Norway (yr.no's data) (issue #23)
- **What:** the game shows the real weather at Haarklous plass.
  - Clouds dim the sun and grey the sky (more and greyer clouds in the sky shader).
  - Fog thickens the haze.
  - Rain, sleet or snow falls around you outdoors (not indoors), slanted by the real wind.
  - The wind sounds stronger or weaker with the real wind speed, and rain has its own sound.
  - The pause screen says e.g. "7.9 °C · partly cloudy · wind 4.6 m/s from NNE", credits MET Norway (CC BY 4.0) and shows when it was fetched. A short notice shows it when the game starts.
  - It is fetched when the game starts and every hour plus a random 0–10 minutes, and it steps on to the next hour by itself. Without internet the game keeps its sunny day.
- **Why:**
  - The user's issue #23: "Get real weather in-game from yr.no and use it in-game. Update every hour."
  - yr.no's forecasts come from MET Norway's open API (api.met.no). MET's terms:
    - browsers should not call it directly;
    - every request must identify the app in the User-Agent (which browsers cannot set);
    - never ask again before the answer's Expires time;
    - credit "MET Norway", not "yr".
  - So the game's own Cloudflare Worker fetches it once for everybody (a `Weather` Durable Object keeps the answer), and the game asks the Worker.
  - The Worker sends the User-Agent "haarklous-online/1.0 https://haarklous-online.server-smoke.workers.dev". MET also asks for a contact email or website; none is added yet (the user decides).
- **Where:** `cloud/src/index.js` (`/weather`, `class Weather`), `cloud/wrangler.toml` (binding, migration v2), `game-weather.js` (new), `game-main.js` (`applyWeather`, update, audio), `surroundings.js` (`setOvercast`, sky shader), `game-audio.js` (rain sound, wind by speed), `index.html` (pause-screen line), `tests/weather.test.cjs` (new), `.claude/launch.json` (local Worker), `README.md`, `docs/HANDOFF.md`.
- **Checked:**
  - The local Worker (`wrangler dev`) fetched the real forecast: 7.9 °C, 47 % cloud, partly cloudy, wind 4.6 m/s from 16°. The second request came from the cache (max-age about 1900 s), with CORS.
  - In the game with that data: sun 3.4 → 2.4, sky 49 % overcast, fog a little thicker, the notice and the pause line.
  - Made-up heavy rain (8 m/s wind) and snow: screenshots show slanted rain streaks and soft round snowflakes; none inside the flat.
  - Node tests 47/47 (3 new: MET symbols incl. their odd spellings, picking the hour, the text). No console errors.
  - Not live until the Worker is deployed with the new Durable Object.
- **Status:** PR #31 (branch `feat/real-weather`, on top of PR #30), closes #23. For the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/19. Merged into `main` on 1 Nov 2026 and live (the user approved PRs #18, #19 and #27–#33 together).

### 2026-11-01 · Paintball: players no longer look as if they are under the ground (issue #26)
- **What:** the paintball yard's ground mesh is now cut out under the yard, as it is under the construction site's soil, so only the yard's flat floor and its retaining walls are there.
  - Before, the hillside's ground was still drawn through the yard: half the yard had ground above the floor, up to 4.6 m, mostly at the red end.
  - A player standing correctly on the floor there (feet −27.05 m) had the ground drawn 3.8 m above their feet, so opponents seemed to be under the ground.
- **Why:** the user's issue #26: "When playing paintball sometimes the opposing players appear to be under ground. Check through how this works, reproduce and fix."
  - Reproduced with three browser tabs in one online paintball game: positions and the network were right (every player's feet at the floor height on every screen).
  - The yard sits in a slope (its ground goes from 3.9 m below to 5.1 m above the floor), and the old place had the same problem (up to 4.9 m).
- **Where:** `game-main.js` (a `cutGround` hole for the exact yard rectangle; the slightly larger tree-free hole stays).
- **Checked:**
  - 0 ground triangles left inside the yard (near and outer ground).
  - 9 sight lines at 1.2 m across the yard from the blue base to the red base: none blocked by ground.
  - Screenshots from the blue base (flat floor all the way) and from the high corner outside (the hill meets the retaining walls, no gaps).
  - Node tests 44/44.
- **Status:** PR #30 (branch `fix/paintball-ground`, on top of PR #29), closes #26. For the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/18. Merged into `main` on 1 Nov 2026 and live (the user approved PRs #18, #19 and #27–#33 together).

### 2026-11-01 · Paintball: only your team-mates' name tags (issue #25)
- **What:** during a paintball game you see the name tags of your own team only. Your opponents' names are hidden, so you have to spot them. In the paintball lobby and everywhere else, all name tags show as before.
- **Why:** the user's issue #25: "See only the same team players' name tags".
- **Where:** `game-avatars.js` (`update(dt, camera, showTag)`), `game-multiplayer.js` (asks `ctx.showTag(id)`), `game-main.js` (`showTag`: hide when you are in a game and they are playing on the other team), `README.md`.
- **Checked:**
  - Three browser tabs in one online lobby joined the paintball lobby; all tags showed.
  - The admin started team deathmatch. On the blue player's screen the blue team-mate's tag showed and the red opponent's was hidden. On the red player's screen both blue players' tags were hidden.
  - Node tests 44/44.
- **Status:** PR #29 (branch `feat/paintball-team-name-tags`, on top of PR #28), closes #25. For the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/17. Merged into `main` on 1 Nov 2026 and live (the user approved PRs #18, #19 and #27–#33 together).

### 2026-11-01 · Other players are arrows on your map (issue #24)
- **What:** on the map (touchpad / M) every other player in your lobby is now an arrow in their player colour, pointing the way they face, with their name above it. Before they were round dots without a direction. Your own arrow stays dark blue and is drawn on top. The map legend has an "Other players in your lobby" entry.
- **Why:** the user's issue #24: "See other players' arrows on your own map".
- **Where:** `game-map.js` (`arrow()`, `player.others`, legend), `game-main.js` (the `others` list passed to `map.draw`; the old dots removed from the POI list), `style.css`, `README.md`.
- **Checked:** two browser tabs in one online lobby (T3NU). The second player stood 25 m away facing yaw 1.2. In the first tab the map drew one arrow, "Player 527", in that player's colour (#4d9de0), at their position, with exactly their heading. Screenshot checked. Node tests 44/44.
- **Status:** PR #28 (branch `feat/map-other-players`, on top of PR #27), closes #24. For the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/16. Merged into `main` on 1 Nov 2026 and live (the user approved PRs #18, #19 and #27–#33 together).

### 2026-11-01 · The map arrow points the way you face (issue #21)
- **What:** your arrow on the map (touchpad / M) pointed exactly the opposite way: it was turned 180° too far. It now points where you are facing.
- **Why:** the user's issue #21: "Make the mini map arrow point in the true direction the player is facing." The heading was `-(yaw - theta) + π`; the `+ π` was wrong.
- **Where:** `game-main.js` (the `map.draw` call).
- **Checked:** with the map open, facing four different ways (yaw 0, 1, 2.5, −1.2): the arrow is 0.0° from the true facing (it was 180°). Node tests 44/44.
- **Status:** PR #27 (branch `fix/map-arrow-direction`, on top of PR #19), closes #21. For the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/15. Merged into `main` on 1 Nov 2026 and live (the user approved PRs #18, #19 and #27–#33 together).

### 2026-10-29 · Fly with the mouse like in Battlefield; hold Shift to look around (issue #16)
- **What:**
  - The helicopter, the plane and the FPV drone fly with keyboard and mouse like Battlefield (2042 / 6 defaults):
    - mouse up = nose down (fly forward), mouse down = nose up, mouse left/right = roll;
    - W/S = collective / throttle / thrust, A/D = yaw.
  - How far you move the mouse is how far the aircraft tilts (the mouse's speed is the stick; 700 px/s is full stick at sensitivity 1), and it keeps that tilt.
    - The helicopter's self-levelling drops to an eighth while you fly by mouse.
    - In the drone's ANGLE mode the mouse moves the tilt directly, up to 0.75 rad; in ACRO mode the mouse is 0.3 × as strong.
  - **Hold Shift or the right mouse button to look around.** The aircraft keeps flying straight, and the view turns back when you let go. The right mouse button no longer brakes while flying (S still brakes the plane).
  - The arrow keys and the controller work as before; using them turns the mouse's "keep the tilt" off.
- **Why:** the user asked (29 Oct 2026) to fly the drone and helicopter with mouse and keyboard "exactly like" Battlefield, with pitch and roll on the mouse instead of the arrow keys, and to hold e.g. Shift to look around. Battlefield's own free look is the right mouse button, so both work.
- **Where:** `game-main.js` (`flightSticks`, `flightLook`, `readInput` free look, help texts), `game-aircraft.js` (`hold` in the helicopter and drone), `README.md`, `index.html` (start and pause screens).
- **Checked (simulated mouse with pointer lock):**
  - Helicopter: 300 px of mouse up tilts the nose 21° down and it stays (flying forward at 59 km/h); 300 px right banks 28° right and it stays.
  - Free look: Shift + 400 px left turns the view 55° left of the nose while the helicopter does not move; let go and it is straight ahead again within a second. The right mouse button does the same.
  - Drone (ANGLE): 250 px up tilts it 32° nose down and it holds; back down levels it; right rolls it right.
  - Plane: mouse down raises the nose.
  - Node tests 44/44.
- **Status:** PR #19 (branch `feat/mouse-flying`, on top of PR #18), closes #16. For the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/13. Merged into `main` on 1 Nov 2026 and live (the user approved PRs #18, #19 and #27–#33 together).

### 2026-10-29 · The distant ground no longer floats above the real ground (issue #17)
- **What:**
  - Beyond the terrain data (±800 m) the land is a flat plane with a townscape texture, or the live aerial photo when it is on. That plane was set at the height of the data's south-east corner (+6.7 m in game height), so south and west of home, where the ground is 30–54 m lower, it hung 40–60 m above the real ground. From the air, beyond the detailed ground, you saw that floating sheet.
  - Now the plane sits just below the lowest ground in the data (−56.9 m).
  - A new apron joins the edge of the terrain to it. It starts at exactly the terrain's edge heights, with no gap or cliff, and eases to the plane's level by 3 km out.
  - Also fixed: the live aerial photo for the distance was painted into the townscape texture, which repeats 12 times, so the far imagery was tiled twelve times. It now has its own 2048 px texture over the whole ±9 km, shown once.
- **Why:** the user saw the "flat map imagery" floating about 50–100 m above the ground when flying south, around the construction site and beyond (29 Oct 2026). The site's move and the bigger world (PRs #12, #13) put the action right where the ground is lowest.
- **Where:** `surroundings.js` (`BASE_Y`, the apron mesh "Terrain (apron)", `horizonImg`, `setImagery`).
- **Checked:**
  - The horizon plane is at −56.9 m; the lowest ground on the data's edge is −54.2 m.
  - From the helicopter 60 m up at local (−300, 640), looking south: before, the detailed ground ended at a sharp edge with a flat sheet of photo far above it; after, the ground continues smoothly into the distance.
  - The same 150 m above the construction site.
  - With imagery on, the distant photo is the 2048 px one, shown once.
  - Node tests 44/44; no console errors.
- **Status:** PR #18 (branch `fix/floating-horizon`), closes #17. For the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/14. Merged into `main` on 1 Nov 2026 and live (the user approved PRs #18, #19 and #27–#33 together).

### 2026-10-29 · `main` is live
- **What:** the game on `main` (PRs #5–#14: jumps, shops, stashes, the Unreal features, the fixes, HODET N.N., Muselunden and the bigger world) is deployed to https://haarklous-online.server-smoke.workers.dev (Cloudflare Worker version fd96bf7e). Before, the live site ran the older branch `feat/ue5-features`.
- **Why:** `AGENTS.md`: after changing game files, redeploy so the online version matches. `main` now holds everything the old live branch had.
- **Checked:** the live page is byte-for-byte the local build (`cloud/public/index.html`) and contains the shops, paintball, the sculpture, the Muselunden course and the ±760 m world.
- **Status:** live.

### 2026-10-29 · Unreal repo issues brought up to date
- **What:** haarklous-ue5 now has an issue for every web change and fix it lacks, each with the web numbers, files and checks.
  - New: #6 stashes, #7–#9 the three bugs, #10 the site and course move, #11 Muselunden and the bigger world, and #12, a start-here list in working order.
  - Updated with full details: #1 paintball barriers, #2 street lamps, #3 HODET N.N.
- **Why:** the user's goal (29 Oct 2026): both repos should have the same features and fixes, so another agent can be pointed at the Unreal repo.
- **Status:** done on GitHub; no code in this repo.

### 2026-10-29 · Clearer cab views in the wheel loader and the tipper (from the Unreal version)
- **What:**
  - **Wheel loader:** the cab is higher (1.75 m), the front fenders are short and low, and the seat view is at the front glass looking down (seat 0, 3.15, 0.3, pitch −0.36), so you see the bucket's edge and corners.
  - **Tipper:** the mirrors are smaller and out on arms, away from the windscreen.
- **Why:** the Unreal version made these changes after the last parity check (haarklous-ue5 commit aa26d86, 28 Oct 2026, 22:53). The user's goal: the same features and fixes in both games. Its other later commit, 962eded, is an Unreal-only balcony test.
- **Where:** `site-models.js` (loader cab, fenders, lights; tipper mirrors), `game-site.js` (loader seat and view), `docs/UE5-PARITY.md`.
- **Checked:** from the loader seat the bucket lip is in the middle of the view (screen −0.03, −0.21), and the eye is 3.1 m above the ground. Node tests 44/44; no console errors.
- **Status:** PR #14 (branch `fix/site-cab-views-from-ue5`, on top of PR #13). Merged into `main` on 29 Oct 2026 (the user approved PRs #8–#14 together).

### 2026-10-29 · The real Muselunden DiscGolfPark, and a bigger world
- **What:**
  - **Muselunden DiscGolfPark**, the real 12-hole course by Sinsenkrysset, is in the game at its real place, about 470–800 m north-east of home.
    - It is the course's current layout, "Muselunden 12 hull (2022)": all par 3, lengths 106, 53, 68, 63, 35, 50, 65, 64, 76, 77, 52 and 47 m (par 36).
    - Each hole has a tee pad, a sign ("HULL n · Par 3 · length") and a basket. You play it like the Torshovdalen holes; the HUD shows the course name. The holes are on the map.
  - **The world is bigger** so you can reach it: you can walk to ±760 m (was ±540 m), and the ground data reaches ±800 m (was ±600 m). The new ring has its real ground heights, and its OpenStreetMap trees (1,791 more) and street lamps (306 more) are added. Buildings, trees and lamp posts are solid out to the new edge.
  - Nothing inside the old world moved: the old terrain values, trees and lamps are kept as they were, and the street vehicles start where they did.
- **Why:**
  - The user's goal (29 Oct 2026): "implement the real muselunden disc golf park at its real location with all the holes", using UDisc, maps and other sources.
  - UDisc gives the current layout, lengths and par. Its hole map needs a login, so I did not sign in for you; the places come from the club's own map instead.
  - The club's map is muselunden.no "Midlertidig banekart 2021". It has the same 12 holes and is georeferenced to the two football pitches in OpenStreetMap (RMS 2.2 m).
  - The map is a sketch, so each hole is scaled to UDisc's length about its midpoint (ends move up to 8 m). Hole 6's tee then sat on a service road, so that hole slid 3 m along its own line.
  - The club's older 12-hole sign (lengths 107 … 148 m, one par 4) is a previous layout and was not used.
- **Where:**
  - New: `muselunden-data.js`, `tools/make-muselunden.py`, `tools/extend-surroundings.py`, `assets/osm/torshov-nodes-800m.json`, `tests/muselunden.test.cjs`.
  - Changed: `game-minigames.js` (`discGolf(course)` builds any course), `game-main.js` (second course, prompts, map, HUD, music), `surroundings.js` (`PLAY_HALF` 760, `FAR_EXT` 800, obstacles in the square), `surroundings-data.js` (bigger terrain, more trees and lamps), `generate-surroundings.py` (±800 m, reads the new nodes), `index.html`, `README.md`, `docs/HANDOFF.md`.
- **Checked:**
  - Node tests 44/44. New: 12 holes, par 36, UDisc lengths ±0.15 m; every tee and basket is in the OSM course outline (or within 10 m of it), in the walkable world, not in a building and not on a car road.
  - The old terrain grid inside ±600 m is byte-for-byte the same, and the old trees and lamps are unchanged.
  - In the game:
    - the 41 street vehicles start where they did;
    - walked at Muselunden;
    - the prompt shows at the tees;
    - played hole 1 into the basket, and the game moved on to hole 2 with "Muselunden DiscGolfPark · Hull 2/12";
    - no console errors.
  - The frame rate was not measured in a visible window (the test tab is hidden).
- **Status:** PR #13 (branch `feat/muselunden-disc-golf`, on top of PR #12). For the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/11. Merged into `main` on 29 Oct 2026 (the user approved PRs #8–#14 together).

### 2026-10-29 · HODET N.N. at its real place; the construction site and the paintball course move
- **What:**
  - **HODET N.N.** (Marianne Heske, 2014), the 7 m bronze doll's head, stands at its real place at the north end of Torshovdalen (OSM node 2965223021, local 9.1, 275.5).
    - It faces south down the valley, as in the photos (checked against a 2014 Wikimedia Commons photo and an aerial photo).
    - It has a short neck and a flat-topped shoulder plate, and the face has lowered eyelids, a small nose, full cheeks and a small mouth.
    - Four rows of stone steps on its east side, like the small amphitheatre there. You can climb and stand on them.
    - It is solid and is on the map.
  - **The construction site** moves 96 m south and 72 m west: fence x −158..−18, s 371..461. Its two gates are where a park footway crosses the fence. Everything inside keeps its place relative to the fence: the pit, stockpiles, offices and machines. The platform is fitted to the new ground.
  - **The paintball course** moves into the valley floor that the site left (yard x −72..−8, s 296..344). It is 17 m west of the sculpture. The gate is where the lawn is level with the yard, and the lobby is on the lawn south of it.
  - The site and course data is now made in this repo by `tools/make-site.py` and `tools/make-paintball.py`. These are the Unreal project's generators, ported. With the old numbers they give the old files exactly.
- **Why:**
  - The Unreal issue #3 asked for the Torshovdalen sculpture.
  - Its real place was on the construction site's north fence, beside the gate. The user chose: the sculpture at its real place, the site about 100 m south, and the paintball course somewhere it does not cross buildings or the sculpture ("remove a block if needed").
  - Straight 100 m south, the site would have crossed the main road along the park and buildings 531 and 539. The nearest clear place is 96 m south and 72 m west (multiples of 8 m, the Unreal far terrain's grid).
  - The paintball course fits in the freed valley floor, so no block had to be removed.
  - Torshovdalen also has a smaller concrete sculpture, "Tors bukker" (Anna Widén, 2017). HODET N.N. was taken as "the sculpture".
- **Where:** `game-sculpture.js` (new), `game-main.js` (place, collision, map), `index.html`, `tools/make-site.py` and `tools/make-paintball.py` (new), `site-data.js` and `paintball-data.js` (regenerated), `tests/places.test.cjs` (new), `README.md`, `docs/HANDOFF.md`, `docs/UE5-PARITY.md`.
- **Checked:**
  - Node tests 42/42. New: the sculpture is at the OSM node; the site, paintball yard, lobby and sculpture overlap neither each other nor any building or car road; the face is symmetric.
  - In the game:
    - the 41 street vehicles start where they did, and the 7 site machines are inside the new site;
    - walked in through the site's north gate, and the fence blocks beside it;
    - paintball lobby, game start in the new yard (floor −27.05), firing, and leaving with △;
    - walking into the sculpture stops you at its shoulder plate; you can stand on the steps; the view from the south matches the photo;
    - every ray at the sculpture hits a front face; no console errors.
  - Not repeated here: digging with the 30 t excavator. In the hidden test tab the simulated stick and bucket did not move. The soil logic does not depend on the place and is covered by `tests/site.test.cjs`.
- **Status:** PR #12 (branch `feat/hodet-nn-sculpture`, on top of PR #11). For the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/3 and https://github.com/jonatsl/haarklous-ue5/issues/10 (the move). Merged into `main` on 29 Oct 2026 (the user approved PRs #8–#14 together).

### 2026-10-29 · Street lamp posts are solid
- **What:** the 82 street lamps (OpenStreetMap `highway=street_lamp`, already drawn as a 5 m grey pole with a round head) now block walkers and vehicles like trees do. Before, you could walk and drive straight through them. The map data has 83; the one at local (51.1, 288) stands inside the construction site and is left out, as before.
- **Why:** the Unreal version has no street lamps yet (haarklous-ue5 issue #2, "Add street lamps", 28 Oct 2026). The user's goal is the same features in both games. The web game already had the lamps, so the only gameplay gap was collision. The look is unchanged (no light at night: neither game has a night).
- **Where:** `surroundings.js` (lamp list and `obstacles()`).
- **Checked:** the 48 vehicles start at exactly the same places (the parked-car seed 1707 is unaffected, which matters for online play with the Unreal version). Walking into a post stops you 0.32 m from its centre. A car at 30 km/h stops with its centre about 2.4 m from the post. Node tests 38/38.
- **Status:** PR #11 (branch `feat/solid-street-lamps`, on top of PR #10). Spec for the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/2. Merged into `main` on 29 Oct 2026 (the user approved PRs #8–#14 together).

### 2026-10-29 · Paintball: the concrete barriers' ends are no longer see-through
- **What:** each end of the concrete (jersey) barriers had a small see-through gap and a thin sliver sticking out past its outline. The barrier's cross-section is narrower above its shoulder (a concave shape), and the end caps were filled as a fan, which only works for convex shapes. One triangle in each cap was wound backwards (so it was not drawn) and one reached outside the outline. The caps are now filled by ear clipping, which works for any simple outline.
- **Why:** the user reported see-through obstacles in the Unreal paintball course (haarklous-ue5 issue #1, 28 Oct 2026). The web course is built from the same Python, and the same fault was found here. The user's goal: the same fixes in both games.
- **Where:** `paintball-models.js` (`capTris`, `prism`), `tests/paintball.test.cjs` (new test: caps cover the outline exactly, every triangle the same way round).
- **Checked:** rays from 384 standing and crouching spots in the course, 15,360 in all, including rings round every barrier end. Before: 9 rays first hit a face from behind (a culled, see-through face), all on the barriers. After: 0. No other cover piece (containers, walls, building shells, car wreck, spools, sandbags, barrels, pallets, tyres) had any. The old fan had one reversed triangle per cap. Node tests 38/38; no console errors.
- **Status:** PR #10 (branch `fix/paintball-see-through`, on top of PR #9). Details for the Unreal version: https://github.com/jonatsl/haarklous-ue5/issues/1. Merged into `main` on 29 Oct 2026 (the user approved PRs #8–#14 together).

### 2026-10-29 · Three small bugs fixed (found by the Unreal port)
- **What:**
  - Petanque now ends once a side has 13. Before, the last mène was counted again every frame: the score kept climbing (13–12, 14–12 …), the game only ended with ○, and the 150 kr win reward was paid again every frame.
  - Petanque no longer freezes when every boule in the court has been knocked or thrown out. Whoever still has boules plays on; the mène ends when both sides are out.
  - A vehicle's collision world made during play (for example the motorcycle's, on its first ride) gets the other vehicles at once. Before, it had none until the next door or vehicle change, so the bike could drive through parked cars.
- **Why:** the Unreal port found these three bugs (`docs/GAMEPLAY-IDEAS.md` in haarklous-ue5) and copied them on purpose. The user's goal (29 Oct 2026) is the same features and fixes in both games. For the freeze, "whoever has boules plays on" was chosen over the Unreal note's "end the mène", so the side with boules left still gets to throw them.
- **Where:** `game-minigames.js` (`petanqueNext`, the finish check in the petanque update), `game-main.js` (`worldFor`, `updateDynamic`), `tests/minigames.test.cjs` (new).
- **Checked:** Node tests 37/37. In the game: petanque from 12–12 played to "You win 13–12!"; the score stayed 13–12, the game ended by itself after 4 s, and exactly 150 kr was paid. The motorcycle on its first ride: before the fix 5 of 6 parked cars did not block it, after the fix all 6 do; the spot right in front of the bike is still free.
- **Status:** PR #9 (branch `fix/three-bugs-from-ue5`, on top of PR #8). Same fixes for the Unreal version: haarklous-ue5 issues #7, #8, #9. Merged into `main` on 29 Oct 2026 (the user approved PRs #8–#14 together).

### 2026-10-29 · One version again: the Unreal features join `main`
- **What:** the branch `feat/ue5-features` (construction site, paintball, 12 players per lobby, walking 3.5 m/s, see `docs/UE5-PARITY.md`) is merged with `main` (vehicle jumps, shops, stashes, far-away fix). The two versions had grown apart; now one branch has everything. Small fixes while merging: the cashier keeps their own shirt colour with the 12 slot colours; the map shows the shops, the site and the paintball course; the multiplayer screen says "up to 12 players".
- **Why:** the user's goal (29 Oct 2026): both repos should have the same features and fixes. The fixes for the Unreal issues (paintball, street lamps, sculpture) need the paintball code, which was only on `feat/ue5-features`.
- **Where:** merge of `feat/ue5-features` into `feat/align-with-ue5`; conflicts solved in `game-main.js` (ground, obstacles, map markers, test handle), `game-avatars.js`, `index.html`, `style.css`.
- **Checked:** Node tests 35/35. In the game: walked into Joker and paid for two items (36,80 kr), joined the paintball lobby, started and left a game (hold △), drove a site machine; no console errors.
- **Status:** PR #8 (branch `feat/align-with-ue5`), `feat/ue5-features` is no longer needed. Merged into `main` on 29 Oct 2026 (the user approved PRs #8–#14 together).

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
