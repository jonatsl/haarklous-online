# Haarklous online

Haarklous online is a first-person open-world game that runs in your web browser. You explore a copy of the real Torshov area in Oslo, alone or with friends.

## What the project is

- The game starts at your apartment in Haarklous plass 17A, Torshov, Oslo.
- The streets, buildings and ground heights are real. They come from OpenStreetMap and Kartverket.
- The streets are smooth to drive on, with a granite kerb between the road and the pavement.
- You can walk, drive, ride, paddle and fly. There are cars, motorcycles, bikes, e-scooters, a kayak, aircraft and a drone.
- Thousands of parked cars, vans, taxis, lorries and motorcycles line the streets and fill the car parks, and you can drive them.
- There are minigames, jobs, shops, a mission and badges. You find out how each one works in the game.
- You can play minigolf where the real courses are: Torshov, Grünerløkka, Jordal park and the minigolf bar Oslo Camping in Møllergata. Aim with the right stick or the mouse, hold R2 or the left mouse button and let go to putt.
- Play prop hunt (hide and seek) with friends, or alone against the game's players: hiders turn into benches, bins, bikes and bushes, and a hunter looks for them. Stand in a purple ring at Haarklous plass, Olaf Ryes plass or the backyard of Rathkes gate 1 to start.
- Walk or cycle Akerselva – turvei, a path along the river from Bjølsen to Vaterland.
- Trams, buses and the metro run on Ruter's real lines, about as often as the real ones. Every stop has a timetable (□ / E), and you can ride.
- Visit the police station and the prison on Grønland, and drive a police car with blue lights and siren (L3 or H).
- With the money you earn you can buy a flat. It is yours alone: nobody else can own it or unlock its door.
- In the flat in Rathkes gate 1C you can play records, watch TV from the sofa, move the chairs and turn on the lava lamp.
- Up to 12 players can play together in one lobby.
- The game is one HTML file. A Cloudflare server connects the players and keeps the optional accounts.

## Play

- Online: open https://haarklous-online.server-smoke.workers.dev.
- On this PC: double-click `PLAY-Controller-Windows.cmd`, or open `haarklous-game.html` in Chrome, Edge or Firefox.
- To play with friends, give them your lobby code from the pause menu.
- With an account you can add friends (pause menu → Friends, L1 or N). You see when they are online, and you can invite them to your lobby or join theirs.

## Controls

- Use a PS4 controller (USB or Bluetooth), or a keyboard and mouse.
- Move with the left stick or WASD. Look with the right stick or the mouse.
- Press ✕ or Space to jump. Hold it to jump higher. Jump at a ledge to climb up onto it.
- Press □ or E to use things (doors, vehicles, games, the record player and TV). Tap □ on a chair to carry it, hold □ to sit on it.
- In a vehicle, press R3 or V to change between first person and third person (the camera behind you).
- Press Options or Esc to pause. The start screen and the pause screen show all of the controls.

## For developers

- Edit the source files, then run `python build.py`. It writes `haarklous-game.html` and `cloud/public/index.html`.
- Run the tests with `node --test tests/*.cjs`.
- Put the new version online with `npx wrangler deploy` in `cloud/`.
- Technical notes are in `docs/HANDOFF.md`. All changes are recorded in `docs/DECISIONS.md`.

## Sources and licences

- Map data © OpenStreetMap contributors (ODbL).
- Height data © Kartverket (CC BY 4.0).
- Weather data © MET Norway (CC BY 4.0).
- City bike data © Oslo Bysykkel (NLOD 2.0).
- Aerial images (optional, online only): Esri World Imagery.
- 3D engine: Three.js (MIT).
- The file-by-file list of sources is in `docs/HANDOFF.md`.
