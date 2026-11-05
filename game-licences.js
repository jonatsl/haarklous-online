/* Licences (issue #59): Norwegian-style licences for the game's vehicles, each won by a test.
 * The user: "Require tests, similar to driving test etc, that gives you licenses for each of the vehicles in the game."
 *
 *   Førerkort klasse B   cars                     Soria Moria Trafikkskole (Vogts gate, the real driving school in OSM)
 *   Førerkort klasse A   motorcycles              the same school; the Honda CBF600S gives 57 kW, more than A2's 35 kW
 *   Førerkort klasse C   the 8x4 tipper (a lorry) the construction site office; class B first
 *   Maskinførerbevis     dozer (M1), excavators (M2), wheel loader (M4), articulated hauler (M6)   the site office
 *   Kranførerbevis       mobile crane (G1), tower crane (G2)                                       the site office
 *   PPL(A)               the sport plane and the Caravan jump plane    the flight school at the airstrip
 *   PPL(H)               the helicopter                                the flight school at the airstrip
 *   Dronebevis A1/A3     the FPV drone             Luftfartstilsynet's online test (free): theory only, on the phone
 * City bikes, e-scooters and the kayak need no licence (as in Norway). Riding along as a passenger is free, and so is a
 * skydive flown by the game's pilot. Each test is a short theory part (five questions with real rules, at most one wrong)
 * and, except for the drone, a practical part in the test vehicle: rings to pass in order, the speed limit (more than 5 km/h
 * over it for 2 s fails), no crash, a time limit, and at the end stop / park / land in the marked place (cranes: hook a load,
 * carry it through a ring and set it down on the mark). A passed theory part is kept; a failed practical part says why.
 * A part you have failed can be taken again for free (the user: "if i fail the drivers/flying licence, make retries free").
 * Saved in localStorage KEY (part of an account's saved progress, game-progress.js).
 *
 * Pure (Node-tested):
 *   KEY, LICENCES [{id, name, tag (for “needs …”), short, icon, covers, place, fee: {theory, practical}, requires, quiz [{q, a, ok}], maxWrong,
 *     course, vehicle, theoryOnly}], IDS, byId, PLACES {id: {name, near, where}}
 *   need(vehicle) -> licence id | null   which licence the driver's seat of a vehicle needs ({kind, rental}; kind 'drone')
 *   load(text) -> state {have: {id: date}, theory: {id: date}, fails: {id: n}, theoryFails: {id: n}}   has(state, id)   missing(state, id) -> ids
 *   grant(state, id, date)   passTheory(state, id, date)   fail(state, id, part 'theory' | 'practical')   (how two saved copies join: GameProgress RULES)
 *   fees(state, licence) -> {theory, practical} kroner still to pay: 0 for a passed theory part and for a part failed before
 *   score(quiz, answers) -> {right, wrong}   passed(licence, answers) -> bool
 *   COURSES {name: {frame, origin, ground, heightRef, limit, timeS, maxAgl, crane, start, gates}}
 *   resolve(course, {toWorld, groundAt, origin}) -> world gates [{k, x, y, z, r, yaw, limit, say, hold, box}]
 *   Practical(course, gates): step(s) -> this {state 'run' | 'passed' | 'failed', why, detail, i, t, gate, limitNow()}
 *     s = {dt, x, y, z, speed (m/s), agl, grounded, crashed, inVehicle, point {x, y, z} (cranes: the hook), loaded, dropped {x, z}}
 *   failText(run) -> text   mmss(seconds)
 * GameLicences.create({T, scene, root, store, onChange}) -> browser part: state, has(id), save(), reload(), rings, hud(html),
 *   menu (list and quiz overlay), sign(...) for the test places.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameLicences = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const KEY = 'haarklous-licences-v1';
  const SPEED_TOL = 5, OVER_S = 2, HIT_SPEED = 1.5, HOLD_SPEED = 1.5, HIGH_S = 3;

  const PLACES = {
    school: {name: 'Soria Moria Trafikkskole', near: 'Vogts gate', where: "Vogts gate at Krebs' gate, Sandaker (🪪 on the map)"},
    site: {name: 'the site office', near: 'the construction site’s north gate', where: 'outside the north gate of the construction site in Torshovdalen (🪪 on the map)'},
    airfield: {name: 'Torshovdalen flyskole', near: 'the airstrip', where: 'by the sport plane at the airstrip in Torshovdalen (🪪 on the map)'},
    online: {name: 'flydrone.no', near: 'on your phone, free', where: 'on your phone (D-pad → / P): Luftfartstilsynet’s online test, free'}
  };

  const LICENCES = [
    {id: 'B', name: 'Førerkort klasse B', tag: 'førerkort klasse B', short: 'Class B', icon: '🚗', covers: 'cars', place: 'school', fee: {theory: 100, practical: 200}, vehicle: 'the school car', course: 'road',
      quiz: [
        {q: 'What is the speed limit in a built-up area (tettbygd strøk) when no sign says otherwise?', a: ['30 km/h', '50 km/h', '60 km/h'], ok: 1},
        {q: 'What is the highest blood alcohol level you may drive with in Norway?', a: ['0.2 per mille (promille)', '0.5 per mille', '0.8 per mille'], ok: 0},
        {q: 'At a crossroads with no signs or lights, who goes first?', a: ['The car on the bigger road', 'Traffic from the right – you give way to the right (vikeplikt for høyre)', 'Whoever comes first'], ok: 1},
        {q: 'A pedestrian is about to step onto a zebra crossing (gangfelt) in front of you. What do you do?', a: ['Hoot and drive on', 'Slow down only if they are already in the middle', 'Stop and let them cross – you must give way'], ok: 2},
        {q: 'When must the dipped headlights be on?', a: ['Only in the dark', 'Always when you drive, day and night', 'Only outside built-up areas'], ok: 1}
      ]},
    {id: 'A', name: 'Førerkort klasse A', tag: 'førerkort klasse A', short: 'Class A', icon: '🏍', covers: 'motorcycles (the Honda CBF600S gives 57 kW – more than the 35 kW of class A2)', place: 'school', fee: {theory: 100, practical: 200}, vehicle: 'the school motorcycle', course: 'road',
      quiz: [
        {q: 'The Honda CBF600S gives 57 kW. Which licence class lets you ride it?', a: ['A1 (up to 11 kW)', 'A2 (up to 35 kW)', 'A (no power limit)'], ok: 2},
        {q: 'How old must you be for class A if you have not had A2 for two years?', a: ['18', '20', '24'], ok: 2},
        {q: 'What must the rider and the passenger always wear?', a: ['A reflective vest', 'An approved helmet', 'Nothing – it is only advice'], ok: 1},
        {q: 'What is the speed limit outside built-up areas when no sign says otherwise?', a: ['70 km/h', '80 km/h', '90 km/h'], ok: 1},
        {q: 'Where do you look when you ride through a bend?', a: ['At the front wheel', 'Through the bend, to where you want to go', 'At the edge of the road'], ok: 1}
      ]},
    {id: 'C', name: 'Førerkort klasse C', tag: 'førerkort klasse C', short: 'Class C', icon: '🚚', covers: 'lorries: the 8x4 tipper truck', place: 'site', fee: {theory: 100, practical: 300}, requires: ['B'], vehicle: 'the tipper truck', course: 'siteC',
      quiz: [
        {q: 'Which licence must you have before you can take class C?', a: ['None', 'Class B', 'Class A'], ok: 1},
        {q: 'What is the highest speed for a lorry over 3500 kg, even where the sign allows more?', a: ['80 km/h', '90 km/h', '100 km/h'], ok: 0},
        {q: 'How long may you drive before you must take a break of at least 45 minutes?', a: ['2 hours', '4.5 hours', '6 hours'], ok: 1},
        {q: 'Before you tip the load you check…', a: ['that the radio works', 'that nobody is near the body, the ground is firm and level, and there are no power lines above', 'nothing – the body tips by itself'], ok: 1},
        {q: 'Why do you drive slowly with a full load?', a: ['It raises the centre of gravity and makes the braking distance longer', 'Only to save the tyres', 'You do not need to'], ok: 0}
      ]},
    {id: 'M', name: 'Maskinførerbevis', tag: 'a maskinførerbevis', short: 'Maskinførerbevis M1–M6', icon: '🚜', covers: 'construction machines: the dozer (M1), the excavators (M2), the wheel loader (M4) and the articulated hauler (M6)', place: 'site', fee: {theory: 100, practical: 150}, vehicle: 'the wheel loader', course: 'siteM',
      quiz: [
        {q: 'Which class of the operator’s certificate (kompetansebevis) covers the dozer (doser)?', a: ['M1', 'M4', 'M6'], ok: 0},
        {q: 'Which class covers the excavator (gravemaskin)?', a: ['M2', 'M3', 'M5'], ok: 0},
        {q: 'Which class covers the wheel loader (hjullaster)?', a: ['M2', 'M4', 'M6'], ok: 1},
        {q: 'Which class covers the articulated hauler (dumper)?', a: ['M1', 'M3', 'M6'], ok: 2},
        {q: 'Someone walks into the danger zone round your machine. What do you do?', a: ['Sound the horn and carry on', 'Stop every movement until they are out of the danger zone', 'Work more slowly'], ok: 1}
      ]},
    {id: 'G', name: 'Kranførerbevis', tag: 'a kranførerbevis', short: 'Kranførerbevis G1 / G2', icon: '🏗', covers: 'cranes: the mobile crane (G1) and the tower crane (G2)', place: 'site', fee: {theory: 100, practical: 150}, vehicle: 'the tower crane', course: 'crane',
      quiz: [
        {q: 'Which class of crane operator’s certificate covers the tower crane (tårnkran)?', a: ['G1', 'G2', 'G8'], ok: 1},
        {q: 'Which class covers the mobile crane (mobilkran)?', a: ['G1', 'G4', 'G11'], ok: 0},
        {q: 'Who may walk under a hanging load?', a: ['The signaller (anhuker)', 'Nobody', 'Anyone with a helmet on'], ok: 1},
        {q: 'What must you know before every lift?', a: ['Only where the load is going', 'The weight of the load and what the crane may lift at that radius (the load chart)', 'The time of day'], ok: 1},
        {q: 'The wind gets stronger than the tower crane is made for. What do you do?', a: ['Lift faster to finish', 'Stop lifting, set the load down and let the jib turn freely with the wind', 'Lock the jib so it cannot turn'], ok: 1}
      ]},
    {id: 'PPLA', name: 'PPL(A) – private pilot licence, aeroplanes', tag: 'a PPL(A)', short: 'PPL(A)', icon: '✈', covers: 'aeroplanes: the two-seat sport plane and the Caravan jump plane', place: 'airfield', fee: {theory: 150, practical: 450}, vehicle: 'the sport plane', course: 'circuit',
      quiz: [
        {q: 'What does a PPL(A) let you do?', a: ['Fly aeroplanes for pay', 'Fly aeroplanes privately, without pay', 'Fly helicopters'], ok: 1},
        {q: 'Two aircraft fly towards each other head-on. What do both pilots do?', a: ['Both turn right', 'Both turn left', 'Both climb'], ok: 0},
        {q: 'Which way do you take off and land?', a: ['With the wind behind you', 'Into the wind', 'Across the wind'], ok: 1},
        {q: 'What is the youngest age for a PPL(A)?', a: ['16', '17', '18'], ok: 1},
        {q: 'Which transponder code tells air traffic control you have an emergency?', a: ['7000', '7600', '7700'], ok: 2}
      ]},
    {id: 'PPLH', name: 'PPL(H) – private pilot licence, helicopters', tag: 'a PPL(H)', short: 'PPL(H)', icon: '🚁', covers: 'helicopters: the Airbus H125', place: 'airfield', fee: {theory: 150, practical: 450}, vehicle: 'the helicopter on its pad by Haarklous plass', course: 'heli',
      quiz: [
        {q: 'Where is it most dangerous to walk near a running helicopter?', a: ['In front, where the pilot sees you', 'Near the tail rotor', 'Beside the skids'], ok: 1},
        {q: 'What is autorotation?', a: ['Flying on autopilot', 'The airflow turns the rotor, so you can land without engine power', 'Turning on the spot in a hover'], ok: 1},
        {q: 'What is the youngest age for a PPL(H)?', a: ['16', '17', '21'], ok: 1},
        {q: 'You hover close to the ground. What does ground effect do?', a: ['The rotor needs less power close to the ground', 'The engine gets hotter', 'It pulls the helicopter down'], ok: 0},
        {q: 'Two aircraft fly towards each other head-on. What do both pilots do?', a: ['Both turn right', 'Both turn left', 'Both descend'], ok: 0}
      ]},
    {id: 'A1A3', name: 'Dronebevis A1/A3 (kompetansebevis)', tag: 'the drone certificate A1/A3', short: 'Drone A1/A3', icon: '🛸', covers: 'the FPV drone', place: 'online', fee: {theory: 0, practical: 0}, theoryOnly: true,
      quiz: [
        {q: 'How high may you fly in the open category?', a: ['50 m', '120 m above the ground', '300 m'], ok: 1},
        {q: 'You fly FPV with goggles. What does the rule ask for?', a: ['Nothing more', 'An observer beside you who keeps the drone in sight', 'That you fly only at night'], ok: 1},
        {q: 'May you fly over a crowd of people in A1/A3?', a: ['Yes, if it is quick', 'Only above 50 m', 'No – never over gatherings of people'], ok: 2},
        {q: 'When must you register as a drone operator?', a: ['Only for drones over 25 kg', 'When the drone weighs 250 g or more, or has a camera', 'Never'], ok: 1},
        {q: 'Near an airport you…', a: ['may fly if it is quiet', 'keep at least 5 km away unless you have permission', 'fly below the planes'], ok: 1}
      ]}
  ].map(l => ({maxWrong: 1, requires: [], ...l}));
  const IDS = LICENCES.map(l => l.id), byId = Object.fromEntries(LICENCES.map(l => [l.id, l]));

  // Which licence the driver's seat needs. Rentals (city bikes, e-scooters) and the kayak need none; anything else with an
  // engine that is not listed needs at least class B, so a new vehicle is never left open by mistake.
  const MACHINES = ['excavator', 'excavator30', 'dozer', 'loader', 'hauler'];
  function need(v) {
    if (!v || v.rental) return null;
    const k = v.kind;
    if (k === 'scooter' || k === 'bicycle' || k === 'kayak') return null;
    if (k === 'car') return 'B';
    if (k === 'motorcycle') return 'A';
    if (k === 'tipper') return 'C';
    if (MACHINES.includes(k)) return 'M';
    if (k === 'crane' || k === 'tower') return 'G';
    if (k === 'plane' || k === 'jumpplane') return 'PPLA';
    if (k === 'helicopter') return 'PPLH';
    if (k === 'drone') return 'A1A3';
    return 'B';
  }

  // ---------- Saved state ----------
  const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  function load(text) {
    let s = null;try {s = JSON.parse(text);} catch {}
    s = obj(s);const clean = o => Object.fromEntries(Object.entries(obj(o)).filter(([k]) => IDS.includes(k)));
    return {have: clean(s.have), theory: clean(s.theory), fails: clean(s.fails), theoryFails: clean(s.theoryFails)};
  }
  const has = (state, id) => !!(state && state.have && state.have[id]);
  const missing = (state, id) => (byId[id] ? byId[id].requires : []).filter(r => !has(state, r));
  const today = () => new Date().toISOString().slice(0, 10);
  function grant(state, id, date = today()) {if (!state.have[id]) state.have[id] = date;if (!state.theory[id]) state.theory[id] = date;return state;}
  function passTheory(state, id, date = today()) {if (!state.theory[id]) state.theory[id] = date;return state;}
  // fails counts every failed try; theoryFails the theory ones (saves from before free retries have none: their fails before
  // the theory was passed were theory, after it practical).
  function fail(state, id, part) {
    state.fails[id] = (+state.fails[id] || 0) + 1;
    if (part === 'theory') state.theoryFails[id] = (+(state.theoryFails || (state.theoryFails = {}))[id] || 0) + 1;
    return state;
  }
  function fees(state, lic) {
    const id = lic.id, fails = +state.fails[id] || 0, theoryFails = +(state.theoryFails || {})[id] || 0;
    return {theory: state.theory[id] || fails > 0 ? 0 : lic.fee.theory, practical: lic.theoryOnly || fails > theoryFails && state.theory[id] ? 0 : lic.fee.practical};
  }

  // ---------- Theory ----------
  function score(quiz, answers) {let right = 0;quiz.forEach((q, i) => {if (answers[i] === q.ok) right++;});return {right, wrong: quiz.length - right};}
  const passed = (lic, answers) => score(lic.quiz, answers).wrong <= lic.maxWrong;

  // ---------- Courses ----------
  // frame 'local': p = [x east, s south] in the game's local metres; 'runway': p = [along, right, height] from the origin
  // vehicle's spot and heading; 'offset': p = [dx, dz, height] in world metres from the origin. Heights: above the ground
  // under the gate ('ground'), or above the ground at the origin ('origin', for approaches over falling ground).
  // A gate's limit (km/h) is the limit on the way to it; say = the examiner's instruction on the way to it.
  const COURSES = {
    // Soria Moria Trafikkskole → Krebs' gate → Per Kvibergs gate → Hegermanns gate → the roundabout at Hegermanns plass →
    // Vogts gate → back to the school (about 710 m ring to ring) on the real streets (OSM).
    road: {frame: 'local', ground: true, limit: 30, timeS: 240, start: [-639.1, 37.4], gates: [
      // Placed so the straight line from ring to ring keeps 1.5 m from every building, tree and lamp post (some OSM street
      // lamps stand in the middle of these streets), mostly on the right-hand lane.
      {k: 'ring', p: [-597.1, 53.2], say: "Drive east along Krebs' gate, across Vogts gate (30 km/h)"},
      {k: 'ring', p: [-552.7, 62.0]},
      {k: 'ring', p: [-508.2, 69.4]},
      {k: 'ring', p: [-463.8, 76.5]},
      {k: 'ring', p: [-438.6, 86.6], say: 'Turn right into Per Kvibergs gate'},
      {k: 'ring', p: [-432.9, 131.3]},
      {k: 'ring', p: [-435.8, 174.2]},
      {k: 'ring', p: [-452.3, 216.1]},
      {k: 'ring', p: [-477.4, 231.0], say: 'Turn right into Hegermanns gate'},
      {k: 'ring', p: [-518.5, 212.8], say: 'At the roundabout on Hegermanns plass: give way to traffic in it, keep right and take the first exit'},
      {k: 'ring', p: [-544.2, 192.2], r: 3.8},
      {k: 'ring', p: [-582.5, 185.0], say: 'Drive on along Hegermanns gate'},
      {k: 'ring', p: [-623.7, 166.8]},
      {k: 'ring', p: [-648.6, 146.4], limit: 40, say: 'Turn right into Vogts gate (40 km/h)'},
      {k: 'ring', p: [-642.6, 130.4], limit: 40},
      {k: 'ring', p: [-621.7, 90.5], limit: 40},
      {k: 'ring', p: [-620.1, 83.6], limit: 40},
      {k: 'ring', p: [-605.0, 46.4], limit: 40, say: "Turn left into Krebs' gate"},
      {k: 'ring', p: [-624.1, 42.4], say: 'Keep left of the lamp post, then park on the right by the school'},
      {k: 'stop', p: [-639.8, 33.7], r: 4, say: 'Stop in the green ring'}
    ]},
    // The sport plane: take off down the strip, a wide right-hand turn over the city to the south, and back to land on the
    // strip the other way (the ground falls away beyond its far end; behind the plane it rises with buildings).
    circuit: {frame: 'runway', origin: 'plane', heightRef: 'origin', maxAgl: 200, timeS: 420, gates: [
      {k: 'ring', p: [450, 0, 30], r: 15, say: 'Take off down the strip and climb through the first ring'},
      {k: 'ring', p: [900, -250, 70], r: 18},
      {k: 'ring', p: [1300, -150, 90], r: 20, say: 'Turn right'},
      {k: 'ring', p: [1450, 150, 90], r: 20, say: 'Turn back towards the airstrip'},
      {k: 'ring', p: [1250, 300, 80], r: 20},
      {k: 'ring', p: [950, 120, 60], r: 18, say: 'Line up with the strip'},
      {k: 'ring', p: [700, 0, 40], r: 15},
      {k: 'ring', p: [420, 0, 24], r: 14, say: 'Over the trees, then down onto the strip'},
      {k: 'land', p: [150, 0], box: {len: 300, wid: 40}, say: 'Land on the strip and stop'}
    ]},
    // The helicopter: hover over its pad, a loop out over the airstrip and back, hover, land on the pad.
    heli: {frame: 'offset', origin: 'heli', heightRef: 'origin', maxAgl: 120, timeS: 300, gates: [
      {k: 'hold', p: [0, 0, 3], r: 4, hold: 5, say: 'Lift off and hover about 3 m over the pad for 5 seconds'},
      {k: 'ring', p: [-40, -50, 35], r: 10, say: 'Climb out through the ring'},
      {k: 'ring', p: [-150, -110, 45], r: 12, say: 'Fly out over the airstrip'},
      {k: 'ring', p: [-190, 40, 45], r: 12},
      {k: 'ring', p: [-60, 60, 30], r: 10, say: 'Back towards the pad'},
      {k: 'hold', p: [0, 0, 4], r: 4, hold: 3, say: 'Hover over the pad'},
      {k: 'land', p: [0, 0], r: 5, say: 'Land on the pad'}
    ]},
    // The wheel loader on the site: through the rings at site speed (15 km/h), then stop in the green ring.
    siteM: {frame: 'local', ground: true, limit: 15, timeS: 240, gates: [
      {k: 'ring', p: [-40, 440], r: 4, say: 'Drive through the rings – site speed 15 km/h'},
      {k: 'ring', p: [-70, 452], r: 4},
      {k: 'ring', p: [-80, 425], r: 4},
      {k: 'ring', p: [-70, 395], r: 4},
      {k: 'ring', p: [-35, 385], r: 4},
      {k: 'stop', p: [-30, 410], r: 4.5, say: 'Stop in the green ring'}
    ]},
    // The tipper truck on the site.
    siteC: {frame: 'local', ground: true, limit: 15, timeS: 240, gates: [
      {k: 'ring', p: [-90, 398], r: 4, say: 'Drive through the rings – site speed 15 km/h'},
      {k: 'ring', p: [-50, 392], r: 4},
      {k: 'ring', p: [-30, 425], r: 4},
      {k: 'ring', p: [-60, 450], r: 4},
      {k: 'ring', p: [-85, 446], r: 4},
      {k: 'stop', p: [-72, 418], r: 4.5, say: 'Stop in the green ring'}
    ]},
    // The tower crane: hook one of the loads by the mast, carry it through the ring, set it down on the green mark.
    crane: {frame: 'local', crane: true, timeS: 360, gates: [
      {k: 'hook', p: [-126, 403], r: 3, say: 'Lower the hook to a load by the mast and hook it (✕)'},
      {k: 'ring', p: [-108, 396, 9], r: 3, say: 'Lift the load and carry it through the ring'},
      {k: 'drop', p: [-98, 400], r: 1.8, say: 'Set it down on the green mark (✕)'}
    ]}
  };

  function resolve(course, {toWorld, groundAt, origin} = {}) {
    const O = origin || {x: 0, z: 0, yaw: 0}, f = {x: -Math.sin(O.yaw || 0), z: -Math.cos(O.yaw || 0)}, r = {x: -f.z, z: f.x}, g0 = groundAt(O.x, O.z);
    const at = p => course.frame === 'local' ? toWorld(p[0], p[1]) : course.frame === 'runway' ? {x: O.x + f.x * p[0] + r.x * p[1], z: O.z + f.z * p[0] + r.z * p[1]} : {x: O.x + p[0], z: O.z + p[1]};
    let prev = course.start ? at(course.start) : {x: O.x, z: O.z};
    return course.gates.map(g => {
      const w = at(g.p), ground = groundAt(w.x, w.z), rr = g.r || (course.ground ? 3.4 : 10), h = g.p[2];
      const y = h == null ? ground + (g.k === 'ring' ? rr + .3 : .15) : (course.heightRef === 'origin' ? g0 : ground) + h;
      const yaw = Math.atan2(w.x - prev.x, w.z - prev.z);prev = w;
      const out = {k: g.k, x: w.x, y, z: w.z, r: rr, ground, yaw, air: !course.ground && !course.crane && g.k === 'ring', limit: g.limit, say: g.say, hold: g.hold};
      if (g.box) out.box = {len: g.box.len, wid: g.box.wid, ax: course.frame === 'runway' ? f : {x: Math.sin(yaw), z: Math.cos(yaw)}};
      if (course.crane && g.k === 'ring') out.air = true;
      return out;
    });
  }
  function inside(g, p) {
    const dx = p.x - g.x, dz = p.z - g.z;
    if (g.box) {const a = dx * g.box.ax.x + dz * g.box.ax.z, b = -dx * g.box.ax.z + dz * g.box.ax.x;return Math.abs(a) <= g.box.len / 2 && Math.abs(b) <= g.box.wid / 2;}
    return Math.hypot(dx, dz) <= g.r;
  }

  // ---------- The practical part ----------
  class Practical {
    constructor(course, gates) {
      this.c = course;this.gates = gates;this.i = 0;this.t = 0;this.state = 'run';this.why = null;this.detail = null;
      this.overT = 0;this.highT = 0;this.holdT = 0;this.prevSpeed = null;this.airborne = false;this.maxKmh = 0;this.hooked = false;this.passedAt = [];
    }
    get gate() {return this.gates[this.i];}
    get left() {return this.c.timeS ? Math.max(0, this.c.timeS - this.t) : null;}
    limitNow() {const g = this.gate;return g && g.limit != null ? g.limit : this.c.limit || null;}
    fail(why, detail) {this.state = 'failed';this.why = why;this.detail = detail || null;return this;}
    next() {this.passedAt.push(this.t);this.i++;this.holdT = 0;this.overT = 0;if (this.i >= this.gates.length) this.state = 'passed';}
    step(s) {
      if (this.state !== 'run') return this;
      const dt = Math.max(0, Math.min(.25, +s.dt || 0)), speed = Math.abs(+s.speed || 0);this.t += dt;
      if (!s.inVehicle) return this.fail('left');
      if (s.crashed) return this.fail('crash');
      // Ground vehicles: a sudden stop from speed means it ran into something (the game stops a blocked vehicle at once).
      if (this.c.ground && this.prevSpeed !== null && this.prevSpeed >= HIT_SPEED && speed < this.prevSpeed * .4) return this.fail('crash');
      this.prevSpeed = speed;
      if (this.c.timeS && this.t > this.c.timeS) return this.fail('time', this.c.timeS);
      const lim = this.limitNow(), kmh = speed * 3.6;
      if (lim) {if (kmh > lim + SPEED_TOL) {this.overT += dt;this.maxKmh = Math.max(this.maxKmh, kmh);if (this.overT > OVER_S) return this.fail('speed', {kmh: Math.round(this.maxKmh), limit: lim});} else {this.overT = 0;this.maxKmh = 0;}}
      if (this.c.maxAgl) {if ((+s.agl || 0) > this.c.maxAgl) {if ((this.highT += dt) > HIGH_S) return this.fail('high', this.c.maxAgl);} else this.highT = 0;}
      if ((+s.agl || 0) > 3 && !s.grounded) this.airborne = true;
      if (this.c.crane && this.hooked && s.dropped && this.gate.k !== 'drop') return this.fail('drop');
      const g = this.gate, p = s.point || s;
      if (g.k === 'ring') {if ((g.air ? Math.hypot(p.x - g.x, p.y - g.y, p.z - g.z) : Math.hypot(p.x - g.x, p.z - g.z)) <= g.r) this.next();}
      else if (g.k === 'hold') {if (Math.hypot(p.x - g.x, p.y - g.y, p.z - g.z) <= g.r && speed < HOLD_SPEED) {if ((this.holdT += dt) >= g.hold) this.next();} else this.holdT = 0;}
      else if (g.k === 'stop') {if (inside(g, p) && speed < .3) this.next();}
      else if (g.k === 'land') {const stopped = s.grounded && speed < 1;if (stopped && inside(g, p)) this.next();else if (stopped && this.airborne) return this.fail('outside');}
      else if (g.k === 'hook') {if (s.loaded) {this.hooked = true;this.next();}}
      else if (g.k === 'drop') {if (s.dropped) {if (inside(g, s.dropped)) this.next();else return this.fail('drop');}}
      return this;
    }
  }
  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  function failText(run) {
    const d = run.detail;
    return {
      left: 'You got out of the test vehicle.',
      crash: run.c.ground ? 'You ran into something.' : run.c.crane ? 'The crane hit something.' : 'You crashed.',
      speed: d ? `Too fast: ${d.kmh} km/h where the limit is ${d.limit} km/h.` : 'Too fast.',
      time: `Out of time: the test takes at most ${mmss(d || 0)}.`,
      high: `You flew higher than ${d} m above the ground.`,
      outside: 'You landed outside the marked place.',
      drop: 'You set the load down outside the green mark.',
      cancel: 'You stopped the test.',
      taken: 'Someone else took the test vehicle.'
    }[run.why] || 'The test was not passed.';
  }

  // ---------- Browser part ----------
  function create({T, scene, root, store = (typeof localStorage !== 'undefined' ? localStorage : null), onChange} = {}) {
    let state = load(store ? store.getItem(KEY) : null);
    const save = () => {try {if (store) store.setItem(KEY, JSON.stringify(state));} catch {}if (onChange) onChange();};
    const reload = () => {state = load(store ? store.getItem(KEY) : null);if (onChange) onChange();};
    if (typeof window !== 'undefined') window.addEventListener('haarklous-progress', reload);

    // Rings: the next one (bright) and the one after (faint); flat rings for stopping, landing, hovering and the crane marks.
    const ringGeo = new T.TorusGeometry(1, .055, 8, 56);
    const mat = (color, opacity) => new T.MeshBasicMaterial({color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, fog: false});
    const cur = new T.Mesh(ringGeo, mat(0xffb300, 1)), nxt = new T.Mesh(ringGeo, mat(0xffffff, .45)), goal = mat(0x2ee66b, 1);
    const ringMat = cur.material;
    for (const m of [cur, nxt]) {m.visible = false;m.renderOrder = 2;m.frustumCulled = false;scene.add(m);}
    function place(m, g) {
      m.visible = !!g;if (!g) return;
      const flat = g.k !== 'ring';m.position.set(g.x, g.y, g.z);m.rotation.set(flat ? Math.PI / 2 : 0, flat ? 0 : g.yaw, 0, 'YXZ');
      m.scale.setScalar(g.box ? Math.min(g.box.len, g.box.wid) / 2 : g.r);
    }
    const rings = {
      show(gates, i) {
        place(cur, gates && gates[i]);place(nxt, gates && gates[i + 1]);
        if (gates && gates[i]) cur.material = gates[i].k === 'stop' || gates[i].k === 'land' || gates[i].k === 'drop' ? goal : ringMat;
      },
      hide() {cur.visible = nxt.visible = false;},
      meshes: [cur, nxt]
    };

    // HUD (top left, like the jobs card) and the overlay for the test menus and the theory questions.
    const hudEl = document.createElement('div');hudEl.id = 'licHud';hudEl.hidden = true;root.append(hudEl);
    let hudKey = '';
    const hud = html => {if (html === hudKey) return;hudKey = html;hudEl.innerHTML = html || '';hudEl.hidden = !html;};
    const menuEl = document.createElement('div');menuEl.id = 'licMenu';menuEl.hidden = true;root.append(menuEl);
    const menu = {open: false, sel: 0, stick: false, spec: null};
    menu.show = spec => {menu.spec = spec;menu.open = true;menu.sel = 0;menu.render();};
    menu.close = () => {const s = menu.spec;menu.open = false;menu.spec = null;menuEl.hidden = true;if (s && s.onClose) s.onClose();};
    // A quiz: one question at a time, then done(answers).
    menu.quiz = (lic, done) => {const answers = [];menu.show({quiz: lic, answers, done, title: `${lic.icon} ${lic.name} · theory`});};
    menu.render = () => {
      menuEl.hidden = !menu.open;if (!menu.open) return;const s = menu.spec;
      if (s.quiz) {
        const n = s.answers.length, q = s.quiz.quiz[n];
        menuEl.innerHTML = `<b>${s.title} · question ${n + 1} of ${s.quiz.quiz.length}</b><small>${q.q}</small>` + q.a.map((a, i) => `<div class="${i === menu.sel ? 'sel' : ''}">${a}</div>`).join('') + `<small>At most ${s.quiz.maxWrong} wrong · ↑↓ choose · ✕ / Space answer · ○ / C stop</small>`;
        return;
      }
      const items = s.items();menu.sel = Math.max(0, Math.min(menu.sel, items.length - 1));
      menuEl.innerHTML = `<b>${s.title()}</b>${s.note ? `<small>${s.note()}</small>` : ''}` + items.map((e, i) => `<div class="${i === menu.sel ? 'sel' : ''}${e.done ? ' done' : ''}">${e.label}${e.sub ? `<small>${e.sub}</small>` : ''}</div>`).join('') + '<small>↑↓ choose · ✕ / Space take it · ○ / C close</small>';
    };
    menu.input = input => {
      const s = menu.spec, y = input.move.y;
      const count = s.quiz ? s.quiz.quiz[s.answers.length].a.length : s.items().length;
      if (input.pressed.has('up') || (y < -.5 && !menu.stick)) menu.sel = Math.max(0, menu.sel - 1);
      if (input.pressed.has('down') || (y > .5 && !menu.stick)) menu.sel = Math.min(count - 1, menu.sel + 1);
      menu.stick = Math.abs(y) > .5;
      if (input.pressed.has('cross')) {
        if (s.quiz) {
          s.answers.push(menu.sel);menu.sel = 0;
          if (s.answers.length >= s.quiz.quiz.length) {menu.open = false;menu.spec = null;menuEl.hidden = true;s.done(s.answers);}
        } else {const it = s.items()[menu.sel];if (it && !it.done) {if (!it.keep) menu.close();it.act();}}
      } else if (input.pressed.has('circle')) {if (s.quiz) {menu.open = false;menu.spec = null;menuEl.hidden = true;s.done(null);} else menu.close();}
      if (menu.open) menu.render();
      input.move.x = input.move.y = 0;['cross', 'circle', 'up', 'down', 'square', 'triangle', 'left', 'right', 'phone'].forEach(b => input.pressed.delete(b));
    };

    // A sign at a test place: a board on two posts with the place's name and its tests (merged per material by the caller).
    function sign(lines, colors = {bg: '#0d3b66', band: '#f4d35e', ink: '#0d3b66'}) {
      const c = document.createElement('canvas');c.width = 256;c.height = 320;const k = c.getContext('2d');
      k.fillStyle = colors.bg;k.fillRect(0, 0, 256, 320);k.fillStyle = colors.band;k.fillRect(0, 0, 256, 72);
      k.fillStyle = colors.ink;k.textAlign = 'center';k.font = 'bold 34px system-ui, Arial';k.fillText(lines[0], 128, 50);
      k.fillStyle = '#fff';lines.slice(1).forEach((t, i) => {k.font = i === lines.length - 2 ? '22px system-ui, Arial' : 'bold 26px system-ui, Arial';k.fillText(t, 128, 120 + i * 46);});
      const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;tex.anisotropy = 4;
      const face = new T.MeshStandardMaterial({map: tex, roughness: .5}), post = new T.MeshStandardMaterial({color: 0x3a3f45, roughness: .45, metalness: .5});
      const g = new T.Group(), board = new T.Mesh(new T.BoxGeometry(.8, 1, .05), [post, post, post, post, face, face]);board.position.y = 1.6;board.castShadow = true;g.add(board);
      for (const sx of [-1, 1]) {const p = new T.Mesh(new T.CylinderGeometry(.03, .03, 2.1, 8), post);p.position.set(sx * .36, 1.05, 0);p.castShadow = true;g.add(p);}
      return g;
    }

    return {
      get state() {return state;}, has: id => has(state, id), missing: id => missing(state, id), save, reload,
      grant(id) {grant(state, id);save();}, passTheory(id) {passTheory(state, id);save();}, failed(id, part) {fail(state, id, part);save();}, fees: L => fees(state, L),
      get count() {return IDS.filter(id => has(state, id)).length;}, total: IDS.length,
      rings, hud, menu, sign
    };
  }

  return {KEY, LICENCES, IDS, byId, PLACES, need, load, has, missing, grant, passTheory, fail, fees, score, passed, COURSES, resolve, inside, Practical, failText, mmss, create, SPEED_TOL, OVER_S};
});
