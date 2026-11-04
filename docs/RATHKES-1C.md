# Rathkes gate 1C – flat 501 (issues #44 and #72)

The user's wish (2 Nov 2026, issue #44): another apartment like Haarklous plass 17A – Rathkes gate 1C, 5th floor, entered through
the backyard (bakgården). Issue #72 (3 Nov 2026): "Use video in my dropbox … to see the apartment and implement it. behind the
closed door next to the living room/kitchen is a small bathroom. Implement like haarklous plass 17a is implemented, but make it
similar to the video. the video is the real rathkes gate 1C unit 501 apartment."

17A stays the home. Flat 501 is a second place you can go: on the map it is ⌂ *Rathkes gate 1C · flat 501*.

## What is in the game now
- **The way in** (`game-rathkes.js`, issue #44): the wrought-iron gate under the blue "1" at the east end of the façade on Rathkes gate
  (as on Google Street View; □ opens both leaves, shared online), the 2.9 m × 3.6 m passage through the building and the backyard,
  door 1B (locked) on the corner's face toward the yard.
- **The building part** (`game-rathkes-501.js`): OSM way 113875904 is the corner block of Rathkes gate and Herslebs gate. Stair 1C is
  in its side wing along Herslebs gate. `GameRathkes.prepare` cuts out the wing's south part (13.65 m along the street, 11.3 m deep;
  and 7.2 m deep for the last 3.35 m, where the living room and bathroom reach past stair 1B) and the model draws it itself: both
  façades with real 6-pane windows on all five floors (dark rooms behind the lower ones), the plinth, a cornice and the roof. The
  other pieces of the building keep the whole building's roof height (they used to differ a little, piece by piece).
- **Door 1C** in the yard façade (a game door: □, shared online), with a "1C" plate, the doorbell board, the lamp and a
  "RATHKES GATE 1C" plate.
- **Stair 1C** (like `stairwell.js`, video 0–4 s): the ground-floor hall with mailboxes and five steps up, then on every storey a flight
  up the east side, a 180° turn of six winders round a narrow well and a flight back up the west side (18 risers of 17 cm per 3.1 m
  storey). Brown carpet, black wrought-iron scrolls and one curved dark-wood handrail from the 1st floor to the railing on the top
  landing, terracotta landing tiles, white walls, a stair window to the yard over every turn, a globe lamp on every landing. On
  floors 1–4 two locked flat doors (x01 straight ahead, panelled grey; x02 on the side wall, white with glass) with numbers and name
  plates ("Locked. Someone lives here."). On the 5th floor: grey-green tongue-and-groove panelling, the brass doorbell, the shoe rack
  and door 501 (light grey, two panels, brass handle, "501").
- **Flat 501** (`rathkes-501-data.js`, video 4–70 s), from the front door:
  - The **hall** (1.35 m wide, 10 m long): coat rail with coats and the grey fuse box opposite the front door, the drying rack and a
    box, the fire extinguisher, the oak two-door wardrobe with bags on top at the end, patterned rugs, two round ceiling lamps and the
    boxed beam across the ceiling. The front door opens in and swings back against the hall wall.
  - **Bedroom (double bed)** at the end of the hall, yard side: bed with the head to the window and a blue checked duvet, bedside
    table, round basket, grey curtains, posters, paper globe lamp.
  - **Bedroom (daybed)** opposite, street side: white scrolled metal daybed under the window, wooden desk with a keyboard, dark
    two-door wardrobe with a shelf on top beside the door, striped rug, white curtains and a red tapestry, dark metal shade.
  - **Bedroom (single bed)** next to it, street side: bed along the wall to the window, mirror wardrobe, built-in white wardrobe from
    floor to ceiling beside the door, floor lamp, cream curtains.
  - **Bedroom (navy curtains)** beside the front door, yard side: white PAX wardrobe and a black trolley shelf by the door, bed with
    the head to the window, black dresser, wooden folding chair, green rug, navy curtains, panel radiator, orange drum lamp.
  - **Kitchen and living room** (7.6 × 4.45 m, street side, three tall windows) through the wide doorway near the end of the hall:
    the kitchen along the end wall (black cabinets, birch worktop, induction hob over the oven, sink, integrated dishwasher, a long
    row of black wall cabinets with wooden crates and two clamp lamps on top, a rail with pots and pans), the grey riser pipe in the
    corner, the rattan sideboard with an espresso machine under nine record sleeves, the long black dining table with six chairs and
    flowers, the dark grey sofa, the teak coffee table on a red and teal rug, the leather sling chair, the teak wall shelving with
    books, lamps, a record player and a lava lamp, the TV in the corner by the chimney breast, a guitar and plants.
  - The **bathroom** behind the closed panelled door at the end of the hall (not seen in the video, "a small bathroom"): 2.9 × 2.1 m,
    white 15 cm wall tiles, grey floor tiles, basin on a vanity under a mirror cabinet with a light, wall-hung toilet, shower corner
    with a glass screen, washing machine, towel radiator, extractor fan.
- Every room and landing has its light (the game's one moving indoor lamp follows you into the room, as in the 17A stairwell), and the
  lamps and shades glow. All doors open with □ and are shared online. Walls, furniture and the stair have collision.
- From further than 70 m the rooms are hidden and the windows show dark rooms (cheaper); the far view gets a plain block.
- Performance: 36 meshes, 25,800 triangles; in the browser it adds 25–44 draw calls and about 31,000 triangles per frame (sun shadows
  included) where you see it. Only the façades and roof cast sun shadows.

## Where it is (checked against the building outline)
- Wing frame (`rathkes-501-data.js` `frame`): a along the Herslebs gate face from the party wall with OSM way 113875864, b into the
  building toward the yard. The 1C address node is at a 2.9, b 9.8; the yard door is at a 3.3–4.2 in the yard face (b 11.3).
- The front door is in the hall's yard-side wall, the stair is on the yard side between the double-bed bedroom and the navy bedroom
  (as in the video: you enter facing the coats, the long part of the hall goes left). So the hall runs along the wing, the daybed and
  single-bed rooms and the kitchen and living room look onto **Herslebs gate** (the video's windows show the lit windows of the
  building across a street), the two other bedrooms onto the **backyard**. The kitchen end is toward Rathkes gate, past stair 1B.
- The 5th floor is 13.3 m over the yard (ground floor hall 5 cm up, five steps of 17 cm to the 1st floor, then 3.1 m storeys).

## Estimated from the video (not measured)
- Room sizes and positions: from the doors (2.05 m), the worktop (0.9 m), beds (1.6 / 1.2 / 0.9 × 2.0 m), wardrobes and how far
  the camera walks. Ceiling 2.95 m (the doors reach about 70 % of the wall). Windows 1.0–1.2 m wide, sill 0.75 m, top 2.62 m.
- Which way each door opens: front door – handle on the left from the landing, opens in; bedroom doors open into their rooms; the
  bathroom door opens into the bathroom (the video never opens it).
- The stair's plan (the video shows the top two flights only): a U with winders round a narrow well, the same on every floor; the
  ground floor and the neighbours' doors and names are made up.
- The bathroom, the lower floors' flats and the façade colours (the patch's red brick; Street View shows grey plaster and yellow brick
  on the street front) are not from the video.
- The video was filmed at night; the game shows the flat by day.

## Not done / later
- The façade's real colours (grey plaster, yellow brick pilasters) for the whole block.
- Nothing in the flat can be used yet (no drinks or chairs to sit on, like in 17A).
