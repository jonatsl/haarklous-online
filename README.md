# Haarklous online

Haarklous online is a first-person open-world game that runs in your web browser. You explore a copy of the real Torshov area in Oslo, alone or with friends.

## What the project is

- The game starts at your apartment in Haarklous plass 17A, Torshov, Oslo.
- The streets, buildings and ground heights are real. They come from OpenStreetMap and Kartverket.
- You can walk, drive, ride, paddle and fly. There are cars, motorcycles, bikes, e-scooters, a kayak, aircraft and a drone.
- There are minigames, jobs, shops, a mission and badges. You find out how each one works in the game.
- Up to 12 players can play together in one lobby.
- The game is one HTML file. A Cloudflare server connects the players and keeps the optional accounts.

## Play

- Online: open https://haarklous-online.server-smoke.workers.dev.
- On this PC: double-click `PLAY-Controller-Windows.cmd`, or open `haarklous-game.html` in Chrome, Edge or Firefox.
- To play with friends, give them your lobby code from the pause menu.

## Controls

- Use a PS4 controller (USB or Bluetooth), or a keyboard and mouse.
- Move with the left stick or WASD. Look with the right stick or the mouse.
- Press □ or E to use things (doors, vehicles, games).
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
