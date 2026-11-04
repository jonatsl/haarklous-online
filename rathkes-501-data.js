/* Rathkes gate 1C, flat 501 (issue #72): the user's real flat on the 5th floor, from the user's video IMG_0671.MOV (3 Nov 2026,
 * 70 s, walked from the top of the stair through every room). Like apartment-data.js for Haarklous plass 17A, but in metres:
 * sizes are estimated from the doors (2.05 m), the kitchen worktop (0.9 m), the beds and the camera's walk, not measured.
 * The bathroom (behind the closed door at the end of the hall, next to the kitchen) is not seen in the video: it is a sensible
 * small Norwegian bathroom.
 *
 * Wing frame (all plan coordinates below): the side wing of OSM building way 113875904 along Herslebs gate.
 *   a = metres along the street face from the party wall with the south neighbour (OSM way 113875864) toward Rathkes gate,
 *   b = metres into the building from the street face (Herslebs gate, b = 0) toward the backyard (yard face b = 11.3).
 *   frame.origin is the south end of the street face and frame.toward its north end (local metres east / south of 17A).
 * Heights: y = 0 is the finished floor of the storey (the 5th floor for the flat); storeys are 3.1 m.
 * Rectangles are [a0, b0, a1, b1]. Doors: hinge 'a0' | 'a1' | 'b0' | 'b1' = the jamb the leaf turns on, into = the side of the
 * wall it opens toward ('+' = larger b (or a), '-' = smaller).
 */
(function (root, data) {
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.RATHKES_501 = data;
})(typeof window === 'undefined' ? globalThis : window, {
  source: 'Video IMG_0671.MOV from the user (3 Nov 2026); sizes estimated from doors 2.05 m and worktops 0.9 m',
  frame: {origin: [-845.5, 1811.7], toward: [-854.9, 1795.3]},
  // The part of the building this model replaces: everything with a <= 10.3 and b <= 13 (the wing south of the 1B stair, its
  // stair bay included) and a 10.3–13.65, b <= 7.2 (the street half of the corner, where the living room and bathroom reach).
  cut: {a: 10.3, b: 13, a2: 13.65, b2: 7.2},
  outline: [[0, 0], [13.65, 0], [13.65, 7.2], [10.3, 7.2], [10.3, 11.3], [0, 11.3]],
  street: [0, .45], yard: [10.85, 11.3],
  storey: 3.1, floors: 5, flatFloor: 5, ceiling: 2.95, risers: 18,
  // Ground floor of the stair: the yard door step is 5 cm over the yard, five steps up to the 1st-floor landing.
  ground: {step: .05, firstRise: .86},

  // ---------- Stair 1C (the video's first 4 s: a stair winding round a narrow well, carpet, iron scrolls, curved handrail) ----------
  stair: {
    room: [3.05, 6.49, 6.75, 10.85],          // inside faces of the stair tower
    walls: {west: [2.93, 3.05], east: [6.75, 6.87]},
    landing: [4.5, 6.49, 6.75, 7.75],          // every floor; on the 1st floor it reaches west over the entry strip
    strip: [3.05, 6.49, 4.4, 10.85],           // ground floor: the yard door and five steps up; above: storerooms
    stripWall: [4.4, 4.5],
    flights: {west: [4.52, 5.47], east: [5.78, 6.73], from: 7.75, to: 9.4}, // up the east side, round the turn, back the west side
    turn: {centre: [5.625, 9.4], inner: .155, outer: [4.5, 9.4, 6.75, 10.85]},
    groundSteps: {from: 9.1, to: 7.75},
    yardDoor: {a: [3.3, 4.2], height: 2.15},
    flatDoor: {a: [4.6, 5.5], height: 2.08},   // straight ahead on every landing (501 on the 5th floor)
    sideDoor: {b: [6.62, 7.47]},               // the east wall of the landing (x02 on floors 1–4)
    window: {a: [5.05, 6.2]},                  // stair windows to the yard over each turn
    names: {101: 'Johansen', 102: 'Andersen', 201: 'Kristiansen', 202: 'Pedersen', 301: 'Olsen', 302: 'Karlsen', 401: 'Nguyen', 402: 'Eriksen'}
  },

  // ---------- The flat (5th floor) ----------
  rooms: [
    {id: 'hall', name: 'Hall', rect: [.3, 5.02, 10.42, 6.37], lamps: [[2.4, 5.7], [8.2, 5.7]]},
    {id: 'bed1', name: 'Bedroom (double bed)', rect: [.3, 6.49, 2.93, 10.85], lamps: [[1.6, 8.6]]},
    {id: 'bed2', name: 'Bedroom (daybed)', rect: [.3, .45, 3.1, 4.9], lamps: [[1.7, 2.6]]},
    {id: 'bed3', name: 'Bedroom (single bed)', rect: [3.22, .45, 5.7, 4.9], lamps: [[4.46, 2.7]]},
    {id: 'bed4', name: 'Bedroom (navy curtains)', rect: [6.87, 6.49, 10.18, 10.85], lamps: [[8.5, 8.5]]},
    {id: 'living', name: 'Kitchen and living room', rect: [5.82, .45, 13.4, 4.9], lamps: [[7.3, 2.6, 'none'], [11.4, 2.7, 'none']]},  // lit by wall and shelf lamps
    {id: 'bath', name: 'Bathroom', rect: [10.54, 5.02, 13.4, 7.08], floor: 'tile', lamps: [[11.9, 6.05]]}
  ],
  // Inner walls of the flat (the stair tower's walls and the two facades are built from `stair` and `windows`).
  walls: [
    {rect: [.3, 4.9, 13.4, 5.02], openings: [
      {at: [1.4, 2.25], door: {id: 'bed2', name: 'Bedroom door', hinge: 'a0', into: '-'}},
      {at: [3.35, 4.15], door: {id: 'bed3', name: 'Bedroom door', hinge: 'a1', into: '-'}},
      {at: [8.95, 10.15], top: 2.15}]},          // wide doorway into the kitchen and living room
    {rect: [.3, 6.37, 2.93, 6.49], openings: [{at: [1.0, 1.85], door: {id: 'bed1', name: 'Bedroom door', hinge: 'a0', into: '+'}}]},
    {rect: [6.87, 6.37, 10.54, 6.49], openings: [{at: [6.95, 7.8], door: {id: 'bed4', name: 'Bedroom door', hinge: 'a0', into: '+'}}]},
    {rect: [3.1, .45, 3.22, 4.9]}, {rect: [5.7, .45, 5.82, 4.9]},
    {rect: [10.18, 6.49, 10.3, 10.85]}, {rect: [10.18, 6.37, 10.54, 7.2]},
    {rect: [10.42, 5.02, 10.54, 6.37], openings: [{at: [5.27, 6.12], door: {id: 'bath', name: 'Bathroom door', hinge: 'b1', into: '+', panelled: true}}]},
    {rect: [10.54, 7.08, 13.4, 7.2]},
    {rect: [13.4, .45, 13.65, 7.2]},           // the kitchen wall (the neighbour flat of stair 1B is behind it)
    {rect: [0, .45, .3, 10.85]},               // party wall with the next building
    {rect: [5.82, 4.5, 6.25, 4.9]}             // chimney breast in the living room's corner (video 63 s)
  ],
  // Handle on the left seen from the landing; it opens into the hall and swings back against the hall wall (the hall is narrow).
  entrance: {at: [4.6, 5.5], hinge: 'a1', into: '-', swing: 165},
  // Windows: centre a and width; street = Herslebs gate, yard = the backyard. Every floor has them (only the 5th floor opens).
  windows: {
    street: [[1.7, 1.2], [4.46, 1.1], [8.8, 1.2], [10.9, 1.2], [12.55, 1.0]],
    yard: [[1.6, 1.1], [8.9, 1.2]],
    sill: .75, head: 2.62, transom: 2.05
  },
  soffit: [7.6, 5.02, 7.95, 6.37, 2.62],        // the boxed beam across the hall (video 41 s)

  // Furniture as seen in the video (kinds are drawn by game-rathkes-501.js). at = centre [a, b]; rot = turns the front (+b side
  // of the piece at rot 0) by quarter turns as three.js rotation.y: 0 front to +b, 1 front to +a, 2 front to -b, 3 front to -a.
  furniture: [
    // Hall
    {kind: 'wardrobe', at: [.6, 5.7], w: 1.0, d: .6, h: 2.0, rot: 1, color: 0xc08a52, wood: true, top: [0x2c3550, 0xd8b52a]},
    {kind: 'box', at: [2.15, 6.1], w: .45, d: .45, h: .62, color: 0xd9c49a},
    {kind: 'dryingRack', at: [3.05, 6.08], w: 1.3, d: .52, h: .95},
    {kind: 'extinguisher', at: [2.45, 5.14]},
    {kind: 'coatRail', at: [5.3, 5.03], w: 1.25, rot: 0},
    {kind: 'panel', at: [4.42, 5.03], w: .4, h: .45, y: 1.85, rot: 0, color: 0x9a978d},
    {kind: 'intercom', at: [6.78, 6.36], rot: 2},
    {kind: 'rug', at: [2.95, 5.7], w: 2.0, d: .9, colors: [0x6a6f78, 0xd7d0bd, 0x3a3f4a]},
    {kind: 'rug', at: [5.1, 5.7], w: 1.1, d: .75, colors: [0x5d6470, 0xdad4c4, 0x2f3540]},
    {kind: 'rug', at: [8.7, 5.7], w: 2.6, d: .7, colors: [0x48505c, 0xe2dccb, 0x2b2f38]},
    // Bedroom (double bed): bed head to the window, grey curtains, posters, paper globe
    {kind: 'bed', at: [1.6, 9.68], w: 1.6, d: 2.0, rot: 2, frame: 0x22262b, duvet: 0x4a5f9e, check: true},
    {kind: 'nightstand', at: [.57, 10.6], w: .4, d: .38, h: .5, rot: 2, color: 0xf0eee8},
    {kind: 'basket', at: [2.62, 10.55]},
    {kind: 'curtains', at: [1.6, 10.85], w: 1.9, color: 0x5d636b, rot: 2},
    {kind: 'picture', at: [.3, 8.4], w: .45, h: .6, y: 1.55, rot: 1, art: 2}, {kind: 'picture', at: [.3, 9.15], w: .45, h: .6, y: 1.6, rot: 1, art: 3},
    {kind: 'radiator', at: [1.6, 10.85], w: 1.0, rot: 2},
    // Bedroom (daybed): white scrolled metal daybed under the window, desk, dark wardrobe beside the door, striped rug
    {kind: 'daybed', at: [1.35, .95], w: 2.0, d: .9, rot: 0},
    {kind: 'desk', at: [.62, 2.4], w: 1.2, d: .6, rot: 1, color: 0x8a4f2a},
    {kind: 'wardrobe', at: [.8, 4.62], w: .95, d: .55, h: 1.85, rot: 2, color: 0x2a201b, shelf: true},
    {kind: 'stripedRug', at: [1.75, 2.7], w: 2.2, d: 1.6},
    {kind: 'curtains', at: [1.7, .45], w: 1.8, color: 0xf2eee4, rot: 0, tapestry: 0xa13a24},
    // Bedroom (single bed): bed along the west wall, mirror wardrobe, built-in wardrobe by the door, floor lamp
    {kind: 'bed', at: [3.85, 1.68], w: 1.2, d: 2.0, rot: 0, frame: 0xf2f0ea, duvet: 0xc9b99a},
    {kind: 'mirrorWardrobe', at: [5.4, 2.3], w: 1.8, d: .6, h: 2.0, rot: 3},
    {kind: 'builtIn', at: [4.98, 4.6], w: 1.44, d: .6, rot: 2},
    {kind: 'floorLamp', at: [3.42, 2.95]},
    {kind: 'curtains', at: [4.46, .45], w: 1.7, color: 0xe8dcc0, rot: 0},
    {kind: 'radiator', at: [4.46, .45], w: .9, rot: 0},
    // Bedroom (navy curtains): PAX wardrobe and trolley by the door, bed head to the window, black dresser, folding chair
    {kind: 'wardrobe', at: [8.5, 6.79], w: 1.0, d: .58, h: 2.36, rot: 0, color: 0xf3f2ee, handles: true},
    {kind: 'trolley', at: [9.4, 6.68], rot: 0},
    {kind: 'bed', at: [7.95, 9.68], w: 1.6, d: 2.0, rot: 2, frame: 0x8f9296, duvet: 0x9cc0cf},
    {kind: 'dresser', at: [9.55, 10.6], w: .85, d: .45, h: .75, rot: 2, color: 0x1f2125},
    {kind: 'foldingChair', at: [9.45, 9.55], rot: 3},
    {kind: 'rug', at: [8.6, 8.9], w: 2.2, d: 2.4, colors: [0x4f7d62, 0xb9cdb0, 0x30584a]},
    {kind: 'curtains', at: [8.9, 10.85], w: 2.0, color: 0x1d2a4d, rot: 2},
    {kind: 'radiator', at: [8.9, 10.85], w: 1.1, rot: 2},
    // Kitchen and living room
    {kind: 'kitchen', rect: [12.8, .75, 13.4, 4.35], rot: 3},
    {kind: 'pipe', at: [13.32, 4.82], h: 2.95},
    {kind: 'sideboard', at: [11.85, 4.67], w: 1.1, d: .45, h: .72, rot: 2},
    {kind: 'records', at: [11.85, 4.9], w: 1.25, y: 1.25, rot: 2},
    {kind: 'diningTable', at: [10.9, 2.7], w: .9, d: 2.0},
    {kind: 'sofa', at: [7.05, .95], w: 2.1, d: .9, rot: 0, color: 0x3b4249},
    {kind: 'coffeeTable', at: [6.95, 2.25], w: 1.2, d: .6, h: .45},
    {kind: 'rug', at: [7.15, 2.7], w: 2.4, d: 2.5, colors: [0x8a2a22, 0x2a6f6c, 0xcfa868]},
    {kind: 'slingChair', at: [8.05, 3.65], rot: 2},
    {kind: 'wallUnit', at: [6.0, 2.6], w: 3.2, rot: 1},
    {kind: 'tv', at: [6.75, 4.3], rot: 1.9},
    {kind: 'guitar', at: [6.4, 4.38]},
    {kind: 'plant', at: [9.0, 4.55], h: 1.0}, {kind: 'plant', at: [6.35, 4.05], h: .6},
    {kind: 'picture', at: [9.85, .45], w: .5, h: .7, y: 1.5, rot: 0, art: 1}, {kind: 'picture', at: [11.78, .45], w: .45, h: .36, y: 1.75, rot: 0, art: 0},
    {kind: 'radiator', at: [8.8, .45], w: 1.0, rot: 0}, {kind: 'radiator', at: [10.9, .45], w: 1.0, rot: 0},
    // Landing outside the door: the shoe rack against the panelled wall
    {kind: 'shoeRack', at: [4.66, 7.25], rot: 1}
  ],
  // The bathroom (not in the video): white 15 cm wall tiles, grey floor tiles, wall-hung toilet, basin on a vanity with a mirror
  // cabinet, shower corner with a glass screen, washing machine, towel radiator, extractor fan.
  bathroom: {vanity: [11.3, 5.02], toilet: [12.0, 5.02], shower: [12.5, 5.02, 13.4, 5.95], washer: [13.05, 7.08], towels: [11.25, 7.08]}
});
