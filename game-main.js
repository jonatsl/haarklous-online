/* Haarklous plass — open-world game main loop.
 * Walk the neighbourhood, enter buildings, ride the Honda, drive cars and the excavator, play disc golf and petanque,
 * take photos, drink (carefully), and start the hostage-rescue mission at the street door of Haarklous plass 17A.
 * World coordinates are the apartment model's metres (4th-floor floor at y = 0, street at about y = -10).
 */
(() => {
  'use strict';
  const T = window.THREE, D = window.SURROUNDINGS, collision = window.WalkCollision, padReader = window.GamepadControls;
  const view = document.getElementById('game'), loading = document.getElementById('loading');
  const $ = id => document.getElementById(id);
  let caseGame = null;
  // ---------- Renderer, scenes, light ----------
  let renderer;
  try {renderer = new T.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});}
  catch {loading.textContent = 'WebGL could not start. Use a browser with hardware acceleration.';return;}
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;renderer.shadowMap.type = T.PCFSoftShadowMap;renderer.outputColorSpace = T.SRGBColorSpace;renderer.toneMapping = T.ACESFilmicToneMapping;renderer.toneMappingExposure = 1.05;
  view.prepend(renderer.domElement);const canvas = renderer.domElement;canvas.tabIndex = 0;
  const lib = window.RealMaterials.create(T, renderer);
  const scene = new T.Scene(), farScene = new T.Scene();
  scene.fog = new T.FogExp2(0xc6d3dc, .0011);farScene.fog = new T.FogExp2(0xc6d3dc, .00011);scene.environment = lib.environment();
  const camera = new T.PerspectiveCamera(70, 1, .05, 450), farCamera = new T.PerspectiveCamera(70, 1, 15, 40000);
  const theta = D.geo.theta, sunDir = (() => {const b = 225 * Math.PI / 180, e = 38 * Math.PI / 180, x = Math.sin(b), z = -Math.cos(b);return new T.Vector3((x * Math.cos(theta) + z * Math.sin(theta)) * Math.cos(e), Math.sin(e), (-x * Math.sin(theta) + z * Math.cos(theta)) * Math.cos(e)).normalize();})();
  const sun = new T.DirectionalLight(0xfff3e0, 3.4);sun.castShadow = true;sun.shadow.mapSize.set(2048, 2048);sun.shadow.bias = -.0004;
  // normalBias removes the striped "shadow acne" that flickered on interior walls.
  sun.shadow.normalBias = .035;scene.add(sun, sun.target);
  const sky = new T.HemisphereLight(0xe3f4ff, 0xb9b09c, 1.7);scene.add(sky);
  const towerLamp = new T.PointLight(0xffe9c8, 0, 7, 1.6);scene.add(towerLamp);

  // ---------- World ----------
  const audio = window.GameAudio.create();
  // Soundtrack: a calm 2.5-minute open-world loop, and its own loop for disc golf, petanque and the hostage rescue.
  const music = window.GameMusic.create();
  // Joker and Kiwi are cut into the ground floors of their real buildings (this has to happen before the buildings are built).
  window.GameShops.applyNotches(D);
  // The construction site and the paintball yard (ported from the Unreal version): no trees or bushes grow in them.
  const SITE_DATA = window.SITE, PB_DATA = window.PAINTBALL;
  const holes = [SITE_DATA && {x0: SITE_DATA.rect.x0, s0: SITE_DATA.rect.s0, x1: SITE_DATA.rect.x0 + SITE_DATA.rect.w, s1: SITE_DATA.rect.s0 + SITE_DATA.rect.d, cutGround: true},
    PB_DATA && {x0: PB_DATA.rect.x0 - 1, s0: PB_DATA.rect.s0 - 1, x1: PB_DATA.rect.x0 + PB_DATA.rect.w + 1, s1: PB_DATA.rect.s0 + PB_DATA.rect.d + 1},
    // The yard's own floor and retaining walls replace the ground there: without this cut the hillside was drawn through the
    // yard, up to 4.6 m above the floor, and players on it looked as if they were under the ground (issue #26).
    PB_DATA && {x0: PB_DATA.rect.x0, s0: PB_DATA.rect.s0, x1: PB_DATA.rect.x0 + PB_DATA.rect.w, s1: PB_DATA.rect.s0 + PB_DATA.rect.d, cutGround: true},
    // The catacomb's three mausoleums stand over holes in the ground (their stairs start inside, issue #43).
    ...(window.CatacombLayout ? window.CatacombLayout.holes() : [])].filter(Boolean);
  // District patches beyond the old square (issue #38): Gamle Oslo, Ensjø and the way there, with its key buildings.
  const DISTRICTS = window.District ? (window.DISTRICTS || []).map(d => window.District.decode(d)) : [];
  // Kiwi Storgata 33 (issue #65) is cut into its office building in the Gamle Oslo patch, like Joker and Kiwi in the old square.
  window.GameShops.applyDistrictNotches(DISTRICTS);
  // Grünerløkka (issues #44, #45): Deichman Grünerløkka draws its own building, Rathkes gate 1 gets the passage to its
  // backyard, and Akerselva's bed is lowered along the river so its water shows in the ground grids.
  if (window.GameLibrary) window.GameLibrary.prepare(DISTRICTS);if (window.GameRathkes) window.GameRathkes.prepare(DISTRICTS);if (window.GameKayak && window.AKERSELVA) window.GameKayak.prepare(DISTRICTS, D);
  // Klatreverket (issue #40) builds its own building at Myrens verksted, and the patch's ground under its hall goes just below the floor.
  if (window.GameClimbing && window.KLATREVERKET) window.GameClimbing.prepare(DISTRICTS, window.KLATREVERKET, D.ground, window.District && window.District.flatten);
  const world = window.Surroundings.create({T, lib, data: D, renderer, holes, districts: DISTRICTS, onStatus: t => {const el = $('imageryStatus');if (el) el.textContent = t;}});
  scene.add(world.near);farScene.add(world.far);world.setSun(sunDir);
  const landmarks = window.GameLandmarks ? window.GameLandmarks.create({T, lib, world}) : {obstacles: [], vehicleObstacles: [], floors: [], poi: []};
  // The catacomb under Torshovdalen (issue #43): three mausoleums, long stairs, torch-lit bone galleries and dark quarry tunnels.
  const catacomb = window.GameCatacomb ? window.GameCatacomb.create({T, lib, world, audio}) : null;if (catacomb) scene.add(catacomb.group);
  // Grünerløkka (issues #44, #45, #47): the library with its books and the librarian, table tennis in the park at Schous plass,
  // the gate and backyard of Rathkes gate 1 (for the coming flat 1C) and kayaking down Akerselva from three put-ins.
  const library = window.GameLibrary && DISTRICTS.length ? window.GameLibrary.create({T, lib, world, audio, root: view}) : null;
  const pingpong = window.GameTableTennis && DISTRICTS.length ? window.GameTableTennis.create({T, lib, world, audio, root: view, at: {x: -901.5, s: 1771.5}, bearing: 90}) : null;
  const rathkes = window.GameRathkes && DISTRICTS.length ? window.GameRathkes.create({T, lib, world}) : null;
  const kayak = window.GameKayak && window.AKERSELVA ? window.GameKayak.create({T, lib, data: window.AKERSELVA, world, audio, districts: DISTRICTS}) : null;
  const grl = [library, pingpong, rathkes, kayak].filter(Boolean);grl.forEach(m => {scene.add(m.group);m.group.updateMatrixWorld(true);});
  let hushed = 0;// seconds the librarian's shush keeps you walking
  const apt = window.GameApartment.build({T, lib, data: window.APARTMENT});scene.add(apt.group);
  // Stair towers: ours (model coordinates) and one in each enterable neighbouring building.
  const towers = [];
  const ownStair = window.Stairwell.create({T, lib, own: true, id: 'own', wallTop: D.own.top});scene.add(ownStair.group);ownStair.group.updateMatrixWorld(true);
  towers.push({stair: ownStair, matrix: ownStair.group.matrixWorld.clone(), own: true});
  D.enterable.forEach((e, i) => {
    const b = D.buildings[e.b], geo = new T.Group();geo.rotation.y = theta;geo.position.set(D.geo.x, 0, D.geo.z);scene.add(geo);
    const s = window.Stairwell.create({T, lib, own: false, id: 'b' + i, wallTop: b.top - e.y});s.group.position.set(e.x, e.y, e.s);s.group.rotation.y = e.rot;geo.add(s.group);geo.updateMatrixWorld(true);
    towers.push({stair: s, matrix: s.group.matrixWorld.clone(), building: b});
  });
  towers.forEach(t => {t.inverse = t.matrix.clone().invert();});
  const xf = (m, x, z) => {const v = new T.Vector3(x, 0, z).applyMatrix4(m);return {x: v.x, z: v.z};};
  function towerFloors(t) {
    const m = t.matrix, e = m.elements, dy = e[13];
    return t.stair.floors().map(f => {
      const out = {...f, points: f.points.map(p => xf(m, p.x, p.z)), y: (f.y ?? 0) + dy, surfaceKind: 'stone', tower: t};
      if (f.slope) {const o = xf(m, f.slope.origin.x, f.slope.origin.z), gx = f.slope.x, gz = f.slope.z;out.slope = {x: e[0] * gx + e[8] * gz, z: e[2] * gx + e[10] * gz, origin: o};}
      return out;
    });
  }
  const towerObstacles = t => t.stair.obstacles().map(o => ({points: o.points.map(p => xf(t.matrix, p.x, p.z)), minY: o.minY + t.matrix.elements[13], maxY: o.maxY + t.matrix.elements[13], kind: 'tower'}));
  // Firepit with five benches in the park in front of the building (the fire level is shared in multiplayer).
  const FIRE_POS = {x: -2.7, z: 34.7}, fire = window.GameFire.create({T, lib, heightAt: world.heightWorld, x: FIRE_POS.x, z: FIRE_POS.z});scene.add(fire.group);
  // Three hidden stashes (issue #2): the top landing of a neighbour's stairwell, the courtyard behind the building and the
  // bushes in the park north of the block. Each crate has lines to snort and a syringe: a random 30-second boost.
  const stash = (() => {
    const t = towers.filter(x => !x.own)[4], top = new T.Vector3(.1, 0, 5.38).applyMatrix4(t.matrix), e = t.matrix.elements;
    const at = (name, x, z, yaw) => ({name, x, z, y: world.heightWorld(x, z), yaw});
    return window.GameStash.create({T, lib, places: [{name: 'stairwell', x: top.x, y: top.y, z: top.z, yaw: Math.atan2(e[8], e[0])}, at('courtyard', -2.8, -41.7, .4), at('park', 104.5, 162.2, 1.2)]});
  })();scene.add(stash.group);
  const shops = window.GameShops.create({T, lib, world, audio});scene.add(shops.group);
  // Klatreverket Torshov (issue #40): the climbing centre in its real building at Myrens verksted 3K, about 980 m west-south-west.
  const gym = window.GameClimbing.create({T, lib, data: window.KLATREVERKET, toWorld: world.toWorld, heightAt: world.heightWorld, avatars: window.GameAvatars.create({T, lib}), audio});scene.add(gym.group, gym.extras);
  // HODET N.N., Marianne Heske's 7 m bronze doll's head at the north end of Torshovdalen (OSM node 2965223021, real place
  // local (9.1, 275.5)), facing south, with its stone steps on the east side.
  const SCULPTURE_AT = {x: 9.1, s: 275.5};
  const sculpture = window.GameSculpture.create({T, lib, world, at: SCULPTURE_AT});scene.add(sculpture.group);
  // Oksefontenen with Torshovoksen in the middle of Hegermanns plass (OSM node 331273417, issue #20), the bull facing SSW.
  const OKSEN_AT = {x: -542.0, s: 204.3};
  const oksen = window.GameSculpture.createFountain({T, lib, world, at: OKSEN_AT, bearing: 204});scene.add(oksen.group);
  // Real weather (issue #23): MET Norway's forecast for Haarklous plass through the game's Worker (/weather), every hour. Clouds
  // dim the sun and grey the sky, fog thickens the haze, rain / sleet / snow fall around you outdoors, the wind blows them and is
  // heard, and the pause screen shows it with the credit. Offline it stays as the fixed sunny day.
  const WEATHER_URL = new URLSearchParams(location.search).get('weather') || (/workers\.dev$/.test(location.hostname) ? '/weather' : 'https://haarklous-online.server-smoke.workers.dev/weather');
  const BASE_LIGHT = {sun: sun.intensity, sky: sky.intensity, fog: scene.fog.density, farFog: farScene.fog.density, fogColor: scene.fog.color.clone()};
  // The near haze is tuned for a 450 m view on foot; when the view reaches further (flying, skydiving) it thins in step,
  // so the ground below is not washed out while the far layer beyond it looks clear.
  let nearFog = scene.fog.density;
  function applyNearFog() {scene.fog.density = nearFog * Math.min(1, 450 / camera.far);}
  let weatherWind = {x: 0, z: 0};
  function applyWeather(w) {
    const c = w.clouds, wet = ['rain', 'sleet', 'snow'].includes(w.kind) ? w.intensity : 0, overcast = Math.min(1, c * 1.05 + wet * .25 + w.fog * .5);
    sun.intensity = BASE_LIGHT.sun * (1 - .72 * Math.pow(overcast, 1.3));sky.intensity = BASE_LIGHT.sky * (1 + .12 * overcast);
    nearFog = BASE_LIGHT.fog * (1 + .8 * overcast) + w.fog * .018 + wet * .0035;applyNearFog();farScene.fog.density = BASE_LIGHT.farFog * (1 + 1.5 * overcast) + w.fog * .002;
    scene.fog.color.copy(BASE_LIGHT.fogColor).lerp(new T.Color(0xa7aeb5), overcast);farScene.fog.color.copy(scene.fog.color);world.setOvercast(overcast);
    // Wind blows toward (from + 180°); north is -s on the map, east is +x.
    const to = (w.windFrom + 180) * Math.PI / 180, lx = Math.sin(to), ls = -Math.cos(to), cT = Math.cos(theta), sT = Math.sin(theta);
    weatherWind = {x: (lx * cT + ls * sT) * w.wind, z: (-lx * sT + ls * cT) * w.wind};
    const at = new Date(w.fetchedAt || Date.now()), hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    $('weatherLine').innerHTML = `Weather now at Haarklous plass: ${window.GameWeather.describe(w)} · data from <a href="https://api.met.no/" target="_blank" rel="noopener">MET Norway</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>), fetched ${hhmm}`;
    if (!weather.shown) {weather.shown = true;notice(`Real weather: ${window.GameWeather.describe(w)} (MET Norway)`, 5);}
  }
  const weather = window.GameWeather.create({T, url: WEATHER_URL, onChange: w => applyWeather(w)});scene.add(weather.group);weather.load();
  // Ground: the building site's soil (it changes as the machines dig), the paved paintball yard, the terrain elsewhere.
  const siteField = SITE_DATA && window.GameSite ? window.GameSite.fieldFor(SITE_DATA, world) : null;
  const pbCtx = {};// filled in below, once the player, camera and lobby exist
  const pbRules = PB_DATA && window.GamePaintball ? new window.GamePaintball.Rules(PB_DATA, pbCtx) : null;
  function groundAt(x, z) {
    if (kayak) {const y = kayak.groundAt(x, z);if (y !== null) return y;}// bridge decks over Akerselva
    if (siteField) {const y = siteField.surface(x, z);if (y !== null) return y;}
    if (pbRules) {const y = pbRules.ground(x, z);if (y !== null) return y;}
    {const y = gym.ground(x, z);if (y !== null) return y;}// the climbing hall's floor (the terrain model rises through the building)
    return world.heightWorld(x, z);
  }
  // Inside a catacomb mausoleum the ground is not walked on: its door threshold, landing and stair take over (far below = no floor).
  const groundFloors = world.terrainFloors().map(f => ({...f, height: p => catacomb && catacomb.cutsGround(p.x, p.z) ? -1e4 : groundAt(p.x, p.z)}));
  // Oslo city bike docks (issue #57) at their real places, from the operator's open data: posts and a totem with the name.
  const rides = window.GameRentals && window.RIDES ? window.GameRentals.create({T, lib, audio, data: window.RIDES, toWorld: world.toWorld, heightAt: groundAt}) : null;
  if (rides) scene.add(rides.group);
  // KIWI Storgata (issue #65): the regulars outside Kiwi Storgata 33, Sopp-Sigvald the mushroom wizard on the corner, and Rolf on a
  // bench at Schous plass (OSM-free spot beside the footway, 11 m from the table tennis table), facing the table.
  const storgataShop = shops.shops.find(sh => sh.id === 'kiwi-storgata');
  const storgata = storgataShop && window.GameStorgata ? window.GameStorgata.create({T, lib, avatars: window.GameAvatars.create({T, lib}), world, groundAt, front: storgataShop.local, root: view, audio,
    rolf: (() => {const p = world.toWorld(-909.5, 1763.5), t = world.toWorld(-901.5, 1771.5);return {x: p.x, z: p.z, yaw: Math.atan2(-(t.x - p.x), -(t.z - p.z))};})()}) : null;
  if (storgata) scene.add(storgata.group);
  // Sopp-Sigvald's magic (GameMagic): the powers you have learned, mana and cooldowns; the particles and the light orb.
  const magic = new window.GameMagic.Magic(storgata ? Object.keys(storgata.state.powers) : []), fx = window.GameMagic.effects({T, scene});
  let magicKick = 0, questWp = null;// the blink's short widening of the view; the waypoint a quest set
  window.addEventListener('haarklous-progress', () => {if (!storgata) return;magic.known = new Set();magic.sel = null;for (const id of Object.keys(storgata.state.powers)) magic.learn(id);if (!magic.knows('orb')) {magic.orb = false;fx.orb.on = false;}});
  // Job signs (issue #56) beside the doors of Joker and Kiwi; □ there opens the jobs phone. Their doors are delivery pickups too.
  const JOB_SIGNS = shops.shops.filter(sh => sh.jobs !== false).map(sh => {
    const L = sh.local, at = (a, b) => world.toWorld(L.P0[0] + L.u[0] * a + L.n[0] * b, L.P0[1] + L.u[1] * a + L.n[1] * b), door = L.W - 2;
    const p = at(door - 2.3, -1.3), q = at(door - 2.3, -.3), pick = world.toLocal(at(door, -1.4).x, at(door, -1.4).z);
    return {shop: sh, x: p.x, z: p.z, yaw: Math.atan2(-(q.x - p.x), -(q.z - p.z)), pickup: {name: sh.name, kind: 'shop', shop: true, x: pick.x, s: pick.s}};
  });
  const signObstacles = JOB_SIGNS.map(j => {const y = groundAt(j.x, j.z);return {points: [[-.5, -.15], [.5, -.15], [.5, .15], [-.5, .15]].map(([a, b]) => ({x: j.x + Math.cos(j.yaw) * a + Math.sin(j.yaw) * b, z: j.z - Math.sin(j.yaw) * a + Math.cos(j.yaw) * b})), minY: y - .3, maxY: y + 2.2, kind: 'sign'};});
  const extraObstacles = [...(siteField ? window.GameSite.fenceObstacles(siteField, groundAt) : []), ...(pbRules ? pbRules.obstacles : []), ...(catacomb ? catacomb.obstacles : []), ...(rides ? rides.obstacles : []), ...signObstacles, ...(storgata ? storgata.obstacles : [])];
  const staticObstacles = [...apt.obstacles, ...towers.flatMap(towerObstacles), ...world.obstacles(), ...fire.obstacles, ...stash.obstacles, ...shops.obstacles, ...sculpture.obstacles, ...oksen.obstacles, ...gym.obstacles, ...extraObstacles, ...landmarks.obstacles];
  const walkFloors = [...apt.floors, ...towers.flatMap(towerFloors), ...shops.floors, ...sculpture.floors, ...oksen.floors, ...landmarks.floors, ...gym.floors, ...(catacomb ? catacomb.floors : []), ...groundFloors];
  staticObstacles.push(...grl.flatMap(m => m.obstacles || []));walkFloors.unshift(...grl.flatMap(m => m.floors || []));
  const walkWorld = collision.createWorld({floors: walkFloors, obstacles: staticObstacles, radius: .18, clearance: .08});
  const vehicleWorlds = new Map();
  let vehicleBlockers = null;// the other vehicles' footprints from the last updateDynamic()
  function worldFor(r) {
    const key = r.toFixed(2);
    if (!vehicleWorlds.has(key)) {
      const w = collision.createWorld({floors: groundFloors, obstacles: [...grl.flatMap(m => m.obstacles || []), ...landmarks.obstacles, ...landmarks.vehicleObstacles, ...world.obstacles(), ...towers.flatMap(towerObstacles), ...fire.obstacles, ...shops.obstacles, ...sculpture.obstacles, ...oksen.obstacles, ...gym.obstacles, ...extraObstacles, ...(catacomb ? catacomb.vehicleObstacles : [])], radius: r, clearance: .08});
      // A world made during play (e.g. the bike's on its first ride) gets the other vehicles at once, not one update later.
      if (vehicleBlockers) collision.setDynamic(w, vehicleBlockers);
      vehicleWorlds.set(key, w);
    }
    return vehicleWorlds.get(key);
  }
  const doors = [...apt.doors, ...towers.flatMap(t => t.stair.doors), ...(rathkes ? rathkes.doors : [])];
  const shootTargets = [];[apt.group, ownStair.group].forEach(g => g.traverse(o => {if (o.isMesh && !(o.material.transparent) && o.visible) shootTargets.push(o);}));
  const interactables = [];[apt.group, ...towers.map(t => t.stair.group)].forEach(g => g.traverse(o => {if (o.isMesh && (o.userData.doorId || o.userData.lockedDoor)) interactables.push(o);}));
  apt.drinks.forEach(d => d.object.traverse(o => {if (o.isMesh) {o.userData.drink = d;interactables.push(o);}}));
  interactables.push(...stash.hitboxes, ...shops.hitboxes, ...gym.hitboxes, ...(storgata ? storgata.hitboxes : []));
  interactables.push(...grl.flatMap(m => m.hitboxes || []));

  // ---------- Vehicles ----------
  const toWorld = world.toWorld, heightAt = groundAt;
  const localHeadingToYaw = h => {const dx = Math.sin(h), ds = Math.cos(h), wx = dx * Math.cos(theta) + ds * Math.sin(theta), wz = -dx * Math.sin(theta) + ds * Math.cos(theta);return Math.atan2(-wx, -wz);};
  const VH = window.GameVehicles.create({T, lib, audio, heightAt, collision, worldFor});
  const vehicles = [];
  D.vehicles.cars.forEach(c => {const p = toWorld(c.x, c.s);vehicles.push(new VH.Car(p.x, p.z, localHeadingToYaw(c.heading), c.model));});
  {const p = toWorld(D.vehicles.motorcycle.x, D.vehicles.motorcycle.s);vehicles.push(new VH.Motorcycle(p.x, p.z, Math.PI / 2 + .3));}
  {const p = toWorld(D.vehicles.excavator.x, D.vehicles.excavator.s);const ex = new VH.Excavator(p.x, p.z, -.4);vehicles.push(ex);}
  // Aircraft: the helicopter on the grass beside Haarklous plass, the sport plane at the north end of the long grass strip in
  // Torshovdalen (about 280 m clear, nose pointing down the strip).
  const AC = window.GameAircraft.create({T, lib, audio, heightAt, collision, worldFor});
  const AIR = {heli: {x: 26, z: 14, yaw: .6}, plane: {x: -116.5, z: 0, yaw: .5236}};
  const heli = new AC.Helicopter(AIR.heli.x, AIR.heli.z, AIR.heli.yaw), plane = new AC.Plane(AIR.plane.x, AIR.plane.z, AIR.plane.yaw);
  heli.onCrash = plane.onCrash = a => {if (player.vehicle === a) notice('Crashed! The aircraft is put back on its pad in a moment.', 3);};
  vehicles.push(heli, plane);
  const drone = new AC.Drone();
  // The skydivers' landing target (issue #58, badge "On target"): a painted circle on the grass, 180 m down the airstrip.
  const SKY_TARGET = {x: AIR.plane.x - Math.sin(AIR.plane.yaw) * 180, z: AIR.plane.z - Math.cos(AIR.plane.yaw) * 180};
  {
    const R = 10.5, c = document.createElement('canvas');c.width = c.height = 256;const g = c.getContext('2d');
    for (const [r, col] of [[10.5, '#ff6d00'], [9.7, '#f4f4f4'], [5, '#ff6d00'], [4.2, '#f4f4f4'], [1.5, '#e53935']]) {g.fillStyle = col;g.beginPath();g.arc(128, 128, r / R * 127, 0, Math.PI * 2);g.fill();}
    const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;tex.anisotropy = 4;
    // A small grid laid on the ground (it follows the slope) with the circle cut out by alphaTest.
    const geo = new T.PlaneGeometry(2 * R, 2 * R, 14, 14);geo.rotateX(-Math.PI / 2);const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {const x = SKY_TARGET.x + pos.getX(i), z = SKY_TARGET.z + pos.getZ(i);pos.setXYZ(i, x, groundAt(x, z) + .05, z);}
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, new T.MeshLambertMaterial({map: tex, alphaTest: .5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2}));
    m.name = 'Skydiving target';m.receiveShadow = true;scene.add(m);
  }
  // More parked cars and motorcycles along the streets within about 330 m. Generated deterministically (seeded random,
  // same checks), so in multiplayer every player has the same vehicles with the same numbers.
  {
    let seed = 1707;const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const kinds = ['residential', 'tertiary', 'secondary', 'unclassified', 'service', 'living_street'], roads = D.roads.filter(r => kinds.includes(r.k));
    const segs = roads.flatMap((r, ri) => {const o = [];for (let k = 0; k + 3 < r.p.length; k += 2) o.push({ri, w: r.w, a: [r.p[k], r.p[k + 1]], b: [r.p[k + 2], r.p[k + 3]]});return o;});
    const segDist = (p, s) => {const dx = s.b[0] - s.a[0], ds = s.b[1] - s.a[1], L = dx * dx + ds * ds || 1, t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * ds) / L));return Math.hypot(p[0] - s.a[0] - dx * t, p[1] - s.a[1] - ds * t);};
    const runway = {a: [AIR.plane.x, AIR.plane.z], b: [AIR.plane.x - Math.sin(AIR.plane.yaw) * 280, AIR.plane.z - Math.cos(AIR.plane.yaw) * 280]};
    const keep = [{x: AIR.heli.x, z: AIR.heli.z, r: 14}, {x: FIRE_POS.x, z: FIRE_POS.z, r: 9}, ...vehicles.map(v => ({x: v.x, z: v.z, r: 7})), ...(rides ? rides.keepOut : [])];
    const w = worldFor(1.25), bikeColors = [0x16171a, 0x9e1b20, 0xa9afb5, 0x1f3a63, 0xe9e9e4, 0x56657c];let cars = 0, bikes = 0;
    for (const s of segs) {
      const dx = s.b[0] - s.a[0], ds = s.b[1] - s.a[1], L = Math.hypot(dx, ds);if (L < 20) continue;
      for (let t = 9 + rnd() * 10; t < L - 9 && cars + bikes < 32; t += 26 + rnd() * 16) {
        const side = rnd() < .5 ? 1 : -1, ux = dx / L, us = ds / L, off = s.w / 2 + 1.25;
        const lp = [s.a[0] + ux * t - us * off * side, s.a[1] + us * t + ux * off * side];if (Math.hypot(lp[0], lp[1]) > 330) continue;
        if (segs.some(o => o.ri !== s.ri && segDist(lp, o) < 10)) continue;
        const p = toWorld(lp[0], lp[1]), h = heightAt(p.x, p.z);
        if (keep.some(k => Math.hypot(k.x - p.x, k.z - p.z) < k.r) || segDist([p.x, p.z], runway) < 12) continue;
        const yaw = localHeadingToYaw(Math.atan2(ux * side, us * side)), f = {x: -Math.sin(yaw), z: -Math.cos(yaw)};
        if (Math.abs(heightAt(p.x + f.x * 2, p.z + f.z * 2) - heightAt(p.x - f.x * 2, p.z - f.z * 2)) > 1.1) continue;
        if (!collision.canStand(w, p, 1.4, h) || !collision.canStand(w, {x: p.x + f.x * 1.6, z: p.z + f.z * 1.6}, 1.4, h) || !collision.canStand(w, {x: p.x - f.x * 1.6, z: p.z - f.z * 1.6}, 1.4, h)) continue;
        const bike = bikes < 7 && (cars + bikes) % 4 === 3, v = bike ? new VH.Motorcycle(p.x, p.z, yaw + .25, bikeColors[bikes % bikeColors.length]) : new VH.Car(p.x, p.z, yaw, Math.floor(rnd() * 7));
        if (bike) bikes++;else cars++;vehicles.push(v);keep.push({x: p.x, z: p.z, r: 7});
      }
    }
  }
  const dirtPiles = [];
  const pile = (x, z, r) => {const m = new T.Mesh(new T.ConeGeometry(r, r * .7, 14), lib.concrete(0x6b5541));m.position.set(x, heightAt(x, z) + r * .3, z);m.castShadow = m.receiveShadow = true;scene.add(m);dirtPiles.push(m);};
  // The construction site's machines come after the street vehicles, so the older vehicle numbers stay the same online.
  // Soil a machine puts down outside the site makes a heap like the street excavator's (a cone of that volume).
  let spilled = 0;
  const site = siteField && window.SiteModels ? window.GameSite.create({T, lib, audio, VH, models: window.SiteModels.create({T, lib}), data: SITE_DATA, world, field: siteField, groundAt, surfaceAt: world.surfaceAt,
    onSpill: (x, z, vol) => {spilled += vol;if (spilled < .4) return;pile(x, z, Math.max(.4, Math.min(2.2, Math.cbrt(spilled * 3 / (Math.PI * .7)))));spilled = 0;}}) : null;
  if (site) {scene.add(site.group);vehicles.push(...site.machines);}
  // Skydiving (issue #22): the Cessna 208 Caravan jump plane beside the airstrip, flown by a player with up to 12 jumpers.
  AIR.jump = {x: -107.6, z: -16.7, yaw: .5236};
  const caravan = new AC.JumpPlane(AIR.jump.x, AIR.jump.z, AIR.jump.yaw);vehicles.push(caravan);
  // City bikes in the docks and e-scooters on the pavements (issue #57), after every older vehicle so their numbers stay.
  // The scooters' places are seeded and checked the same way on every computer, so the lobby agrees on them.
  if (rides) {
    const RV = rides.vehicles(VH);vehicles.push(...RV.bikes);
    const w = worldFor(.6), taken = vehicles.map(v => ({x: v.x, z: v.z, r: 4})).concat(rides.keepOut);
    const regions = [{count: 26, inside: (x, s) => Math.hypot(x, s) < 520}, {count: 22, inside: (x, s) => x > -1250 && x < -350 && s > 880 && s < 2000}];
    const spots = window.GameRentals.scooterSpots({roads: [...D.roads, ...DISTRICTS.flatMap(d => d.roads)], regions, ok: (x, s) => {
      const p = toWorld(x, s);if (taken.some(k => Math.hypot(k.x - p.x, k.z - p.z) < k.r)) return false;
      const y = heightAt(p.x, p.z);return collision.canStand(w, p, 1.4, y) && collision.canStand(w, {x: p.x + .5, z: p.z}, 1.4, y) && collision.canStand(w, {x: p.x - .5, z: p.z}, 1.4, y);}});
    vehicles.push(...RV.placeScooters(spots));
  }
  vehicles.forEach(v => {v.spawn = v.netGet();});
  vehicles.forEach(v => scene.add(v.group));
  vehicles.filter(v => v.kind === 'excavator').forEach(ex => {
    const f = ex.forward();pile(ex.x + f.x * 6, ex.z + f.z * 6, 1.4);ex.onDump = (x, z) => pile(x, z, .55);
  });

  // ---------- HUD ----------
  const hud = {
    discgolf(s) {const el = $('discHud');if (!s) {el.hidden = true;return;}el.hidden = false;el.innerHTML = `<b>${s.course} · Hull ${s.hole}/${s.holes} · Par ${s.par}</b><span>Throws: ${s.strokes.map((n, i) => `H${i + 1} ${n}`).join(' · ')}</span><span>${s.distance} m to the ${s.walk ? 'tee' : 'basket'}</span><i class="meter"><u style="width:${Math.round(s.charge * 100)}%"></u></i><small>${s.message}</small><small>${s.walk ? 'Walk or run to the tee · □ straight there · ○ quit' : 'Hold R2 / left mouse, release to throw · left stick ←/→ hyzer · ○ quit'}</small>`;},
    petanque(s) {
      const el = $('petanqueHud'), marks = $('markers');if (!s) {el.hidden = true;marks.replaceChildren();return;}el.hidden = false;
      el.innerHTML = `<b>Petanque · You ${s.score.you} – ${s.score.npc} ${s.npcName}</b><span>Mène ${s.mene} · Boules left: you ${s.you}, ${s.npcName} ${s.npc}</span><span>${s.hold ? (s.hold === 'you' ? `You hold the point by ${s.margin.toFixed(2)} m` : `${s.npcName} holds the point by ${s.margin.toFixed(2)} m`) : 'Nobody holds the point'}</span><span>${s.turn === 'you' ? `Your turn: ${s.aim === 'jack' ? 'throw the jack (6–10 m)' : (s.shoot ? 'shoot (L2 held)' : 'point (hold L2 to shoot)')}` : s.turn === 'npc' ? `${s.npcName} is throwing…` : ''}</span><i class="meter"><u style="width:${Math.round(s.charge * 100)}%"></u></i><small>${s.message}</small><small>Hold R2 / left mouse for power, release to throw · ○ quit</small>`;
      marks.replaceChildren(...s.markers.map(m => {const v = m.pos.clone();v.y += .25;v.project(camera);const d = document.createElement('div');d.className = 'marker ' + m.owner + (m.best ? ' best' : '');d.textContent = m.label;d.style.left = `${(v.x * .5 + .5) * 100}%`;d.style.top = `${(-v.y * .5 + .5) * 100}%`;d.hidden = v.z > 1;return d;}));
    }
  };
  function notice(text, seconds = 3) {const el = $('notice');el.textContent = text;el.hidden = !text;clearTimeout(notice.t);if (text) notice.t = setTimeout(() => {el.hidden = true;}, seconds * 1000);}
  const prompt = text => {const el = $('prompt');if (el.textContent !== (text || '')) el.textContent = text || '';el.hidden = !text;};

  // ---------- Player ----------
  const player = {x: 0, z: 0, feet: D.ground, yaw: 0, pitch: 0, stance: 'stand', eye: 1.65, eyeNow: 1.65, jumpY: 0, jumpV: 0, run: false, stride: 0, mode: 'foot', vehicle: null, minigame: null};
  const stanceEye = s => s === 'prone' ? .32 : s === 'crouch' ? 1.05 : player.eye;
  const WALK_SPEED = 3.5;
  const stanceSpeed = () => player.stance === 'prone' ? .28 : player.stance === 'crouch' ? .55 : 1;
  function place(x, z, yaw, y) {
    const sp = collision.findSafeSpawn(walkWorld, {x, z}, stanceEye('stand'), {y: y ?? heightAt(x, z), maxDistance: 6});
    player.x = sp ? sp.x : x;player.z = sp ? sp.z : z;player.feet = sp ? sp.y : (y ?? heightAt(x, z));if (yaw !== undefined) player.yaw = yaw;player.pitch = 0;player.stance = 'stand';player.eyeNow = player.eye;player.jumpY = player.jumpV = 0;player.floating = false;
  }
  // The hostage mission starts from its own marker on the grass beside the entrance, so the street door is a normal door.
  const MISSION_MARK = {x: 4.8, z: 14.2};
  {
    const y = world.heightWorld(MISSION_MARK.x, MISSION_MARK.z), g = new T.Group();g.position.set(MISSION_MARK.x, y, MISSION_MARK.z);scene.add(g);
    const ring = new T.Mesh(new T.TorusGeometry(1.1, .05, 8, 48), new T.MeshStandardMaterial({color: 0xb71c1c, emissive: 0xb71c1c, emissiveIntensity: .8}));ring.rotation.x = -Math.PI / 2;ring.position.y = .04;g.add(ring);
    const post = new T.Mesh(new T.CylinderGeometry(.04, .04, 1.4, 10), lib.metal(0x5c6166, .4));post.position.set(0, .7, -1.25);post.castShadow = true;g.add(post);
    const c = document.createElement('canvas');c.width = 512;c.height = 256;const x = c.getContext('2d');x.fillStyle = '#7f1010';x.fillRect(0, 0, 512, 256);x.strokeStyle = '#fff';x.lineWidth = 10;x.strokeRect(10, 10, 492, 236);
    x.fillStyle = '#fff';x.textAlign = 'center';x.font = 'bold 64px Segoe UI, Arial, sans-serif';x.fillText('HOSTAGE', 256, 100);x.fillText('RESCUE', 256, 168);x.font = '600 34px Segoe UI, Arial, sans-serif';x.fillText('stand in the ring · □ start', 256, 222);
    const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;const sign = new T.Mesh(new T.PlaneGeometry(.9, .45), new T.MeshStandardMaterial({map: tex, side: T.DoubleSide, roughness: .6}));sign.position.set(0, 1.5, -1.25);sign.castShadow = true;g.add(sign);
    MISSION_MARK.ring = ring;
  }
  const missionStart = () => {const p = toWorld(...D.vehicles.missionStart);return {x: p.x, z: p.z, y: heightAt(p.x, p.z), yaw: Math.atan2(-(ownStair.doorOutside.x - p.x), -(ownStair.doorOutside.z - p.z))};};
  {const s = missionStart(), f = {x: Math.sin(s.yaw), z: Math.cos(s.yaw)};place(s.x + f.x * 4, s.z + f.z * 4, s.yaw);}
  function setStance(next) {
    if (next === player.stance) return;
    if (stanceEye(next) > stanceEye(player.stance) && !collision.canStand(walkWorld, player, stanceEye(next), player.feet)) {notice('No room to stand up here.');return;}
    player.stance = next;
  }
  const move = (dx, dz) => {const n = collision.move(walkWorld, player, {x: dx, z: dz}, stanceEye(player.stance), player.feet);player.x = n.x;player.z = n.z;player.feet = n.y;};
  function inApartment() {return player.feet > -.5 && player.feet < 2.5 && apt.floors.some(f => inside(player, f.points));}
  // Ambience: the whole flat (also doorways and wall gaps) counts as indoors; the balcony is open air.
  const aptBox = (() => {const pts = apt.floors.filter(f => !/balcony/i.test(f.id || f.name || '')).flatMap(f => f.points);return {x0: Math.min(...pts.map(p => p.x)) - .15, x1: Math.max(...pts.map(p => p.x)) + .15, z0: Math.min(...pts.map(p => p.z)) - .15, z1: Math.max(...pts.map(p => p.z)) + .15};})();
  function inFlat() {return player.feet > -.5 && player.feet < 2.5 && player.x > aptBox.x0 && player.x < aptBox.x1 && player.z > aptBox.z0 && player.z < aptBox.z1;}
  function towerAt(x, z, feet) {for (const t of towers) {const l = new T.Vector3(x, 0, z).applyMatrix4(t.inverse);if (l.x > -1.45 && l.x < 1.665 && l.z > 4.9 && l.z < 11.12 && feet > t.matrix.elements[13] - 10.5 && feet < t.matrix.elements[13] + 2.7) return {t, l};}return null;}
  function inside(p, pts) {let r = false;for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {const a = pts[i], b = pts[j];if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) r = !r;}return r;}
  function roomAt() {const r = apt.rooms.find(r => inside(player, r.polygon.map(apt.xy).map(([x, z]) => ({x, z}))));return r?.id;}

  // ---------- Doors (animated) and dynamic obstacles ----------
  const doorPolygon = d => apt.meshObstacle(d.leaf);
  function setDoor(d, t) {if (d.motion === 'slide') d.hinge.position.x = d.closedX + d.travel * t;else d.hinge.rotation.y = d.openAngle * t;d.hinge.updateMatrixWorld(true);}
  function polygonsOverlap(a, b) {for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {const p = poly[i], q = poly[(i + 1) % poly.length], nx = -(q.z - p.z), nz = q.x - p.x, aa = a.map(v => v.x * nx + v.z * nz), bb = b.map(v => v.x * nx + v.z * nz);if (Math.max(...aa) <= Math.min(...bb) + 1e-8 || Math.max(...bb) <= Math.min(...aa) + 1e-8) return false;}return true;}
  function toggleDoor(d) {
    if (d.anim) return;
    const target = d.open ? 0 : 1;setDoor(d, target);const poly = doorPolygon(d);setDoor(d, d.open ? 1 : 0);
    const me = [{x: player.x - .2, z: player.z - .2}, {x: player.x + .2, z: player.z - .2}, {x: player.x + .2, z: player.z + .2}, {x: player.x - .2, z: player.z + .2}];
    if (poly.maxY > player.feet && poly.minY < player.feet + 1.8 && polygonsOverlap(poly.points, me)) {notice('Step back from the door, then try again.');return;}
    if (caseGame?.active && caseGame.actorObstacles().some(o => polygonsOverlap(poly.points, o.points))) {notice('Someone is standing in the door’s path.');return;}
    d.anim = {from: d.open ? 1 : 0, to: target, t: 0};audio.sfx(target ? 'doorOpen' : 'doorClose', {reverb: towerAt(player.x, player.z, player.feet) ? .6 : .1});if (mp) mp.sendDoor(d.id, target === 1);
  }
  function closeAllDoors() {doors.forEach(d => {d.anim = null;d.open = false;setDoor(d, 0);});updateDynamic();}
  function updateDynamic() {
    const list = doors.filter(d => !d.anim).map(doorPolygon);
    vehicles.forEach(v => {if (v !== player.vehicle) list.push(...[].concat(v.footprint()));});
    if (caseGame?.active) list.push(...caseGame.actorObstacles());
    collision.setDynamic(walkWorld, list);
    // Other vehicles block the one being driven; it must never collide with its own (parked) footprint.
    const vlist = vehicles.filter(v => v !== player.vehicle && !v.pushed).flatMap(v => [].concat(v.footprint()));
    vehicleBlockers = vlist;vehicleWorlds.forEach(w => collision.setDynamic(w, vlist));
  }
  updateDynamic();

  // ---------- Mission (hostage rescue) ----------
  const sensitivity = {pad: 1, mouse: 1};
  const loadSens = () => {Object.assign(sensitivity, {pad: 1, mouse: 1});try {const saved = JSON.parse(localStorage.getItem('haarklous-look-sensitivity-v1') || 'null');if (saved) Object.assign(sensitivity, saved);} catch {}};
  loadSens();
  const setSens = (k, v) => {sensitivity[k] = Math.round(Math.min(3, Math.max(.25, v)) * 100) / 100;try {localStorage.setItem('haarklous-look-sensitivity-v1', JSON.stringify(sensitivity));} catch {}};
  if (window.CaseGame) {
    const stairSpawns = () => ownStair.floors().filter(f => !f.slope && f.name !== 'Street door threshold' && !/Half landing 0/.test(f.name)).map(f => ({name: f.name, points: f.points, y: f.y}));
    caseGame = window.CaseGame.mount({T, scene, renderer, viewport: view, collision, meshObstacle: apt.meshObstacle, closeAllDoors, rebuildWalkWorld: updateDynamic,
      camera: () => camera, walkWorld: () => walkWorld, doors: () => apt.doors, isFirstPerson: () => true, render: () => {}, shootables: () => shootTargets,
      lib, stance: () => player.stance, useDoorAhead: () => interact(true),
      sensitivity: {min: .25, max: 3, get: () => ({...sensitivity}), set: setSens, step: (k, d) => setSens(k, sensitivity[k] + d * .1)},
      spawnAreas: () => apt.spawnAreas, stairSpawns, missionStart,
      entrance: () => {const d = apt.doors.find(d => d.name === 'Entrance door');return d ? d.leaf.getWorldPosition(new T.Vector3()) : {x: 1.66, z: 5.83};},
      timeScale: () => worldScale(),
      onFinish: (result, info) => {if (result === 'success') earn(400, 'Reward for rescuing the hostage');badges.record('mission', {success: result === 'success', time: info && info.time});},
      setPose: (x, z, yaw, tilt, y) => place(x, z, yaw, y), enterWalk: () => {}, enterImmersive: () => {},
      leave: () => {const yaw = player.yaw;place(player.x, player.z, yaw, player.feet);updateDynamic();notice(inApartment() ? 'Mission over – you are home. Make yourself comfortable.' : 'Mission over.', 4);}});
  }

  // ---------- Minigames, photo camera, map ----------
  const mini = window.GameMinigames.create({T, lib, audio, heightAt, toWorld, toLocal: world.toLocal, data: D, hud, trees: world.trees, reward: (v, why) => earn(v, why), muselunden: window.MUSELUNDEN,
    onEvent: (kind, data) => badges.record(kind, data)});
  const discCourses = [mini.discgolf, mini.muselunden].filter(Boolean);
  scene.add(...discCourses.map(g => g.group), mini.petanque.group);
  const photo = window.GameCamera.create({T, lib, audio, root: view, notice});
  const overlayScene = new T.Scene(), overlayCamera = new T.PerspectiveCamera(55, 1, .01, 5);overlayScene.add(new T.HemisphereLight(0xf1f5ff, 0x4a4540, 2.2));
  const ovSun = new T.DirectionalLight(0xffffff, 1.8);ovSun.position.set(.6, 1, .5);overlayScene.add(ovSun);overlayScene.environment = lib.environment();
  overlayScene.add(photo.model);photo.model.position.set(.08, -.13, -.32);photo.model.rotation.set(.1, -.15, 0);
  const homeLocal = world.toLocal(2.8, 5), caseLocal = D.vehicles.missionStart;let mp = null;
  // The Ensjø -> Rathkes gate run (issue #38): any way you like; best time kept in this browser.
  const routeData = DISTRICTS.map(d => d.route).find(Boolean);
  const route = routeData && window.GameRoute ? window.GameRoute.create({T, lib, route: routeData, toWorld, heightAt, root: view, sound: n => audio.sfx(n),
    teleport: at => {const yaw = Math.atan2(-(at.x - player.x), -(at.z - player.z));place(at.x, at.z, yaw);notice('Back at Ensjø T-bane. Stand in the green ring and press □ to start.', 4);},
    onFinish: (t, best, isBest) => {const f = window.GameRoute.format;earn(isBest ? 60 : 30, isBest ? `Rathkes gate in ${f(t)} – a new best time!` : `Rathkes gate in ${f(t)} (best ${f(best)})`);}}) : null;
  if (route) scene.add(route.group);
  // The map shows the district patches as part of the neighbourhood: the same lists in the same formats (the parked cars and
  // the minigames keep reading the unchanged D).
  const mapKind = {cemetery: 'grass', rail: 'yard', sand: 'playground', rock: 'yard', paved: 'parking'};
  const mapData = !DISTRICTS.length ? D : {...D,
    areas: [...D.areas, ...DISTRICTS.flatMap(d => [...d.areas.map(a => ({k: mapKind[a.k] || a.k, o: a.o})), ...d.sea.map(o => ({k: 'water', o}))])],
    roads: [...D.roads, ...DISTRICTS.flatMap(d => d.roads.map(r => ({...r, k: r.k === 'rail' ? 'tram' : r.k})))],
    buildings: [...D.buildings, ...DISTRICTS.flatMap(d => [...d.buildings.map(b => ({r: {o: b.ring.flat()}, s: b.style})), ...d.landmarks.map(l => ({r: {o: l.ring}, s: 'brick'}))])]};
  let rentals = null, jobs = null;// the e-scooter / city bike trips and the jobs (made below, once the wallet exists)
  const map = window.GameMap.create({data: mapData, toLocal: world.toLocal, toWorld, root: view, poi: () => [
    {x: homeLocal.x, s: homeLocal.s, color: '#e0703c', label: 'Home · 4th floor', glyph: '⌂'},
    {...world.toLocal(4.8, 14.2), color: '#b71c1c', label: 'Hostage rescue', glyph: '◎'},
    ...(D.discgolf || []).map((h, i) => ({x: h.tee[0], s: h.tee[1], color: '#6a1b9a', label: `Disc golf ${i + 1}`, glyph: '◉', course: 'Torshovdalen'})),
    ...(D.discgolf || []).map(h => ({x: h.basket[0], s: h.basket[1], color: '#9c4dcc', label: '', glyph: '⛳', course: 'Torshovdalen'})),
    ...(window.MUSELUNDEN ? window.MUSELUNDEN.holes.map(h => ({x: h.tee[0], s: h.tee[1], color: '#6a1b9a', label: h.n === 1 ? 'Muselunden disc golf 1' : `${h.n}`, glyph: '◉', course: window.MUSELUNDEN.name})) : []),
    ...(window.MUSELUNDEN ? window.MUSELUNDEN.holes.map(h => ({x: h.basket[0], s: h.basket[1], color: '#9c4dcc', label: '', glyph: '⛳', course: window.MUSELUNDEN.name})) : []),
    ...(D.petanque ? [{x: D.petanque.x, s: D.petanque.s, color: '#00838f', label: 'Petanque', glyph: '●'}] : []),
    {...world.toLocal(AIR.heli.x, AIR.heli.z), color: '#1565c0', label: 'Helipad', glyph: 'H'},
    {...world.toLocal(AIR.plane.x, AIR.plane.z), color: '#1565c0', label: 'Airstrip', glyph: '✈'},
    {...world.toLocal(SKY_TARGET.x, SKY_TARGET.z), color: '#ff6d00', label: 'Skydiving target', glyph: '◎'},
    {...world.toLocal(FIRE_POS.x, FIRE_POS.z), color: '#e65100', label: 'Firepit', glyph: '🔥'},
    ...shops.shops.map(s => {const L = s.local;return {x: L.P0[0] + L.u[0] * L.W / 2 + L.n[0] * L.depth / 2, s: L.P0[1] + L.u[1] * L.W / 2 + L.n[1] * L.depth / 2, color: /^kiwi/.test(s.id) ? '#2e9a3f' : '#d0021b', label: s.name, glyph: '🛒'};}),
    ...(storgata ? storgata.poi() : []),
    ...(SITE_DATA ? [{x: SITE_DATA.rect.x0 + SITE_DATA.rect.w / 2, s: SITE_DATA.rect.s0 + SITE_DATA.rect.d / 2, color: '#f9a825', label: 'Construction site', glyph: '⛏'}] : []),
    ...(PB_DATA ? [{x: PB_DATA.centre.x, s: PB_DATA.centre.s, color: '#2e7d32', label: 'Paintball', glyph: '✚'}] : []),
    {x: SCULPTURE_AT.x, s: SCULPTURE_AT.s, color: '#7a5c3e', label: 'HODET N.N.', glyph: '◉'},
    {x: OKSEN_AT.x, s: OKSEN_AT.s, color: '#3a4436', label: 'Torshovoksen', glyph: '◉'},
    {x: gym.local.x, s: gym.local.s, color: '#c4161c', label: 'Klatreverket Torshov', glyph: '🧗'},
    {...world.toLocal(AIR.jump.x, AIR.jump.z), color: '#c8322c', label: 'Skydiving (jump plane)', glyph: '🪂'},
    ...landmarks.poi, ...(route ? route.poi() : []),
    ...grl.flatMap(m => m.poi ? m.poi() : []),
    ...DISTRICTS.flatMap(d => d.stations).map(st => ({x: st.x, s: st.s, color: '#e65100', label: `${st.name} T`, glyph: 'T'})),
    ...(catacomb ? catacomb.poi() : []),
    ...(rentals ? rentals.poi() : []),
  ]});
  // Wristwatch (D-pad ↑) shares the first-person overlay with the photo camera.
  const watch = window.GameWatch.create({T, lib});overlayScene.add(watch.model);
  // Paintball course, lobby and games (the rules' view of the game; online the others' states come from the lobby).
  Object.assign(pbCtx, {
    serverNow: () => mp && mp.net.online ? mp.net.serverNow() : Date.now(), you: () => mp && mp.net.online ? mp.net.you : 0, yourName: () => mp ? mp.net.name : 'You', yourSlot: () => mp ? mp.net.slot : 0,
    others: () => mp ? [...mp.remotes.values()].filter(r => r.st && r.st.pb && r.seen).map(r => window.GamePaintball.memberFromJson(r.st.pb, {id: r.id, name: r.name, slot: r.slot, local: false, feet: {x: r.pos.x, y: r.pos.y, z: r.pos.z}, yaw: r.yaw, stance: r.st.st || 'stand'})).filter(Boolean) : [],
    feet: () => ({x: player.x, y: player.feet, z: player.z}), yaw: () => player.yaw, stance: () => player.stance,
    teleport: (x, z, yaw) => {if (player.mode === 'foot') place(x, z, yaw);}, cameraPos: () => camera.position.clone(), cameraFwd: () => camera.getWorldDirection(new T.Vector3()),
    ground: groundAt, notice: (t, sec) => notice(t, sec), sound: (n, g) => audio.sfx(n, {gain: g}), random: Math.random});
  const paintball = pbRules && window.PaintballModels ? window.GamePaintball.create({T, scene, overlay: overlayScene, models: window.PaintballModels.create({T, lib, data: PB_DATA}), data: PB_DATA, view, groundAt, ctx: pbCtx, rules: pbRules}) : null;
  const pbBusy = () => !!paintball && paintball.busy, pbArmed = () => !!paintball && paintball.armed;

  // ---------- Drinking ----------
  let drunk = 0;// seconds of drunkenness remaining
  const drunkLevel = () => Math.min(1, drunk / 90);
  function drink(d) {
    if (d.kind === 'beer') {d.object.visible = false;d.used = true;audio.sfx('bottleOpen');audio.sfx('gulp');drunk += 30;wallet.addPant(1);notice('You drink a beer. (+30 s drunk, +1 bottle for the deposit)');}
    else {if (d.sips <= 0) {notice('The bottle is empty.');return;}d.sips--;audio.sfx('gulp');drunk += 30;notice(`A sip of ${d.name}. (+30 s drunk) · ${d.sips} sips left`);const l = d.object.userData.liquid;if (l) l.scale.y = Math.max(.05, d.sips / 12);}
  }

  // ---------- Interaction (□ / E) ----------
  const ray = new T.Raycaster();
  let promptAction = null;
  function lookTarget(range = 2.6) {
    ray.setFromCamera(new T.Vector2(0, 0), camera);ray.far = range;
    const hit = ray.intersectObjects(interactables.filter(o => {for (let p = o; p; p = p.parent) if (!p.visible) return false;return true;}), false)[0];
    return hit ? hit.object : null;
  }
  function nearestVehicle() {
    let best = null, bd = 2.6;
    for (const v of vehicles) {const f = v.forward(), dx = player.x - v.x, dz = player.z - v.z, along = dx * f.x + dz * f.z, side = dx * -f.z + dz * f.x, d = Math.hypot(Math.max(0, Math.abs(along) - v.length / 2), Math.max(0, Math.abs(side) - v.width / 2));if (d < bd && Math.abs(player.feet - v.y) < 2) {bd = d;best = v;}}
    return best;
  }
  function findPrompt() {
    if (player.mode === 'jumpseat') return jumpseatPrompt();
    if (player.mode === 'skydive' || player.mode === 'kayak') return null;
    if (player.mode === 'vehicle') {const v = player.vehicle;return (v.aircraft ? v.grounded && v.speed < 3 : Math.abs(v.speed) < 3) ? {text: v.rental ? rentals.exitText(v) : `□ ${v.kind === 'motorcycle' ? 'Get off' : 'Get out'}`, act: () => exitVehicle()} : null;}
    if (player.mode === 'passenger') {const v = player.vehicle;return (v.aircraft ? v.grounded && v.speed < 3 : Math.abs(v.speed) < 3) ? {text: `□ ${v.kind === 'motorcycle' ? 'Get off' : 'Get out'}`, act: () => exitPassenger()} : null;}
    if (player.mode === 'sit') return {text: '□ Stand up · R2 have a beer', act: () => standUp()};
    if (player.mode === 'climb' || player.mode === 'hang' || player.mode === 'belay') return null;
    // During the mission only doors can be used (□ otherwise reloads).
    if (caseGame?.active) {const o = lookTarget();if (o?.userData.doorId) {const d = doors.find(d => d.id === o.userData.doorId);if (d) return {text: `□ ${d.open ? 'Close' : 'Open'} ${d.name.toLowerCase()}`, act: () => toggleDoor(d)};}if (o?.userData.lockedDoor) return {text: '□ Try the door', act: () => {audio.sfx('locked');notice('Locked.');}};return null;}
    // Doors first (the street door of 17A opens normally), then the mission marker beside the entrance.
    {const o = lookTarget();if (o?.userData.doorId) {const d = doors.find(d => d.id === o.userData.doorId);if (d) return {text: `□ ${d.open ? 'Close' : 'Open'} ${d.name.toLowerCase()}`, act: () => toggleDoor(d)};}}
    if (Math.hypot(player.x - MISSION_MARK.x, player.z - MISSION_MARK.z) < 1.6 && Math.abs(player.feet - world.heightWorld(MISSION_MARK.x, MISSION_MARK.z)) < 2) return {text: '□ Start mission: rescue the hostage (4th floor)', act: () => startMission()};
    // Jobs (issue #56): the order's pickup and the street door, and the job signs.
    {const jp = player.mode === 'foot' ? jobs.prompt(player, lookTarget()) : null;if (jp) return jp;}
    const cp = gymPrompt();if (cp) return cp;
    {const rp = route && route.prompt(player);if (rp) return rp;}
    {const cp = catacomb && player.mode === 'foot' ? catacomb.prompt() : null;if (cp) return cp;}
    {const sg = storgataPrompt();if (sg) return sg;}
    const shp = shopPrompt();if (shp) return shp;
    const grp = grunerPrompt();if (grp) return grp;
    const fp = firePrompt();if (fp) return fp;
    const sp = stashPrompt();if (sp) return sp;
    const jp = boardPrompt();if (jp) return jp;
    const v = nearestVehicle();
    if (v) {
      const i = vehicles.indexOf(v), drv = mp.occupant(i, 'd'), pas = mp.occupant(i, 'p'), canRide = !!v.hipAnchor('p');
      // The game's pilot flown from this computer: take the controls back while it stands still.
      if (gp && v === caravan) return v.grounded && v.speed < 3 ? {text: "□ Fly the Caravan yourself (the game's pilot gets out)", act: () => {gp = null;caravan.vel.set(0, 0, 0);enterVehicle(caravan);}} : {text: "The game's pilot is flying the Caravan", act: () => {}};
      // E-scooters and city bikes: unlocking costs money (issue #57).
      if (v.rental && !drv) return rentals.prompt(v, i);
      if (!drv) return {text: `□ ${v.verb ? v.verb : v.kind === 'motorcycle' ? 'Ride the' : v.kind === 'excavator' ? 'Climb into the' : v.aircraft ? 'Fly the' : 'Drive the'} ${v.name}`, act: () => tryDrive(v)};
      if (canRide && !pas) return {text: `□ Ride along with ${driverName(i)} (${v.kind === 'motorcycle' ? 'pillion' : 'passenger'})`, act: () => tryRide(v)};
      return {text: `${driverName(i)} is ${v.aircraft ? 'flying' : 'driving'} the ${v.name}`, act: () => {}};
    }
    for (const g of [...discCourses, mini.petanque, ...(pingpong ? [pingpong] : [])]) {const t = g.near({x: player.x, z: player.z, y: player.feet});if (t) return {text: t, act: () => startMinigame(g)};}
    const o = lookTarget();
    if (o?.userData.drink && !o.userData.drink.used) {const d = o.userData.drink;return {text: d.kind === 'beer' ? '□ Drink a beer' : `□ Take a sip of ${d.name}`, act: () => drink(d)};}
    if (o?.userData.doorId) {const d = doors.find(d => d.id === o.userData.doorId);if (d) return {text: `□ ${d.open ? 'Close' : 'Open'} ${d.name.toLowerCase()}`, act: () => toggleDoor(d)};}
    if (o?.userData.lockedDoor) return {text: '□ Try the door', act: () => {audio.sfx('locked');notice('Locked. Someone lives here.');}};
    return null;
  }
  function interact(silent = false) {const p = findPrompt();if (p) {p.act();return true;}if (!silent) notice('Nothing to use here.', 1.5);return false;}

  // ---------- Vehicles: enter / exit ----------
  const AIR_HELP = {
    helicopter: 'Helicopter (Mode 2) · left stick ↑↓ collective (centre = hover), ←→ pedals · right stick pitch/roll · R3 / V chase camera · Keyboard + mouse: W/S collective, A/D pedals, mouse pitch/roll (up = nose down), hold Shift to look around · the rotor needs a few seconds to spool up',
    plane: 'Plane (Mode 2) · left stick ↑ to add throttle (it stays), ←→ rudder/nose wheel · right stick pitch/roll · pull back at about 85 km/h · L2 brakes · R3 / V view · Keyboard + mouse: W/S throttle, A/D rudder, mouse pitch/roll (up = nose down), hold Shift to look around',
    jumpplane: 'Caravan jump plane (Mode 2, flies like the plane) · left stick ↑ throttle (it stays), ←→ rudder/nose wheel · right stick pitch/roll · the flaps are automatic: pull back at about 110 km/h · L2 brakes · R3 / V view · others board at the door (□) and can jump above 300 m · △ / F: the game\'s pilot takes over (you go to the back) · ✕ / Space above 300 m: jump yourself (the game\'s pilot takes over) · Keyboard + mouse: W/S throttle, A/D rudder, mouse pitch/roll, hold Shift to look around'};
  function setClip(near, far) {if (camera.near !== near || camera.far !== far) {camera.near = near;camera.far = far;camera.updateProjectionMatrix();applyNearFog();}}
  function enterVehicle(v) {if (v === caravan) gp = null;watch.hide();player.mode = 'vehicle';player.vehicle = v;player.siteView = 0;player.lookYaw = 0;player.lookPitch = 0;player.chase = false;player.chaseCam = null;v.enter();updateDynamic();if (v.aircraft) setClip(.12, 1600);notice(v.help ? v.help : v.aircraft ? AIR_HELP[v.kind] : v.kind === 'excavator' ? 'Tracks: L1/L2 left, R1/R2 right · Left stick: swing / stick · Right stick: boom / bucket · □ get out' : 'R2 throttle · L2 brake / reverse · Left stick steer · Right stick look · □ get off', v.aircraft || v.help ? 9 : 6);}
  function tryDrive(v) {
    const i = vehicles.indexOf(v);if (v !== caravan) leaveGamePilot();
    mp.claim(i, 'd').then(r => {if (player.mode !== 'foot') {if (r.ok) mp.release(i, 'd');return;}if (r.ok) enterVehicle(v);else notice(r.timeout ? 'No answer from the lobby – try again.' : `${mp.nameOf(r.by)} just took it.`, 3);});
  }
  // A rental: the seat first (online the lobby decides), then the fee; no money, no ride.
  function rentDrive(v) {
    const i = vehicles.indexOf(v);leaveGamePilot();
    mp.claim(i, 'd').then(r => {
      if (player.mode !== 'foot') {if (r.ok) mp.release(i, 'd');return;}
      if (!r.ok) {notice(r.timeout ? 'No answer from the lobby – try again.' : `${mp.nameOf(r.by)} just took it.`, 3);return;}
      const msg = rentals.start(v);if (!msg) {mp.release(i, 'd');return;}
      enterVehicle(v);rentals.rollOut(v);notice(msg, 8);
    });
  }
  function tryRide(v) {
    const i = vehicles.indexOf(v);if (v !== caravan) leaveGamePilot();
    mp.claim(i, 'p').then(r => {if (player.mode !== 'foot') {if (r.ok) mp.release(i, 'p');return;}if (r.ok) enterPassenger(v);else notice(r.timeout ? 'No answer from the lobby – try again.' : 'That seat is taken.', 3);});
  }
  let passengerEngine = null;
  function enterPassenger(v) {
    watch.hide();if (photo.active) photo.toggle();player.mode = 'passenger';player.vehicle = v;player.lookYaw = 0;player.lookPitch = 0;if (v.aircraft) setClip(.12, 1600);
    passengerEngine = audio.engine({motorcycle: 'bike', car: 'car', helicopter: 'heli', plane: 'plane'}[v.kind] || 'car');
    notice(`Riding along with ${driverName(vehicles.indexOf(v))} · look around with the right stick · □ get out when stopped`, 5);
  }
  function exitPassenger() {
    const v = player.vehicle, i = vehicles.indexOf(v);mp.release(i, 'p');if (passengerEngine) passengerEngine.stop();passengerEngine = null;
    player.mode = 'foot';player.vehicle = null;setClip(.05, 450);$('speedo').classList.remove('air');updateDynamic();
    const f = v.forward(), r = {x: -f.z, z: f.x}, d = (v.width || 1.8) / 2 + .7, p = v.aircraft ? {x: v.x + r.x * 1.8 - f.x * 1.8, z: v.z + r.z * 1.8 - f.z * 1.8} : {x: v.x + r.x * d, z: v.z + r.z * d};
    const sp = collision.findSafeSpawn(walkWorld, p, player.eye, {y: heightAt(p.x, p.z), maxDistance: 6});if (sp) {player.x = sp.x;player.z = sp.z;player.feet = sp.y;}player.yaw = v.yaw;player.pitch = 0;
  }
  // Firepit: throw logs, take a beer, sit on the benches.
  let beerT = 0;
  // ---------- Stash boosts (30 s, random): 3× running speed, 3× jump height or bullet time ----------
  const BOOSTS = {speed: '⚡ 3× running speed', jump: '🦘 3× jump height', slowmo: '⏳ Bullet time – the world slows down'};
  let boost = null;
  const boostIs = k => !!boost && boost.kind === k;
  const worldScale = () => boostIs('slowmo') ? .35 : 1;
  function stashPrompt() {
    if (player.mode !== 'foot') return null;
    const o = lookTarget(), it = o?.userData.stashItem || stash.nearest(player, player.feet);if (!it) return null;
    if (!it.ready) return {text: 'Nothing left here – come back later', act: () => {}};
    return {text: it.kind === 'line' ? '□ Snort a line' : '□ Use the needle', act: () => takeBoost(it)};
  }
  function takeBoost(it) {
    stash.use(it);const kinds = Object.keys(BOOSTS), kind = kinds[Math.floor(Math.random() * kinds.length)];
    boost = {kind, t: 30};audio.sfx(it.kind === 'line' ? 'sniff' : 'needle');audio.muffle(kind === 'slowmo');
    notice(`${BOOSTS[kind]} for 30 seconds!`, 4);
  }
  // ---------- Shops (Joker and Kiwi) and money in kroner ----------
  const wallet = shops.wallet, KR = shops.kr, GREET = ['Hei! Velkommen inn.', 'Hei hei!', 'God dag!', 'Hei, si fra om du trenger hjelp.'];
  let basket = [], walletT = 0, lastShop = null, bag = null;
  function earn(amount, why) {if (!(amount > 0)) return;wallet.earn(amount);walletT = 6;audio.sfx('coin');notice(`+${KR(amount)} · ${why}`, 4);}
  // ---------- Badges, the photo hunt and best scores (issue #58) ----------
  const badges = window.GameBadges.create({root: view, pay: kr => {wallet.earn(kr);walletT = 6;audio.sfx('coin');}, sound: n => audio.sfx(n),
    labels: {kayak: kayak ? kayak.racks.map(r => r.name.replace(/ \(.*\)/, '')) : []}});
  const markBadge = id => {if (!(badges.records.marks || {})[id]) badges.record('mark', {id});};
  // ---------- E-scooters and city bikes (issue #57): trips and prices ----------
  // Others' locked city bikes (their state's cb) cannot be taken; a vehicle with a driver is in use.
  function lockedByOthers() {const m = new Map();if (mp) for (const r of mp.remotes.values()) if (r.st && r.st.cb >= 0) m.set(r.st.cb, r.name);return m;}
  rentals = rides ? rides.manager({wallet, kr: KR, notice, audio, vehicles, toLocal: world.toLocal, drive: v => rentDrive(v), onPaid: () => {walletT = 6;}, lockedByOthers,
    inUse: v => {const i = vehicles.indexOf(v);return !!mp.occupant(i, 'd') || lockedByOthers().has(i);}}) : null;
  // ---------- Jobs: food delivery and taxi (issue #56), from the phone (D-pad → / P) or the job signs ----------
  jobs = window.GameJobs.create({T, lib, scene, data: window.JOBS || {doors: [], pickups: []}, toWorld, toLocal: world.toLocal, heightAt, avatars: window.GameAvatars.create({T, lib}), audio, notice, earn, map, root: view});
  scene.add(jobs.group);for (const j of JOB_SIGNS) {jobs.addSign(j.x, j.z, j.yaw);jobs.addPickup(j.pickup);}interactables.push(...jobs.hitboxes);
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const wpTo = w => {const l = world.toLocal(w.x, w.z);map.waypoint = {x: l.x, s: l.s};notice('Waypoint set – the purple pin and the minimap show the way.', 3);};
  function phoneItems() {
    const s = jobs.shift, dist = window.GameMap.distanceText, items = [], car = player.mode === 'vehicle' && player.vehicle && player.vehicle.kind === 'car' ? player.vehicle : null;
    if (s && s.kind === 'delivery') items.push({text: '🛵 Stop delivering', sub: `${s.n} delivered · ${Math.round(s.total)} kr this shift`, act: () => jobs.stop('phone')});
    else items.push({text: '🛵 Deliver food', sub: 'Pick up orders at cafés, restaurants, Joker and Kiwi and take them to street doors before the time runs out – walk, run, ride or drive', act: () => jobs.startDelivery(player)});
    if (s && s.kind === 'taxi') items.push({text: '🚕 Turn the taxi off', sub: `${s.n} fare${s.n === 1 ? '' : 's'} · ${Math.round(s.total)} kr this shift`, act: () => jobs.stop('phone')});
    else items.push({text: '🚕 Turn on taxi', sub: car ? 'Pick up passengers and drive them where they want to go – smooth, fast driving earns tips' : 'Sit in a car as the driver first', off: !car, act: () => jobs.startTaxi(car, vehicles.indexOf(car))});
    if (rentals) {
      const t = rentals.trip;if (t && t.locked) items.push({text: `🔒 Your locked city bike · ${window.GameRentals.clock(t.t)}`, sub: `Set the waypoint to it – return it to a dock within ${window.GameRentals.NOT_RETURNED.afterS / 60} min of locking it`, act: () => wpTo(t.v)});
      const sc = rentals.nearestScooter(player);if (sc) items.push({text: `🛴 Nearest e-scooter · ${dist(sc.dist)}`, sub: `Set the waypoint · ${rentals.priceText('scooter')}`, act: () => wpTo(sc.v)});
      const dk = rentals.nearestDock(player);if (dk) items.push({text: `🚲 ${dk.dock.name} · ${dist(dk.dist)}`, sub: `${dk.dock.count.bike} bike${dk.dock.count.bike === 1 ? '' : 's'}, ${dk.dock.count.ebike} e-bike${dk.dock.count.ebike === 1 ? '' : 's'} free · set the waypoint · ${rentals.priceText('bike')} (e-bike ${window.GameRentals.PLANS.ebike.per_min_pricing[0].rate} kr/min)`, act: () => wpTo(dk.dock.centre)});
    }
    items.push({text: 'Close', act: () => {}});
    return items;
  }
  function openPhone() {watch.hide();jobs.phone.show(phoneItems, () => `📱 Jobs & rides · ${KR(wallet.money)}`);}
  jobs.openPhone = openPhone;
  // A friend's job (issue #56): riding along with a player who is delivering or driving a taxi, you see their job, follow
  // their waypoint and get half of each payment they get while you are aboard.
  let crew = null, jobHudKey = '';
  function crewTick() {
    const i = player.mode === 'passenger' && player.vehicle ? vehicles.indexOf(player.vehicle) : -1, d = i >= 0 ? mp.occupant(i, 'd') : null, r = d ? mp.remotes.get(d) : null, jb = r && r.st && r.st.jb;
    if (!jb) {crew = null;return null;}
    if (!crew || crew.id !== r.id || crew.k !== jb.k) crew = {id: r.id, k: jb.k, n: jb.n};
    else if (jb.n > crew.n) {crew.n = jb.n;if (jb.kr > 0) earn(Math.round(Math.min(jb.kr, 1000) / 2), `Your share of ${r.name}'s ${jb.k === 'taxi' ? 'taxi fare' : 'delivery'}`);}
    if (Array.isArray(jb.to) && !jobs.shift) {const l = world.toLocal(+jb.to[0], +jb.to[1]), wp = map.waypoint;if (Number.isFinite(l.x) && Number.isFinite(l.s) && (!wp || Math.hypot(wp.x - l.x, wp.s - l.s) > 5)) map.waypoint = {x: l.x, s: l.s};}
    return {name: r.name, jb};
  }
  function renderJobHud(c) {
    const h = jobs.hud();let html = '';
    if (h) html = `<b>${esc(h.title)}</b><span class="${h.late ? 'late' : ''}">${esc(h.line)}</span>${h.mood !== null ? `<i class="meter mood"><u style="width:${h.mood}%"></u></i>` : ''}<small>Phone: D-pad → / P</small>`;
    else if (c) html = `<b>With ${esc(c.name)} · ${c.jb.k === 'taxi' ? '🚕 taxi' : '🛵 delivery'}</b><span>${esc(c.jb.t)}</span><small>You get half of each payment while you ride along</small>`;
    if (html !== jobHudKey) {jobHudKey = html;const el = $('jobHud');el.innerHTML = html;el.hidden = !html;}
  }
  function shopPrompt() {
    if (player.mode !== 'foot') return null;
    const s = shops.shopAt(player, player.feet), o = lookTarget(), u = (o && o.userData) || {};
    if (u.shopItem) {const {shop, product} = u.shopItem, price = shops.priceOf(shop, product);return {text: `□ Take ${product.name} – ${KR(price)}`, act: () => takeProduct(shop, product, price)};}
    if (u.shopPant) {const n = wallet.pant;return n ? {text: `□ Return ${n} empty bottle${n > 1 ? 's' : ''} – ${KR(n * shops.PANT)}`, act: () => returnPant()} : {text: 'Bottle return – no empty bottles yet', act: () => {}};}
    if (s && (u.shopTill || shops.atTill(s, player))) {
      const mine = basket.filter(b => b.shop === s), total = mine.reduce((t, b) => t + b.price, 0);
      return mine.length ? {text: `□ Pay ${KR(total)} (${mine.length} item${mine.length > 1 ? 's' : ''})`, act: () => payAt(s)} : {text: '□ Talk to the cashier', act: () => s.say(GREET[Math.floor(Math.random() * GREET.length)])};
    }
    return null;
  }
  function takeProduct(shop, product, price = shops.priceOf(shop, product)) {basket.push({shop, product, price});audio.sfx('click');walletT = 8;notice(`${product.name} in the basket – pay at the till`, 2);}
  function returnPant() {const n = wallet.cashPant();audio.sfx('pant');walletT = 6;notice(`The machine takes ${n} bottle${n > 1 ? 's' : ''}: +${KR(n * shops.PANT)}`, 3);}
  function payAt(s) {
    const mine = basket.filter(b => b.shop === s), beerOk = shops.beerAllowed(new Date());
    const refused = beerOk ? [] : mine.filter(b => b.product.beer), buy = mine.filter(b => !refused.includes(b)), total = Math.round(buy.reduce((t, b) => t + b.price, 0) * 100) / 100;
    if (!buy.length) {basket = basket.filter(b => b.shop !== s);s.say('Beklager, jeg kan ikke selge øl nå. Ølsalget er man–fre 08–20 og lør 08–18.');notice('No beer sales now (Norwegian law: Mon–Fri 08–20, Sat 08–18, never on Sunday). The beer goes back.', 5);return;}
    if (!wallet.pay(total)) {s.say(`Kortet ble avvist – du mangler ${KR(total - wallet.money)}.`);audio.sfx('locked');notice(`Card declined: you have ${KR(wallet.money)}, the total is ${KR(total)}.`, 4);return;}
    buy.forEach(b => wallet.add(b.product.id));basket = basket.filter(b => b.shop !== s);
    s.say(refused.length ? `Det blir ${KR(total)}. Ølet må jeg ta tilbake – ølsalget er stengt nå.` : `Det blir ${KR(total)}. Takk for handelen!`);
    audio.sfx('register');walletT = 8;notice(`Paid ${KR(total)}${refused.length ? ' (no beer at this hour)' : ''} · D-pad ↓ or the ↓ key opens your bag`, 4);
  }
  function shopsTick(dt) {
    shops.update(dt, player, camera);walletT = Math.max(0, walletT - dt);
    const s = player.mode === 'foot' ? shops.shopAt(player, player.feet) : null;
    if (s && s !== lastShop) s.say(GREET[Math.floor(Math.random() * 2)]);
    // Walking out with unpaid items sets off the alarm, and the items go back on the shelves.
    if (lastShop && s !== lastShop && basket.some(b => b.shop === lastShop)) {audio.sfx('alarm');basket = basket.filter(b => b.shop !== lastShop);notice('BEEP BEEP – the alarm at the door goes off. You put the unpaid items back.', 4);}
    lastShop = s;if (bag && player.mode !== 'foot') {bag = null;renderBag();}
    const show = s || basket.length || bag || walletT > 0, w = $('wallet');w.hidden = !show;if (show) w.textContent = `💰 ${KR(wallet.money)} · 🍾 ${wallet.pant}`;
    const bk = $('basket');bk.hidden = !basket.length;
    if (basket.length) {const total = basket.reduce((t, b) => t + b.price, 0);bk.innerHTML = '<b>Basket</b>' + basket.map(b => `<div>${b.product.name}<span>${KR(b.price)}</span></div>`).join('') + `<div class="total">Total<span>${KR(total)}</span></div><small>Pay at the till</small>`;}
  }
  // The bag: what you have bought (D-pad ↓ / ↓ key on foot).
  const USE = {beer: 'drink: +30 s drunk, a bottle for the deposit', soda: 'drink: a bottle for the deposit', energy: 'drink: 15 s of 3× speed', food: 'eat: sobers you up', coffee: 'drink: hot, sobers you up a little', wood: 'empty onto the firepit (+3)'};
  const bagItems = () => Object.entries(wallet.bag).map(([id, n]) => ({p: shops.products.find(x => x.id === id), n})).filter(e => e.p);
  function openBag() {bag = {sel: 0, stick: false};watch.hide();renderBag();}
  function renderBag() {
    const el = $('bag');el.hidden = !bag;if (!bag) return;const items = bagItems();bag.sel = Math.max(0, Math.min(bag.sel, items.length - 1));
    el.innerHTML = `<b>Bag · ${KR(wallet.money)} · ${wallet.pant} empty bottle${wallet.pant === 1 ? '' : 's'}</b>` + (items.length ? items.map((e, i) => `<div class="${i === bag.sel ? 'sel' : ''}">${e.n} × ${e.p.name}<small>${USE[e.p.use]}</small></div>`).join('') : '<div>Empty – buy something at Joker or Kiwi</div>') + '<small>↑↓ choose · ✕ / Space use · ○ / C close</small>';
    // A long bag scrolls so the chosen item stays in view.
    const sel = el.querySelector('.sel');if (sel) {const t = sel.offsetTop - 34, b = sel.offsetTop + sel.offsetHeight + 30;if (t < el.scrollTop) el.scrollTop = t;else if (b > el.scrollTop + el.clientHeight) el.scrollTop = b - el.clientHeight;}
  }
  function bagInput(input) {
    const y = input.move.y, items = bagItems();
    if (input.pressed.has('up') || (y < -.5 && !bag.stick)) bag.sel = Math.max(0, bag.sel - 1);
    if (input.pressed.has('down') || (y > .5 && !bag.stick)) bag.sel = Math.min(Math.max(0, items.length - 1), bag.sel + 1);
    bag.stick = Math.abs(y) > .5;
    if (input.pressed.has('cross') && items[bag.sel]) useItem(items[bag.sel].p);
    if (input.pressed.has('circle')) bag = null;
    renderBag();input.move.x = input.move.y = 0;['cross', 'circle', 'up', 'down', 'square', 'triangle'].forEach(b => input.pressed.delete(b));
  }
  function useItem(p) {
    if (p.use === 'wood') {
      if (Math.hypot(player.x - FIRE_POS.x, player.z - FIRE_POS.z) > 8) {notice('Take the firewood to the firepit in the park first.', 3);return;}
      for (let i = 0; i < 3; i++) setTimeout(() => {fire.throwLog({x: player.x, y: player.feet + 1.3, z: player.z});mp.addWood();}, i * 350);notice('You empty the sack of firewood onto the fire.', 3);markBadge('fire');
    } else if (p.use === 'beer') {audio.sfx('bottleOpen');audio.sfx('gulp');drunk += 30;beerT = 20;wallet.addPant(1);notice(`You drink a ${p.name}. (+30 s drunk, +1 bottle for the deposit)`, 3);}
    else if (p.use === 'soda') {audio.sfx('bottleOpen');audio.sfx('gulp');drunk = Math.max(0, drunk - 10);wallet.addPant(1);notice(`${p.name} – refreshing. (+1 bottle for the deposit)`, 3);}
    else if (p.use === 'energy') {audio.sfx('bottleOpen');audio.sfx('gulp');boost = {kind: 'speed', t: 15};wallet.addPant(1);notice(`${p.name}: 15 s of 3× speed! (+1 can for the deposit)`, 3);}
    else {drunk = Math.max(0, drunk - (p.sober || 10));audio.sfx('gulp');notice(`You ${p.use === 'coffee' ? 'drink' : 'eat'} ${p.name}.${p.sober ? ` (−${p.sober} s drunk)` : ''}`, 3);}
    wallet.take(p.id);walletT = 4;
  }
  // ---------- Klatreverket Torshov (issue #40): the reception, the routes, climbing ----------
  const GC = window.GameClimbing;let gymMenu = null, gripPrev = {L: false, R: false}, climbMsgT = 0;
  const ropeNeeded = r => r.kind === 'rope' || r.kind === 'lead' || r.kind === 'auto';
  function gymPrompt() {
    if (!gym.zoneAt(player, player.feet)) return null;
    const o = lookTarget(), u = (o && o.userData) || {};
    if (u.gymDesk) return {text: '□ Reception: day ticket, rental, autobelay introduction', act: () => openGymMenu()};
    if (u.gymPartner) {const v = gym.visit();return gym.state.brattkort && v.paid && v.harness && player.mode === 'foot' ? {text: '□ Belay Siri – she climbs a top-rope route in Galleriet (you have a brattkort)', act: () => startBelay(false)} : {text: '□ Talk to Siri (your climbing partner)', act: () => siriTalk()};}
    if (u.gymHang) return {text: '□ Hang on the hangboard (hold L2 + R2)', act: () => startHang()};
    if (u.gymMoon) {const n = gym.moonRoutes.length, next = gym.moonSel + 1 >= n ? -1 : gym.moonSel + 1;return {text: next < 0 ? '□ Moonwall: switch the LEDs off' : `□ Moonwall: light up ${gym.moonRoutes[next].name}`, act: () => {const r = gym.lightMoon(next);audio.sfx('beep');notice(r ? `${r.name}: start on the green hold, blue are the hands, finish on the red one.` : 'Moonwall LEDs off.', 4);}};}
    const dir = camera.getWorldDirection(new T.Vector3()), h = gym.aimAt(camera.position, dir, false);
    if (h && h.face === 'moon') {const r = gym.moonSel >= 0 ? gym.moonRoutes[gym.moonSel] : null;return r ? routePrompt(r) : {text: 'Moonwall – choose a problem at the control box (□) to light it up', act: () => {}};}
    const r = gym.routeAt(camera.position, dir, player);
    return r ? routePrompt(r) : null;
  }
  function routePrompt(r) {
    const v = gym.visit(), label = `${r.name} (${GC.STYLE[r.kind]})`, tell = t => ({text: `${label} – ${t}`, act: () => {notice(t[0].toUpperCase() + t.slice(1) + '.', 3);}});
    if (!v.paid) return tell(`pay entry at the reception first (${GC.priceAt(new Date())} kr)`);
    if (!v.shoes) return tell('rent climbing shoes at the reception first (50 kr)');
    if (ropeNeeded(r) && !v.harness) return tell('you need a harness – rent one at the reception (50 kr)');
    if (r.kind === 'auto' && !gym.state.autoIntro) return tell('get the free autobelay introduction at the reception first');
    const verb = r.kind === 'auto' ? 'Clip into the autobelay' : r.kind === 'lead' ? 'Lead' : r.kind === 'rope' ? 'Tie in and climb' : 'Climb', tick = gym.state.ticks[r.id];
    return {text: `□ ${verb}: ${label}${r.kind === 'rope' ? ', Siri belays' : r.kind === 'lead' ? ', Siri belays – clip every bolt' : ''}${tick ? ` · ✓ ${tick}` : ''}`, act: () => startClimb(r)};
  }
  function startClimb(r) {
    watch.hide();if (photo.active) photo.toggle();gymMenu = null;renderGymMenu();
    const c = gym.begin(r);player.mode = 'climb';player.yaw = Math.atan2(c.n.x, c.n.z);player.pitch = .3;gripPrev = {L: false, R: false};
    if ((r.kind === 'rope' || r.kind === 'lead') && gym.siri) gym.siri.say('Partnersjekk: knute, sele, karabin, brems – klar!');
    const off = r.kind === 'rope' || r.kind === 'lead' ? '○ / C take (hang on the rope), ○ again to be lowered' : r.kind === 'auto' ? '○ / C let go, the autobelay lowers you' : '○ / C drop off onto the mat';
    notice(`Hold L2 + R2 (both mouse buttons, or Q + R) to grip. Let go with one hand, look at the next hold and grip again · left stick: move your body, push up to stand tall · ✕ jump for a far hold · □ ${r.kind === 'lead' ? 'clip the next bolt, then the anchor' : 'chalk up'} · ${off}`, 10);
  }
  function endClimb() {
    const c = gym.climber, ps = c.pose(), n = c.n, floor = c.floorY(ps.feet), x = ps.feet.x + n.x * .6, z = ps.feet.z + n.z * .6;
    gym.end();player.mode = 'foot';$('climbHud').hidden = true;place(x, z, player.yaw, floor);
  }
  function updateClimb(dt, input, dl) {
    const c = gym.climber, curve = v => Math.sign(v) * v * v;
    player.yaw -= input.mouse.dx * .0024 * sensitivity.mouse + curve(input.look.x) * 2.4 * sensitivity.pad * dt;player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - input.mouse.dy * .0024 * sensitivity.mouse - curve(input.look.y) * 1.8 * sensitivity.pad * dt));
    const head = {x: c.hip.x + c.up.x * .62 + c.n.x * .06, y: c.hip.y + c.up.y * .62 + c.n.y * .06, z: c.hip.z + c.up.z * .62 + c.n.z * .06}, sway = dl ? Math.sin(performance.now() / 900) * .04 * dl : 0;
    camera.position.set(head.x, head.y, head.z);camera.rotation.order = 'YXZ';camera.rotation.set(player.pitch + sway, player.yaw, 0);if (camera.fov !== 70) {camera.fov = 70;camera.updateProjectionMatrix();}camera.updateMatrixWorld();
    const dir = camera.getWorldDirection(new T.Vector3()), aim = gym.aimAt(camera.position, dir), aimPt = gym.aimPoint(camera.position, dir);
    // Grips: L2 / left mouse button / Q = left hand, R2 / right mouse button / R = right hand (L1 / R1 work too).
    const grip = {L: !!(input.mouse.left || (!input.mouse.right && input.l2 > .5) || input.held.l1), R: !!(input.mouse.right || (!input.mouse.left && input.r2 > .5) || input.held.r1 || input.held.reload)};
    const gripEdge = {L: grip.L && !gripPrev.L, R: grip.R && !gripPrev.R};gripPrev = grip;
    const sq = input.pressed.has('square'), lead = c.style === 'lead';
    const ev = c.update(dt, {grip, gripEdge, aim, aimPoint: aimPt, stick: {x: Math.abs(input.move.x) > .15 ? input.move.x : 0, y: Math.abs(input.move.y) > .15 ? input.move.y : 0}, dyno: input.pressed.has('cross'), chalk: (sq && !lead) || input.pressed.has('down'), clip: sq && lead, letGo: input.pressed.has('circle'), drunk: dl});
    for (const e of ev) {
      if (e === 'grab') audio.sfx('hit', {gain: .25});else if (e === 'chalk') audio.sfx('sniff', {gain: .25});else if (e === 'clip') audio.sfx('click', {gain: .6});
      else if (e === 'catch' || e === 'take') audio.sfx('thud', {gain: .35});else if (e === 'catchHard' || e === 'land') audio.sfx('thud', {gain: .7});else if (e === 'landHard') audio.sfx('thud', {gain: 1});
      else if (e === 'deck') {audio.sfx('hit', {gain: 1});audio.sfx('thud', {gain: 1});}else if (e === 'dyno') audio.sfx('throw', {gain: .4});
      else if (e === 'send') {audio.sfx('cheer', {gain: .5});const how = gym.tick(c.route, c.style);notice(`Sent: ${c.route.name} (${GC.STYLE[c.route.kind]}) – ${how}!`, 5);if (gym.siri && (c.style === 'rope' || c.style === 'lead')) gym.siri.say('Bra jobba! 💪');}
      else if (e === 'fall' && c.style !== 'boulder' && c.style !== 'moon' && c.style !== 'campus') gym.siri && c.style !== 'auto' && gym.siri.say('Jeg har deg!');
      if (e !== 'grab') climbMsgT = 3;
    }
    if (c.msg) climbMsgT = Math.max(climbMsgT, .2);climbMsgT -= dt;
    gym.showClimb(camera.position, dir, aim, aim ? gym.classify(c.hands.L.hold ? 'R' : 'L', aim) : null);
    const ps = c.pose();player.x = ps.feet.x;player.z = ps.feet.z;player.feet = ps.feet.y;
    // HUD: the route, the pump, height, clips and what to do.
    const r = c.route, hgt = Math.max(0, ps.feet.y - c.floorY(ps.feet)), el = $('climbHud');el.hidden = false;
    const dot = r.moon ? '#42a5f5' : '#' + r.hex.toString(16).padStart(6, '0');
    el.innerHTML = `<b><i class="dot" style="background:${dot}"></i>${r.name} · ${GC.STYLE[r.kind]}${c.offRoute ? ' · <span class="warn">off route</span>' : ''}</b>`
      + `<span>Pump</span><i class="meter pump"><u style="width:${Math.round(c.pump * 100)}%;background:${c.pump > .8 ? '#ff5252' : c.pump > .55 ? '#ffb02e' : '#66d17a'}"></u></i>`
      + `<span>Height ${hgt.toFixed(1)} m${c.style === 'lead' ? ` · clips ${c.clipped}/${c.bolts.length}${c.anchorClipped ? ' · anchor ✓' : ''}` : ''}${c.feetOn ? '' : ' · feet hanging'}${c.chalk ? '' : ' · no chalk'}</span>`
      + (climbMsgT > 0 && c.msg ? `<small class="msg">${c.msg}</small>` : '')
      + `<small>${c.state === 'hang' ? 'Hanging on the rope: grip a hold to climb on · ○ / C lower' : c.state === 'lower' ? 'Lowering…' : 'Hold L2 / R2 (mouse buttons, Q / R) to grip · ✕ jump · □ ' + (c.style === 'lead' ? 'clip' : 'chalk') + ' · ○ ' + (c.style === 'boulder' || c.style === 'moon' || c.style === 'campus' ? 'drop off' : 'take')}</small>`;
    if (c.state === 'done') {const msg = c.decked ? c.msg : c.lowered ? (c.sent ? 'Back on the ground.' : 'Lowered to the ground.') : c.sent ? '' : c.msg;endClimb();if (msg) notice(msg, 4);}
  }
  // The hangboard: hold L2 + R2 on the 20 mm edge for as long as you can (your best time is saved).
  let hangT = 0, hangPump = 0;
  function startHang() {
    if (!gym.visit().paid) {notice(`Pay entry at the reception first (${GC.priceAt(new Date())} kr).`, 3);return;}
    watch.hide();if (photo.active) photo.toggle();player.mode = 'hang';hangT = 0;hangPump = 0;player.pitch = .5;
    notice('Hangboard, 20 mm edge: hold L2 + R2 (both mouse buttons) to hang – let go to drop off. Seven seconds on, three off is a classic set.', 6);
  }
  function updateHang(dt, input) {
    const both = (input.mouse.left && input.mouse.right) || (input.l2 > .5 && input.r2 > .5) || (input.held.l1 && input.held.r1);
    if (both) {hangT += dt;hangPump = Math.min(1, hangPump + dt / 24);} else {hangPump = Math.max(0, hangPump - dt / 6);if (hangT > .3) {const best = gym.state.bestHang || 0;if (hangT > best) {gym.state.bestHang = hangT;gym.save();}notice(`You hung ${hangT.toFixed(1)} s${hangT > best ? ' – a new best!' : ` (best ${best.toFixed(1)} s)`}.`, 4);hangT = 0;}}
    if (hangPump >= 1) {notice(`Your fingers give up after ${hangT.toFixed(1)} s.`, 4);hangT = 0;hangPump = .4;}
    if (input.pressed.has('circle') || input.pressed.has('square') || Math.hypot(input.move.x, input.move.y) > .5) {player.mode = 'foot';$('climbHud').hidden = true;return;}
    const curve = v => Math.sign(v) * v * v;player.yaw -= input.mouse.dx * .0024 * sensitivity.mouse + curve(input.look.x) * 2 * dt;player.pitch = Math.max(-1.2, Math.min(1.4, player.pitch - input.mouse.dy * .0024 * sensitivity.mouse - curve(input.look.y) * 1.5 * dt));
    camera.position.set(player.x, player.feet + (both ? 1.9 : player.eye), player.z);camera.rotation.order = 'YXZ';camera.rotation.set(player.pitch, player.yaw, 0);
    const el = $('climbHud');el.hidden = false;el.innerHTML = `<b>Hangboard · 20 mm edge</b><span>${both ? `Hanging ${hangT.toFixed(1)} s` : 'Hold L2 + R2 to hang'}</span><i class="meter pump"><u style="width:${Math.round(hangPump * 100)}%;background:${hangPump > .8 ? '#ff5252' : '#66d17a'}"></u></i><small>Best ${(gym.state.bestHang || 0).toFixed(1)} s · ○ / C / move to step away</small>`;
  }
  // Belaying Siri (the brattkort test, or for fun once you have a brattkort).
  let belay = null;
  function startBelay(test) {
    const route = gym.routes.filter(r => r.zone === 'Galleriet' && r.toprope)[test ? 1 : Math.floor(Math.random() * 6)];
    const b = gym.startBelay(route), spot = gym.belaySpot(route);belay = {b, route, test};
    place(spot.x, spot.z, spot.yaw, gym.floorY);player.mode = 'belay';player.pitch = .55;watch.hide();if (photo.active) photo.toggle();
    notice(`${test ? 'Brattkort test: ' : ''}You belay Siri on ${route.name} · R2 / left mouse takes in the rope as she climbs (keep the slack in the green) · L2 / right mouse is your brake hand – hold it the moment she falls · at the top hold ✕ / Space to lower her · ○ stop`, 10);
  }
  function updateBelay(dt, input) {
    const curve = v => Math.sign(v) * v * v, b = belay.b;
    player.yaw -= input.mouse.dx * .0024 * sensitivity.mouse + curve(input.look.x) * 2.2 * sensitivity.pad * dt;player.pitch = Math.max(-1.2, Math.min(1.45, player.pitch - input.mouse.dy * .0024 * sensitivity.mouse - curve(input.look.y) * 1.7 * sensitivity.pad * dt));
    camera.position.set(player.x, player.feet + player.eye, player.z);camera.rotation.order = 'YXZ';camera.rotation.set(player.pitch, player.yaw, 0);
    const ev = b.update(dt, {takeIn: input.r2 > .1 ? input.r2 : 0, brake: input.l2 > .5, lower: !!input.held.cross});
    for (const e of ev) {if (e === 'call' || e === 'fall') gym.siri && gym.siri.say(e === 'call' ? 'Ta inn!' : 'Faller!');if (e === 'catch') audio.sfx('thud', {gain: .5});if (e === 'drop') audio.sfx('thud', {gain: 1});if (e === 'top') gym.siri && gym.siri.say('Klar til å fires ned!');}
    const hand = {x: player.x - Math.sin(player.yaw) * .35, y: player.feet + 1.1, z: player.z - Math.cos(player.yaw) * .35};gym.showBelay(b, dt, hand);
    const zone = b.slack < .15 ? '#ffb02e' : b.slack > 1.3 ? '#ff5252' : '#66d17a', el = $('climbHud');el.hidden = false;
    el.innerHTML = `<b>${belay.test ? 'Brattkort test · ' : ''}Belaying Siri · ${belay.route.name}</b><span>Slack ${b.slack.toFixed(1)} m · Siri at ${b.y.toFixed(1)} m${b.mistakes.length ? ` · mistakes ${b.mistakes.length}` : ''}</span><i class="meter pump"><u style="width:${Math.round(Math.min(1, b.slack / 2) * 100)}%;background:${zone}"></u></i><small class="msg">${b.msg}</small><small>R2 / left mouse take in · L2 / right mouse brake · ✕ / Space lower · ○ stop</small>`;
    const over = ['passed', 'done', 'failed'].includes(b.state);
    if (over || (input.pressed.has('circle') && b.state !== 'fall')) {
      const passed = b.state === 'passed';gym.endBelay();player.mode = 'foot';$('climbHud').hidden = true;
      if (belay.test) {
        if (passed) {const d = new Date();gym.state.brattkort = `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;gym.save();audio.sfx('cheer', {gain: .5});notice('Brattkort (top rope) – passed! You may now belay on top rope.', 6);gym.staff && gym.staff.say('Gratulerer med brattkortet!');}
        else notice(b.state === 'failed' ? `Not passed: ${b.msg}. Try again another day.` : over ? `Not passed: ${b.mistakes.join('; ')}.` : 'The test stopped.', 6);
      } else notice(b.state === 'failed' ? b.msg : over ? 'Siri is down. Takk for sikringa!' : 'You stop belaying.', 4);
      belay = null;
    }
  }
  function siriTalk() {
    const v = gym.visit(), sends = Object.keys(gym.state.ticks).length;
    const lines = !v.paid ? ['Hei! Betal i resepsjonen, så klatrer vi. (Pay at the reception and we can climb.)'] : !v.shoes ? ['Husk klatresko – du får leid i resepsjonen.'] : !v.harness ? ['Skal vi ta tau? Lei en sele i resepsjonen, så sikrer jeg deg. (Rent a harness and I will belay you.)'] :
      ['Jeg har brattkort – velg en rute med topptau i Galleriet, så sikrer jeg. (Pick a top-rope route.)', 'Lede på Konkurranseveggen? Husk å klippe alle boltene!', `Du har klatret ${sends} ruter her. Prøv Hula eller Discorommet for buldring.`, 'Moonwall er i fjerde etasje, innerst og øverst.'];
    gym.siri.say(lines[Math.floor(performance.now() / 4000) % lines.length]);
  }
  // The reception menu: what you can buy or get, with the real prices for this time of day.
  function gymItems() {
    const v = gym.visit(), now = new Date(), price = GC.priceAt(now), bk = GC.brattkortPriceAt(now), staffed = GC.staffedAt(now), P = GC.PRICES;
    const pay = (kr, what, after) => () => {if (!wallet.pay(kr)) {notice(`Not enough money: ${KR(kr)} needed, you have ${KR(wallet.money)}.`, 3);return;}audio.sfx('register');walletT = 5;after();gym.save();notice(what, 4);};
    const items = [
      {label: v.paid ? '✓ Day ticket – paid today' : `Day ticket, adult – ${price} kr`, note: price === P.entryDay ? 'before 16 on weekdays' : 'after 16 and at weekends', done: v.paid,
        act: pay(price, gym.state.legal ? 'Day ticket paid. God klatring!' : 'Day ticket paid – first visit: you sign the legal notice (egenerklæring). God klatring!', () => {v.paid = true;gym.state.legal = true;})},
      {label: 'All of it without a rope – 100 kr', note: 'climbing shoes, harness and chalk for today', done: v.shoes && v.harness && v.chalk, act: pay(P.pack, 'Shoes, harness and chalk bag for today.', () => {v.shoes = v.harness = v.chalk = true;})},
      {label: v.shoes ? '✓ Climbing shoes' : 'Climbing shoes – 50 kr', note: 'you need them on the walls', done: v.shoes, act: pay(P.shoes, 'Climbing shoes – size 42, fits.', () => {v.shoes = true;})},
      {label: v.harness ? '✓ Harness' : 'Harness – 50 kr', note: 'for rope climbing and the autobelays', done: v.harness, act: pay(P.harness, 'Harness on.', () => {v.harness = true;})},
      {label: v.chalk ? '✓ Chalk bag' : 'Chalk bag – 20 kr', note: 'chalk up with □ / E or ↓ when you have a free hand', done: v.chalk, act: pay(P.chalk, 'Chalk bag on your belt.', () => {v.chalk = true;})},
      {label: gym.state.autoIntro ? '✓ Autobelay introduction' : 'Autobelay introduction – free', note: 'clip the carabiner to your harness belay loop, check the gate, climb; let go and it lowers you', done: gym.state.autoIntro, act: () => {gym.state.autoIntro = true;gym.save();gym.staff && gym.staff.say('Klipp i selen, sjekk at porten er lukket – så er du klar!');notice('Autobelay introduction done: you may use the six autobelay lines in the hall.', 4);}},
      {label: gym.state.brattkort ? `✓ Brattkort (top rope) – passed ${gym.state.brattkort}` : `Brattkort test (top rope) – ${bk} kr`, note: gym.state.brattkort ? 'you may belay Siri: □ when you look at her' : staffed ? 'three questions, then you belay Siri on a top-rope route while the staff watches' : 'only when the climbing staff is on duty: after 17 on weekdays, after 11 at weekends', done: !!gym.state.brattkort,
        act: () => {
          if (!staffed) {notice('The brattkort test can be taken when the climbing staff is on duty: after 17 on weekdays, after 11 at weekends.', 4);return;}
          if (!v.paid || !v.harness) {notice('Pay entry and rent a harness first – the test is done on the rope.', 4);return;}
          if (!wallet.pay(bk)) {notice(`Not enough money: ${KR(bk)} needed.`, 3);return;}audio.sfx('register');walletT = 5;gymMenu = {quiz: 0, sel: 0, wrong: 0};gym.staff && gym.staff.say('Først noen spørsmål, så sikrer du Siri.');}},
      {label: 'Your climbing log', note: `${Object.keys(gym.state.ticks).length} routes and problems sent · hangboard best ${(gym.state.bestHang || 0).toFixed(1)} s`, act: () => {const t = Object.entries(gym.state.ticks).slice(-6).map(([id, how]) => `${gym.routes[id].name} (${how})`).join(', ');notice(t ? `Latest: ${t}` : 'Nothing sent yet.', 6);}}
    ];
    return items;
  }
  function openGymMenu() {gymMenu = {sel: 0, stick: false};watch.hide();if (gym.staff) gym.staff.say(gym.visit().paid ? 'Hei igjen! Trenger du noe mer?' : 'Hei! Velkommen til Klatreverket.');renderGymMenu();}
  function renderGymMenu() {
    const el = $('gymMenu');el.hidden = !gymMenu;if (!gymMenu) return;
    if (gymMenu.quiz != null) {const q = GC.QUIZ[gymMenu.quiz];el.innerHTML = `<b>Brattkort test · question ${gymMenu.quiz + 1} of ${GC.QUIZ.length}</b><small>${q.q}</small>` + q.a.map((a, i) => `<div class="${i === gymMenu.sel ? 'sel' : ''}">${a}</div>`).join('') + '<small>↑↓ choose · ✕ / Space answer</small>';return;}
    const items = gymItems();gymMenu.sel = Math.max(0, Math.min(gymMenu.sel, items.length - 1));
    el.innerHTML = `<b>Klatreverket Torshov · ${KR(wallet.money)}</b><small>Open ${GC.HOURS}</small>` + items.map((e, i) => `<div class="${i === gymMenu.sel ? 'sel' : ''}${e.done ? ' done' : ''}">${e.label}<small>${e.note}</small></div>`).join('') + '<small>↑↓ choose · ✕ / Space take it · ○ / C close</small>';
  }
  function gymMenuInput(input) {
    if (gymMenu.quiz != null) {
      const q = GC.QUIZ[gymMenu.quiz], y = input.move.y;
      if (input.pressed.has('up') || (y < -.5 && !gymMenu.stick)) gymMenu.sel = Math.max(0, gymMenu.sel - 1);
      if (input.pressed.has('down') || (y > .5 && !gymMenu.stick)) gymMenu.sel = Math.min(q.a.length - 1, gymMenu.sel + 1);gymMenu.stick = Math.abs(y) > .5;
      if (input.pressed.has('cross')) {
        if (gymMenu.sel !== q.ok) {gymMenu.wrong++;notice(`Not right: ${q.a[q.ok]}.`, 4);}
        gymMenu.quiz++;gymMenu.sel = 0;
        if (gymMenu.quiz >= GC.QUIZ.length) {const wrong = gymMenu.wrong;gymMenu = null;if (wrong) notice('The staff: "Les deg opp og prøv igjen." – the test stops here (one wrong answer is enough).', 5);else startBelay(true);}
      }
      renderGymMenu();input.move.x = input.move.y = 0;['cross', 'circle', 'up', 'down', 'square', 'triangle'].forEach(b => input.pressed.delete(b));return;
    }
    const y = input.move.y, items = gymItems();
    if (input.pressed.has('up') || (y < -.5 && !gymMenu.stick)) gymMenu.sel = Math.max(0, gymMenu.sel - 1);
    if (input.pressed.has('down') || (y > .5 && !gymMenu.stick)) gymMenu.sel = Math.min(items.length - 1, gymMenu.sel + 1);
    gymMenu.stick = Math.abs(y) > .5;
    if (input.pressed.has('cross') && items[gymMenu.sel] && !items[gymMenu.sel].done) items[gymMenu.sel].act();
    if (input.pressed.has('circle') || input.pressed.has('square') || Math.hypot(player.x - gym.W(4, 5).x, player.z - gym.W(4, 5).z) > 4) gymMenu = null;
    renderGymMenu();input.move.x = input.move.y = 0;['cross', 'circle', 'up', 'down', 'square', 'triangle'].forEach(b => input.pressed.delete(b));
  }
  function firePrompt() {
    const near = (p, r) => Math.hypot(player.x - p.x, player.z - p.z) < r && Math.abs(player.feet - fire.center.y) < 1.5;
    if (near(fire.woodpile, 1.9)) return {text: `□ Throw a log on the fire (fire ${Math.round(mp.fireLevel() / fire.MAX * 100)} %)`, act: () => addLog()};
    if (near(fire.crate, 1.7)) return {text: '□ Take a beer from the crate', act: () => drinkBeer('crate')};
    let best = null, bd = 1.0;for (const s of fire.spots) {const d = Math.hypot(player.x - s.x, player.z - s.z);if (d < bd && !mp.sitTaken(s.id)) {bd = d;best = s;}}
    if (best) return {text: '□ Sit down by the fire', act: () => sitDown(best)};
    return null;
  }
  function addLog() {fire.throwLog({x: player.x, y: player.feet + 1.3, z: player.z});audio.sfx('throw');setTimeout(() => {audio.sfx('thud', {gain: .4});}, 600);mp.addWood();notice('You throw a log on the fire.', 2);markBadge('fire');}
  function drinkBeer() {audio.sfx('bottleOpen');audio.sfx('gulp');drunk += 30;beerT = 20;wallet.addPant(1);notice('Skål! A beer from the crate. (+30 s drunk, +1 bottle for the deposit)', 3);}
  function sitDown(spot) {watch.hide();if (photo.active) photo.toggle();player.mode = 'sit';player.sitSpot = spot;player.lookYaw = 0;player.lookPitch = -.32;notice('Sitting by the fire · R2 / left mouse: have a beer · □ stand up', 4);}
  function standUp() {const sp = player.sitSpot;player.mode = 'foot';player.sitSpot = null;const dx = fire.center.x - sp.x, dz = fire.center.z - sp.z, l = Math.hypot(dx, dz) || 1;place(sp.x + dx / l * .7, sp.z + dz / l * .7, sp.yaw);}
  function exitVehicle() {
    if (player.vehicle.rental) rentals.beforeExit(player.vehicle);// a city bike at a dock goes into a free slot
    const v = player.vehicle, i = vehicles.indexOf(v), p = v.exit();if (mp) mp.release(i, 'd', v.netGet());player.mode = 'foot';player.vehicle = null;setClip(.05, 450);$('speedo').classList.remove('air');updateDynamic();
    const y = heightAt(p.x, p.z), sp = collision.findSafeSpawn(walkWorld, p, player.eye, {y, maxDistance: 5});
    if (sp) {player.x = sp.x;player.z = sp.z;player.feet = sp.y;}player.yaw = v.yaw;player.pitch = 0;
    for (const [, w] of vehicleWorlds) collision.setDynamic(w, []);updateDynamic();
    if (v.rental) rentals.afterExit(v);
  }

  // ---------- Grünerløkka: library, Rathkes gate 1, table tennis, Akerselva (issues #44, #45, #47) ----------
  function grunerPrompt() {
    if (player.mode !== 'foot') return null;
    const o = lookTarget();
    for (const m of [library, rathkes]) {const p = m && m.prompt(o);if (p) return {text: p.text, act: () => {const r = p.act();if (r && r.notice) notice(r.notice, 5);if (r && r.sound) audio.sfx(r.sound);if (r && r.doors) r.doors.forEach(id => {const d = doors.find(x => x.id === id);if (d) toggleDoor(d);});}};}
    const k = kayak && kayak.prompt(player);if (k) return {text: k.text, act: () => startKayak(k.rack.i)};
    return null;
  }
  function startKayak(i) {watch.hide();if (photo.active) photo.toggle();bag = null;player.mode = 'kayak';player.lookYaw = 0;player.lookPitch = 0;notice(kayak.start(i), 8);}
  function updateKayak(dt, input, dl) {
    // Look around from the cockpit (right stick / mouse); it drifts back to straight ahead.
    player.lookYaw = Math.max(-2.2, Math.min(2.2, (player.lookYaw || 0) - input.mouse.dx * .0024 * sensitivity.mouse - input.look.x * 2.2 * dt));player.lookPitch = Math.max(-1.1, Math.min(.9, (player.lookPitch || 0) - input.mouse.dy * .0024 * sensitivity.mouse - input.look.y * 1.6 * dt));
    if (!input.mouse.dx && !input.look.x) player.lookYaw *= Math.max(0, 1 - dt * 1.5);
    if (dl) input.move.x += Math.sin(performance.now() / 700) * .4 * dl;
    const r = kayak.update(dt * worldScale(), input, camera, {yaw: player.lookYaw, pitch: player.lookPitch});
    if (r.notice) notice(r.notice, r.finish ? 8 : 2.5);
    if (r.finish) earn(r.finish.isBest ? 80 : 40, `Akerselva by kayak: ${r.finish.from} → Vaterland`);
    if (r.pos) {player.x = r.pos.x;player.z = r.pos.z;player.feet = r.pos.y;player.yaw = r.pos.yaw;}
    $('speedo').hidden = false;$('speedo').textContent = kayak.hud();
    if (r.exit) {kayak.stop();player.mode = 'foot';player.lookYaw = player.lookPitch = 0;place(r.exit.x, r.exit.z, r.exit.yaw);notice('You pull the kayak up onto the bank.', 2.5);}
  }
  // Other players' kayaks: a boat under their seated avatar; removed when they leave the lobby.
  const remoteKayaks = new Set();
  function kayakPose(r, st, g) {
    if (!kayak) return;
    if (st.ky) {if (!r.kayak) {r.kayak = kayak.remoteBoat();scene.add(r.kayak);remoteKayaks.add(r);}r.kayak.visible = true;r.kayak.position.set(st.ky[0], st.ky[1], st.ky[2]);r.kayak.rotation.set(0, st.ky[3], 0);g.position.set(st.ky[0], st.ky[1] + .28, st.ky[2]);g.rotation.set(0, st.ky[3], 0);}
    else if (r.kayak) r.kayak.visible = false;
  }
  // The librarian hears a voice above -22 dBFS for half a second as too loud (the voice chat has automatic gain).
  const LOUD_DB = -22, loudT = new Map();
  function grunerTick(dt) {
    if (kayak) kayak.tick(dt);
    for (const r of remoteKayaks) if (!mp.remotes.has(r.id)) {scene.remove(r.kayak);remoteKayaks.delete(r);}
    hushed = Math.max(0, hushed - dt);
    if (!library) return;
    const c = library.centre, nearLib = (x, z) => Math.hypot(x - c.x, z - c.z) < 60;
    const remotes = [...mp.remotes.values()].filter(r => r.seen && r.st && nearLib(r.pos.x, r.pos.z));
    const lv = (nearLib(player.x, player.z) || remotes.length) && mp.voice && mp.voice.levels ? mp.voice.levels() : {};
    const loud = id => {const v = lv[id] ?? -100, t = v > LOUD_DB ? (loudT.get(id) || 0) + dt : Math.max(0, (loudT.get(id) || 0) - dt * 2);loudT.set(id, t);return t > .5;};
    const people = [{id: 'me', x: player.x, z: player.z, feet: player.feet, running: player.mode === 'foot' && !!player.running, loud: loud('me')}];
    for (const r of remotes) people.push({id: r.id, x: r.pos.x, z: r.pos.z, feet: r.pos.y, running: !!r.st.rn, loud: loud(r.id)});
    for (const e of library.update(dt, people, camera)) if (e.kind === 'shush' && e.id === 'me') {hushed = 5;player.run = false;notice(e.why === 'run' ? '🤫 The librarian shushes you: no running in the library! (You walk for a while.)' : '🤫 The librarian shushes you: talk quietly in the library!', 4);}
  }
  if (pingpong) {pingpong.onWin = () => earn(60, 'You beat Ola at table tennis');pingpong.onEnd = won => badges.record('pingpong', {won});}

  // ---------- Minigames and mission start ----------
  function startMinigame(g) {const s = g.start({x: player.x, z: player.z, y: player.feet});player.mode = 'minigame';player.minigame = g;if (s) place(s.x, s.z, s.yaw);}
  function startMission() {
    if (!caseGame) return;if (photo.active) photo.toggle();
    caseGame.start(false);notice('');
  }

  // ---------- Input ----------
  const keys = new Set(), keyEdges = new Set();let mouse = {dx: 0, dy: 0, left: false, right: false, leftEdge: false, leftUp: false, wheel: 0};
  document.addEventListener('keydown', e => {if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {if (e.code === 'Escape') e.target.blur();return;}if (e.repeat) return;
    if ((e.code === 'Enter' || e.code === 'KeyT') && started && !paused) {e.preventDefault();openChat();return;}keys.add(e.code);keyEdges.add(e.code);if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();audio.resume();});
  document.addEventListener('keyup', e => {keys.delete(e.code);});
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('mousemove', e => {if (document.pointerLockElement === canvas) {mouse.dx += e.movementX;mouse.dy += e.movementY;}});
  canvas.addEventListener('mousedown', e => {audio.resume();if (document.pointerLockElement !== canvas) {if (started) lockPointer();return;}if (e.button === 0) {mouse.left = true;mouse.leftEdge = true;}if (e.button === 2) mouse.right = true;if (caseGame?.active) caseGame.mouse(e.button, true);});
  document.addEventListener('mouseup', e => {if (e.button === 0) {if (mouse.left) mouse.leftUp = true;mouse.left = false;}if (e.button === 2) mouse.right = false;if (caseGame?.active) caseGame.mouse(e.button, false);});
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => {mouse.wheel += e.deltaY;}, {passive: true});
  let padPrev = null;
  function readInput() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [], gp = padReader.pickGamepad(pads), st = gp ? padReader.read(gp) : null;
    const edges = st ? padReader.pressedEdges(padPrev, st) : [], released = st && padPrev ? Object.keys(st.buttons).filter(k => !st.buttons[k] && padPrev.buttons[k]) : [];padPrev = st;
    const k = c => keys.has(c), ke = c => keyEdges.has(c);
    const kx = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0), ky = (k('KeyS') ? 1 : 0) - (k('KeyW') ? 1 : 0);
    const input = {
      move: {x: st ? st.move.x : 0, y: st ? st.move.y : 0}, look: {x: st ? st.look.x : 0, y: st ? st.look.y : 0},
      held: Object.assign({}, st?.buttons || {}), pressed: new Set(edges), released: new Set(released), r2: st ? st.run : 0, l2: st ? st.aim : 0, gamepad: Boolean(gp), mouse: {...mouse}
    };
    if (kx || ky) {input.move.x = kx;input.move.y = ky;}
    const map = {Space: 'cross', KeyC: 'circle', KeyE: 'square', KeyF: 'triangle', Escape: 'options', KeyM: 'touchpad', KeyG: 'gallery', KeyZ: 'prone', KeyR: 'reload', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', ShiftLeft: 'l3', KeyQ: 'l1', KeyV: 'view', KeyY: 'share', KeyP: 'phone', KeyB: 'badges', Delete: 'delete', KeyX: 'cast', Digit1: 'magic1', Digit2: 'magic2', Digit3: 'magic3', Digit4: 'magic4'};
    for (const [code, name] of Object.entries(map)) {if (ke(code)) input.pressed.add(name);if (k(code)) input.held[name] = true;}
    // Flying (helicopter, plane, drone): hold Shift or the right mouse button to look around (Battlefield's free look, issue #16).
    const flying = player.mode === 'drone' || (player.mode === 'vehicle' && !!player.vehicle?.aircraft);
    input.freeLook = flying && (k('ShiftLeft') || k('ShiftRight') || mouse.right);
    if (mouse.left) input.r2 = Math.max(input.r2, 1);if (mouse.right && !flying) input.l2 = Math.max(input.l2, 1);
    if (mouse.leftUp) input.released.add('mouseLeft');if (mouse.leftEdge) input.pressed.add('mouseLeft');
    if (k('KeyW') && player.mode === 'vehicle') input.r2 = 1;if (k('KeyS') && player.mode === 'vehicle') input.l2 = 1;
    mouse.dx = mouse.dy = 0;mouse.leftEdge = mouse.leftUp = false;mouse.wheel = 0;keyEdges.clear();
    if (edges.length || (st && (Math.abs(st.move.x) + Math.abs(st.move.y) + Math.abs(st.look.x) + Math.abs(st.look.y) > 0))) audio.resume();
    return input;
  }

  // ---------- Start / pause overlays ----------
  function lockPointer() {try {const r = canvas.requestPointerLock && canvas.requestPointerLock();if (r && r.catch) r.catch(() => {});} catch {}}
  let started = false, paused = false;
  function begin() {if (started) return;started = true;$('start').hidden = true;audio.resume();lockPointer();world.setImagery(imageryWanted());const q = (new URLSearchParams(location.search).get('lobby') || '').toUpperCase();if (!(q && mp.net.connect(q))) mp.net.home();}
  function imageryWanted() {try {return localStorage.getItem('haarklous-aerial-imagery-v1') !== 'off';} catch {return true;}}
  $('startButton').onclick = begin;
  function setPaused(p) {paused = p;$('pause').hidden = !p;if (p && document.pointerLockElement === canvas) document.exitPointerLock();if (!p) lockPointer();renderSettings();}
  $('resume').onclick = () => setPaused(false);
  $('badgesOpen').onclick = () => badges.open();
  function renderSettings() {
    $('walletLine').textContent = `Money: ${shops.kr(wallet.money)} · empty bottles: ${wallet.pant} (${shops.kr(wallet.pant * shops.PANT)} at the bottle return)`;
    $('badgesOpen').textContent = `Badges and best scores (${badges.count} of ${badges.total})`;
    $('sensPad').value = sensitivity.pad;$('sensMouse').value = sensitivity.mouse;$('sensPadOut').textContent = sensitivity.pad.toFixed(2) + '×';$('sensMouseOut').textContent = sensitivity.mouse.toFixed(2) + '×';
    $('imagery').checked = imageryWanted();$('quality').value = String(quality);$('minimapOn').checked = map.minimap;
    $('musicVol').value = music.volume;$('musicOut').textContent = music.volume ? Math.round(music.volume * 100) + ' %' : 'off';
    const np = music.position();$('nowPlaying').textContent = np ? `${np.title} (${Math.floor(np.length / 60)}:${String(Math.round(np.length % 60)).padStart(2, '0')} loop)` : '–';
  }
  $('musicVol').oninput = e => {music.setVolume(+e.target.value);renderSettings();};
  function musicTrack() {if (caseGame?.active) return 'mission';if (catacomb?.state.inside) return null;if (player.mode === 'minigame') return player.minigame.music || (discCourses.includes(player.minigame) ? 'discgolf' : 'petanque');return 'main';}
  $('sensPad').oninput = e => {setSens('pad', +e.target.value);renderSettings();};$('sensMouse').oninput = e => {setSens('mouse', +e.target.value);renderSettings();};
  $('minimapOn').onchange = e => {map.minimap = e.target.checked;};
  $('imagery').onchange = e => {try {localStorage.setItem('haarklous-aerial-imagery-v1', e.target.checked ? 'on' : 'off');} catch {}world.setImagery(e.target.checked);};
  let quality = 1;try {quality = +(localStorage.getItem('haarklous-quality') ?? 1);} catch {}
  $('quality').onchange = e => {quality = +e.target.value;try {localStorage.setItem('haarklous-quality', String(quality));} catch {}applyQuality();};
  function applyQuality() {sun.castShadow = quality > 0;sun.shadow.mapSize.set(quality > 1 ? 4096 : 2048, quality > 1 ? 4096 : 2048);if (sun.shadow.map) {sun.shadow.map.dispose();sun.shadow.map = null;}pixelRatio = Math.min(window.devicePixelRatio || 1, [.8, 1.25, 2][quality]);renderer.setPixelRatio(pixelRatio);resize();}

  // ---------- Frame update ----------
  const clock = new T.Clock();let fpsAvg = 30, lowFrames = 0, ambienceTimer = 0, promptTimer = 0, cullT = 0, fireSoundT = 0;
  function resize() {const w = view.clientWidth, h = view.clientHeight;renderer.setSize(w, h, false);camera.aspect = w / h;camera.updateProjectionMatrix();overlayCamera.aspect = w / h;overlayCamera.updateProjectionMatrix();}
  new ResizeObserver(resize).observe(view);resize();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime, input = readInput();
    fpsAvg += (1 / Math.max(dt, .001) - fpsAvg) * .05;
    if (asking) {if (input.pressed.has('cross')) answer(true);else if (input.pressed.has('circle')) answer(false);renderFrame(0, t);return;}
    if (!started) {if (input.pressed.has('cross') || input.pressed.has('options')) begin();renderFrame(dt, t);return;}
    // Global toggles.
    if (input.pressed.has('badges') && !paused && !caseGame?.active && player.mode === 'foot') {setPaused(true);badges.open();input.pressed.delete('badges');}
    if (input.pressed.has('options') && badges.isOpen) {badges.close();input.pressed.delete('options');}
    if (input.pressed.has('options') && !caseGame?.active) {if (map.open) map.toggle();else if (photo.gallery) photo.openGallery(false);else if (library && library.reading) {library.closeBook();input.pressed.delete('options');}else setPaused(!paused);}
    if (paused) {
      if (badges.isOpen) {
        if (input.pressed.has('circle') || input.pressed.has('r1') || input.pressed.has('badges')) badges.close();
        badges.scroll((input.pressed.has('down') ? 120 : 0) - (input.pressed.has('up') ? 120 : 0) + (input.move.y + input.look.y) * 900 * dt);
      } else if (codePad) codePadInput(input);
      else if (input.pressed.has('r1') || input.pressed.has('badges')) badges.open();
      else {
        if (input.pressed.has('left') || input.pressed.has('right')) {music.setVolume(music.volume + (input.pressed.has('right') ? .1 : -.1));renderSettings();}
        if (input.pressed.has('triangle')) openCodePad();if (input.pressed.has('square') && mp.net.code !== mp.net.ownCode) {mp.net.home();notice('Back in your own lobby.', 3);}
        if (input.pressed.has('down')) {map.minimap = !map.minimap;renderSettings();}
      }
      if (progress.status !== $('acctProgress').textContent) $('acctProgress').textContent = progress.status;
      renderFrame(0, t);return;
    }
    // Chat: the controller's Share button opens quick chat; keyboard Enter / T opens the text box.
    if (input.pressed.has('share') && !map.open) {quick = quick ? null : {sel: 0, stick: false};renderQuick();}
    if (quick) quickInput(input);
    if (bag) bagInput(input);
    if (gymMenu) gymMenuInput(input);
    if (storgata && storgata.talking) storgata.input(input, storgataCtx(), storgataResult);
    // The jobs phone (issue #56): D-pad → / P on foot or in a vehicle (not on the site machines, where → is the arm on a keyboard).
    if (jobs.phone.open) jobs.phone.input(input);
    else if ((input.pressed.has('phone') || (input.pressed.has('right') && !player.vehicle?.site)) && (player.mode === 'foot' || player.mode === 'vehicle') && !pbBusy() && !map.open && !caseGame?.active && !bag && !gymMenu && !quick && !photo.active && !gear && !storgata?.talking) {openPhone();input.pressed.delete('right');input.pressed.delete('phone');}
    if (library && library.reading) library.readInput(input);
    if (caseGame?.active) {
      // The mission owns ✕ (begin), ○ (leave on panels), Options (pause), □ (door or reload), triggers.
      for (const name of input.pressed) {if (name === 'reload') caseGame.key({key: 'r', code: 'KeyR', repeat: false});else if (name === 'options' || caseGame.state !== 'play') caseGame.padButton(name === 'mouseLeft' ? '' : name);else if (['square', 'touchpad'].includes(name)) caseGame.padButton(name);}
      if (input.gamepad) caseGame.triggers(input.l2, input.r2);
      // The button that left the mission (○, ✕ …) must not also crouch or jump.
      if (!caseGame.active) {player.mode = 'foot';['circle', 'cross', 'square', 'options'].forEach(b => input.pressed.delete(b));}
    }
    if (catacomb) catacombTick(dt, input);
    badgeTick(dt);
    if (input.pressed.has('touchpad') && !caseGame?.active) map.toggle(player);
    if (map.open) {
      if (input.pressed.has('circle')) map.toggle();
      if (input.pressed.has('cross')) map.markCentre();if (input.pressed.has('square')) map.clearWaypoint();
      map.pan(input.move.x * 400 * dt, input.move.y * 400 * dt);if (input.look.y) map.zoom(Math.exp(-input.look.y * dt * 2));
      // The map's "up" is north (-s); facing (-sin yaw, -cos yaw) in the world is -(yaw - theta) on the map (issue #21: it was 180° off).
      map.draw({x: player.x, z: player.z, headingLocal: -(player.yaw - theta), others: lobbyArrows()});renderFrame(dt, t);return;
    }
    // △: a tap takes out the photo camera (or puts it away); holding it opens the gear menu: camera or FPV drone.
    if (player.mode === 'foot' && !caseGame?.active && !pbBusy()) {// the paintball lobby and game use △ and the D-pad
      if (input.pressed.has('triangle')) {if (photo.active) photo.toggle();else gear = {t0: performance.now(), open: false, sel: gearLast, stick: false};}
      if (gear) {
        if (input.held.triangle) {
          if (!gear.open && performance.now() - gear.t0 > 280) {gear.open = true;watch.hide();}
          if (gear.open) {
            const sx = Math.abs(input.move.x) > Math.abs(input.move.y) ? input.move.x : input.move.y;if (input.pressed.has('left') || input.pressed.has('up') || (sx < -.5 && !gear.stick)) gear.sel = 0;if (input.pressed.has('right') || input.pressed.has('down') || (sx > .5 && !gear.stick)) gear.sel = 1;gear.stick = Math.abs(sx) > .5;
            if (input.mouse.dx < -4) gear.sel = 0;else if (input.mouse.dx > 4) gear.sel = 1;
            input.move.x = input.move.y = 0;input.look.x = input.look.y = 0;input.mouse.dx = input.mouse.dy = 0;showGear(gear.sel);
          }
        } else {const g = gear;gear = null;showGear(null);if (g.open) {gearLast = g.sel;if (g.sel === 1) startDrone();else photo.toggle();} else photo.toggle();}
      }
      if (input.pressed.has('up') && !photo.active && !gear) watch.toggle();
      if (input.pressed.has('down') && !photo.active && !gear && !bag && !gymMenu) {openBag();input.pressed.delete('down');}
    } else if (gear) {gear = null;showGear(null);}
    if (photo.active || player.mode !== 'foot') watch.hide();
    magicTick(dt, input);
    if (photo.active) {
      if (input.pressed.has('square') || input.pressed.has('gallery')) photo.openGallery();
      if (photo.gallery) {if (input.pressed.has('left')) photo.browse(-1);if (input.pressed.has('right')) photo.browse(1);if (input.move.x > .6 && !photo.stick) {photo.browse(1);photo.stick = true;} else if (input.move.x < -.6 && !photo.stick) {photo.browse(-1);photo.stick = true;} else if (Math.abs(input.move.x) < .3) photo.stick = false;if (input.pressed.has('cross') || input.pressed.has('delete')) photo.deleteShown();if (input.pressed.has('circle') && !photo.cancelDelete()) photo.openGallery(false);renderFrame(dt, t);return;}
      if (input.pressed.has('circle')) photo.toggle();
      photo.setRaised(input.l2 > .4 ? 1 : 0);if (photo.raised > .5 && input.look.y) photo.setZoom(photo.zoom * Math.exp(-input.look.y * dt * 1.5));
      if (input.r2 > .6 && !photo.shutterHeld) {photo.shutterHeld = true;renderFrame(0, t, true);photo.capture(canvas, placeName());huntPhoto();renderFrame(dt, t);return;}
      if (input.r2 < .3) photo.shutterHeld = false;
    }
    // Drunk effect: decays in real time.
    drunk = Math.max(0, drunk - dt);const dl = drunkLevel();
    if (boost && (boost.t -= dt) <= 0) {boost = null;audio.muffle(false);notice('The boost wears off.', 2);}
    const wdt = dt * worldScale();stash.update(dt);shopsTick(dt);storgataTick(dt);gym.update(dt, player, camera);grunerTick(dt);if (route) route.tick(player, dt);world.update(camera.position);
    // The jump planes move first, so a jumper's seat (and camera) is where the plane is this frame.
    updateJumpFlight(dt);updateGamePilot(dt);
    if (player.mode === 'vehicle') updateVehicle(dt, input, dl);
    else if (player.mode === 'passenger') updatePassenger(dt, input, dl);
    else if (player.mode === 'sit') updateSit(dt, input, dl);
    else if (player.mode === 'jumpseat') updateJumpseat(dt, input, dl);
    else if (player.mode === 'skydive') updateSkydive(dt, input, dl);
    else if (player.mode === 'drone') updateDrone(dt, input, dl);
    else if (player.mode === 'minigame') updateMinigame(dt, input, dl);
    else if (player.mode === 'climb') updateClimb(dt, input, dl);
    else if (player.mode === 'hang') updateHang(dt, input, dl);
    else if (player.mode === 'belay') updateBelay(dt, input, dl);
    else if (player.mode === 'kayak') updateKayak(dt, input, dl);
    else updateFoot(dt, input, dl);
    // Other vehicles: parked ones idle (far ones are hidden and skipped), ones driven by other players are posed by the lobby.
    cullT -= dt;if (cullT <= 0) {cullT = .4;for (const v of vehicles) {const near = Math.hypot(v.x - camera.position.x, v.z - camera.position.z) < (v.cullDistance || 170);v.group.visible = near || v === player.vehicle;}if (vehicles.some((v, i) => mp.remoteDriven(i))) updateDynamic();}
    vehicles.forEach((v, i) => {if (v === player.vehicle && player.mode === 'vehicle') return;if (mp.remoteDriven(i) || (gp && v === caravan)) return;if (!v.group.visible && Math.abs(v.speed || 0) < .01 && !v.aircraft) return;v.update(wdt, {});});
    beerT = Math.max(0, beerT - dt);mp.update(dt);updatePilotAvatar(dt);if (player.mode === 'jumpseat' && skyd.ride) seatCamera();
    if (rentals) rentals.tick(dt, player);jobs.tick(dt, {player, drunk: dl, camera});jobs.remoteTick(mp.remotes, vehicles, dt, camera);renderJobHud(crewTick());if (jobs.phone.open) jobs.phone.render();
    if (site) site.update(wdt);
    if (paintball) {
      const foot = player.mode === 'foot', p = foot ? input.pressed : new Set(), h = foot ? input.held : {};
      paintball.update(dt, {r2: foot ? input.r2 : 0, l2: foot ? input.l2 : 0, reload: p.has('square') || p.has('reload'), up: p.has('up'), down: p.has('down'), left: p.has('left'), right: p.has('right'),
        triangle: p.has('triangle'), cross: p.has('cross'), crossHeld: !!h.cross, triangleHeld: !!h.triangle}, {remotes: [...mp.remotes.values()], onFoot: foot, camera});
    }
    {const fl = mp.fireLevel();fire.update(wdt, fl, camera);fireSoundT -= dt;if (fireSoundT <= 0) {fireSoundT = .25;const d = Math.hypot(player.x - FIRE_POS.x, player.z - FIRE_POS.z);audio.fire(fl, Math.max(0, 1 - d / 28));}}
    // Door animations.
    let doorsChanged = false;
    for (const d of doors) if (d.anim) {d.anim.t = Math.min(1, d.anim.t + dt * 2.2);const e = d.anim.t < .5 ? 2 * d.anim.t * d.anim.t : 1 - Math.pow(-2 * d.anim.t + 2, 2) / 2;setDoor(d, d.anim.from + (d.anim.to - d.anim.from) * e);if (d.anim.t >= 1) {d.open = d.anim.to === 1;d.anim = null;doorsChanged = true;}}
    if (doorsChanged || caseGame?.active) updateDynamic();
    promptTimer -= dt;if (promptTimer <= 0) {promptTimer = .15;promptAction = player.mode === 'minigame' || player.mode === 'drone' || gear?.open || quick || bag || gymMenu || jobs.phone.open || photo.active || storgata?.talking || (caseGame?.active && caseGame.state !== 'play') ? null : findPrompt();prompt(promptAction?.text);}
    weather.update(dt, camera, {indoor: weatherIndoor, windWorld: weatherWind});
    ambienceTimer -= dt;if (ambienceTimer <= 0) {ambienceTimer = .25;updateAmbience();if (audio.context) music.attach(audio.context);music.play(musicTrack());}
    // Adaptive resolution keeps the frame rate in the 20–30+ fps range on slower PCs.
    if (fpsAvg < 22) {if (++lowFrames > 90 && pixelRatio > .6) {pixelRatio = Math.max(.6, pixelRatio - .1);renderer.setPixelRatio(pixelRatio);resize();lowFrames = 0;}} else lowFrames = 0;
    updateGuide(dt);
    magicFx(dt);
    renderFrame(dt, t);
  }
  // The other players' arrows on the map and the minimap (their slot colour and name).
  const lobbyArrows = () => mp ? [...mp.remotes.values()].filter(r => r.seen).map(r => ({x: r.pos.x, z: r.pos.z, y: r.pos.y, headingLocal: -(r.yaw - theta), color: window.GameAvatars.slotCss(r.slot), name: r.name})) : [];
  // Minimap (issue #42) and the waypoint pin (issue #41): centred on you (on the drone while you fly it), turned with the camera.
  const camDir = new T.Vector3();
  function updateGuide(dt) {
    const g = player.mode === 'minigame' && player.minigame;map.course = g && g.layout ? g.layout() : null;// a disc golf round (issue #60)
    camera.getWorldDirection(camDir);const heading = -(player.yaw - theta), at = player.mode === 'drone' ? camera.position : player;
    const view = Math.hypot(camDir.x, camDir.z) > .05 ? theta - Math.atan2(-camDir.x, -camDir.z) : heading;// looking straight down (skydiving): your heading
    const alt = player.mode === 'drone' || player.mode === 'skydive' || player.vehicle?.aircraft ? camera.position.y - groundAt(at.x, at.z) : 0;
    if (map.guide({dt, camera, x: at.x, z: at.z, you: player, heading, view, alt, others: lobbyArrows(), ground: groundAt, show: !photo.active}) === 'reached') notice('Waypoint reached.', 2.5);
  }
  function placeName() {if (inApartment()) return 'Haarklous plass 17A, 4th floor';{const c = catacomb && catacomb.placeName(player);if (c) return c;}{const z = gym.zoneAt(player, player.feet);if (z) return `Klatreverket Torshov, ${gym.ZONE_NAME[z]}`;}const tw = towerAt(player.x, player.z, player.feet);if (tw) return tw.t.own ? 'Stairwell, Haarklous plass 17A' : 'Stairwell, Torshov';
    if (storgata && Math.hypot(player.x - storgata.people.kjell.at.x, player.z - storgata.people.kjell.at.z) < 60) return 'Kiwi Storgata 33, Oslo';
    // In a district patch: the nearest mapped neighbourhood (Ensjø, Kampen, Vålerenga, Gamlebyen …).
    const l = world.toLocal(player.x, player.z);if (Math.abs(l.x) > world.playHalf || Math.abs(l.s) > world.playHalf) {const near = DISTRICTS.flatMap(d => d.places).sort((a, b) => Math.hypot(a.x - l.x, a.s - l.s) - Math.hypot(b.x - l.x, b.s - l.s))[0];if (near) return `${near.name}, Oslo`;}
    return 'Torshov, Oslo';}

  function updateFoot(dt, input, dl) {
    // Look.
    const mouseScale = .0024 * sensitivity.mouse, padScale = sensitivity.pad * (photo.raised > .5 ? 1 / photo.zoom : 1) * (caseGame?.active ? caseGame.lookScale() : 1), curve = v => Math.sign(v) * v * v;
    player.yaw -= input.mouse.dx * mouseScale + curve(input.look.x) * 2.8 * padScale * dt;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - input.mouse.dy * mouseScale - curve(input.look.y) * 1.9 * padScale * dt));
    // Buttons: ✕ jump, ○ tap crouch / hold prone, □ interact, L3 run toggle.
    if (!caseGame?.active || caseGame.state === 'play') {
      if (input.pressed.has('cross')) {if (player.stance !== 'stand') setStance('stand');else if (!player.jumpY && !player.jumpV) {player.jumpV = 3.1 * (boostIs('jump') ? Math.sqrt(3) : 1);audio.footstep('grass', false, .4);}}
      if (input.pressed.has('circle')) {player.circleAt = performance.now();player.circleHeld = false;}
      if (player.circleAt) {if (!input.held.circle) {if (!player.circleHeld) setStance(player.stance === 'crouch' ? 'stand' : 'crouch');player.circleAt = null;} else if (!player.circleHeld && performance.now() - player.circleAt > 320) {player.circleHeld = true;setStance(player.stance === 'prone' ? 'stand' : 'prone');}}
      if (input.pressed.has('prone')) setStance(player.stance === 'prone' ? 'stand' : 'prone');
      if (input.pressed.has('l3')) player.run = !player.run;
      if (input.pressed.has('square') && !photo.active && !caseGame?.active && !pbArmed()) interact();// paintball: □ reloads
    }
    // Move.
    const canMove = (!caseGame?.active || caseGame.canMove()) && !(paintball && paintball.frozen);
    let mx = input.move.x, my = input.move.y;
    if (dl > 0) {mx += Math.sin(performance.now() / 700) * .55 * dl;my += Math.sin(performance.now() / 1100) * .15 * dl;}
    const mag = Math.min(1, Math.hypot(mx, my));
    player.running = false;
    if (canMove && mag > .05) {
      const running = player.stance === 'stand' && !(hushed > 0) && (player.run || (!caseGame?.active && !photo.active && !pbArmed() && input.r2 > .3) || input.held.l3);player.running = running;
      // Standing: 3.5 m/s (the user's wish for the Unreal version, 28 Oct 2026); crouching and prone keep 1.45 x .55 and x .28.
      const base = player.stance === 'stand' ? WALK_SPEED : 1.45 * stanceSpeed();
      const speed = (running ? 3.6 : base) * (caseGame?.active ? caseGame.moveScale() : 1) * (1 - dl * .25) * (boostIs('speed') ? 3 : 1), fwd = -my, right = mx;
      const dx = (-Math.sin(player.yaw) * fwd + Math.cos(player.yaw) * right) * speed * dt, dz = (-Math.cos(player.yaw) * fwd - Math.sin(player.yaw) * right) * speed * dt;
      const bx = player.x, bz = player.z;move(dx, dz);
      player.stride += Math.hypot(player.x - bx, player.z - bz);
      if (player.stride > (running || speed > 2.5 ? 1.05 : .72) * (player.stance === 'stand' ? 1 : .8)) {player.stride = 0;if (!(player.jumpY > .05)) footstep(running ? 1.2 : player.stance === 'stand' ? .8 : .45);}
    } else if (!mag) player.run = false;
    // Jump and stance easing.
    player.eyeNow += (stanceEye(player.stance) - player.eyeNow) * Math.min(1, dt * 9);
    // Levitation (Svev, issue #65): rising while R1 / 1 is held, then a slow sink until you land.
    if (magic.levitating || player.floating) {
      const head = collision.ceilingAt(walkWorld, player, player.feet) - .1 - player.eyeNow, r = window.GameMagic.levitate({y: player.jumpY, v: player.jumpV}, dt, {hold: magic.levitating, max: 3.2, head});
      player.jumpY = r.y;player.jumpV = r.v;if (player.floating && !r.floating) audio.sfx('land');player.floating = r.floating || magic.levitating;
    } else if (player.jumpV || player.jumpY) {player.jumpV -= 9.81 * dt;player.jumpY += player.jumpV * dt;const head = collision.ceilingAt(walkWorld, player, player.feet) - .1 - player.eyeNow;if (player.jumpY > head) {player.jumpY = Math.max(0, head);player.jumpV = Math.min(0, player.jumpV);}if (player.jumpY <= 0 && player.jumpV <= 0) {if (player.jumpV < -2) footstep(1.3);player.jumpY = 0;player.jumpV = 0;}}
    // Camera.
    const sway = dl ? {r: Math.sin(performance.now() / 1300) * .09 * dl, y: Math.sin(performance.now() / 1700) * .05 * dl, p: Math.sin(performance.now() / 900) * .03 * dl} : {r: 0, y: 0, p: 0};
    camera.position.set(player.x, player.feet + player.eyeNow + player.jumpY, player.z);
    camera.rotation.set(0, 0, 0, 'YXZ');camera.rotation.order = 'YXZ';camera.rotation.y = player.yaw + sway.y;camera.rotation.x = player.pitch + sway.p;camera.rotation.z = sway.r;
    const fov = photo.active && photo.raised > .5 ? 70 / photo.zoom : caseGame?.active ? camera.fov : pbArmed() ? 70 / (1 + .45 * paintball.aim) : boostIs('speed') ? 82 : 70 + magicKick * 16;if (Math.abs(camera.fov - fov) > .01 && !caseGame?.active) {camera.fov = fov;camera.updateProjectionMatrix();}
  }
  function footstep(soft = 1) {
    let surface = 'grass', stair = false;
    if (shops.shopAt(player, player.feet)) surface = 'tile';
    else if (gym.zoneAt(player, player.feet)) {const f = collision.supportAt(walkWorld, player, player.feet)?.floor;surface = f?.surfaceKind === 'mat' ? 'sand' : f?.surfaceKind === 'metal' ? 'metal' : 'tile';stair = f?.surfaceKind === 'metal';}
    else if (library && library.inside(player.x, player.z, player.feet)) surface = 'wood';
    else if (inApartment()) {const r = roomAt();surface = r === 'bath' ? 'tile' : r ? 'wood' : 'metal';}
    else if (towerAt(player.x, player.z, player.feet) || catacomb?.state.depth > 0) {surface = 'stone';stair = true;}
    else {const s = world.surfaceAt(player.x, player.z);surface = s === 'asphalt' ? 'asphalt' : s === 'gravel' ? 'gravel' : s === 'sand' ? 'sand' : 'grass';}
    audio.footstep(surface, stair, soft);
  }
  function updateVehicle(dt, input, dl) {
    const v = player.vehicle;
    if (v.aircraft) {updateAircraft(dt, input, dl);return;}
    if (input.pressed.has('square') && Math.abs(v.speed) < 3) {exitVehicle();return;}
    const steer = Math.abs(input.move.x) > .08 ? input.move.x : 0;
    // Construction machines: the arrow keys work as the right stick on a keyboard.
    const kb = (a, b) => (input.held[a] ? 1 : 0) - (input.held[b] ? 1 : 0), rx = Math.max(-1, Math.min(1, input.look.x + (v.site ? kb('right', 'left') : 0))), ry = Math.max(-1, Math.min(1, input.look.y + (v.site ? kb('down', 'up') : 0)));
    v.update(dt, {throttle: input.r2, brake: input.l2, steer, drunk: dl, l1: input.held.l1, l2: input.l2, r1: input.held.r1, r2: input.r2, cross: input.pressed.has('cross'), lx: input.move.x, ly: input.move.y, rx, ry, sticks: {lx: input.move.x, ly: input.move.y, rx: input.look.x, ry: input.look.y}});
    // Look around from the seat (right stick / mouse); the excavators use the right stick for the boom, so mouse only there.
    const tool = v.kind === 'excavator' || v.rightStickTool, lookX = tool ? 0 : input.look.x, lookY = tool ? 0 : input.look.y;
    player.lookYaw = (player.lookYaw || 0) - input.mouse.dx * .0024 * sensitivity.mouse - lookX * 2.2 * dt;player.lookPitch = Math.max(-1.2, Math.min(1, (player.lookPitch || 0) - input.mouse.dy * .0024 * sensitivity.mouse - lookY * 1.6 * dt));
    if (!input.mouse.dx && !lookX) player.lookYaw *= Math.max(0, 1 - dt * 1.2);
    const seat = v.seat(), sway = dl ? Math.sin(performance.now() / 1300) * .08 * dl : 0;
    camera.position.set(seat.x + (seat.lateral || 0) * Math.cos(v.yaw), seat.y, seat.z - (seat.lateral || 0) * Math.sin(v.yaw));
    camera.rotation.order = 'YXZ';camera.rotation.y = seat.yaw + player.lookYaw - (v.kind === 'excavator' ? .22 : 0) + (v.camYaw || 0);camera.rotation.x = seat.pitch + player.lookPitch - (v.kind === 'motorcycle' ? .12 : v.kind === 'excavator' ? .38 : .05) + (v.camPitch || 0);camera.rotation.z = -(seat.roll || 0) + sway;
    if (camera.fov !== 70) {camera.fov = 70;camera.updateProjectionMatrix();}
    if (v.site) siteMachineView(v, seat, input);
    player.x = v.x;player.z = v.z;player.feet = v.y;player.yaw = v.yaw;
    $('speedo').hidden = false;$('speedo').textContent = v.rental ? rentals.hud(v) : v.hud ? v.hud() : v.kind === 'excavator' ? `${(Math.abs(v.speed) * 3.6).toFixed(1)} km/h · bucket ${Math.round(v.load * 100)} %` : `${Math.round(Math.abs(v.speed) * 3.6)} km/h${v.kind === 'motorcycle' ? ` · gear ${v.gear} · ${Math.round(v.rpm / 100) * 100} rpm` : ''}`;
  }
  // Construction-site machines (ported from the Unreal version, where the cabs were hard to see from): R3 / V cycles the
  // view from the cab, from outside (behind and above along the operator's heading; the mouse turns it round the machine)
  // and, for the two cranes, straight down from above the hook (the jib's direction up the screen).
  function siteMachineView(v, seat, input) {
    const tower = v.kind === 'tower', crane = tower || v.kind === 'crane';
    if (input.pressed.has('r3') || input.pressed.has('view')) {
      const modes = tower ? [0, 2] : crane ? [0, 2, 1] : [0, 1];player.siteView = modes[(modes.indexOf(player.siteView || 0) + 1) % modes.length];player.lookYaw = 0;player.lookPitch = 0;
      notice(player.siteView === 0 ? 'View: from the cab' : player.siteView === 1 ? 'View: from outside' : 'View: from above the hook', 1.5);
    }
    if (player.siteView === 2 && v.hook) {
      const top = (tower ? v.trolleyNode : v.tipNode).getWorldPosition(new T.Vector3()), up = Math.max(3, Math.min(16, top.y - v.hook.p.y - 1));
      camera.position.copy(v.hook.p).add(new T.Vector3(0, up, 0));camera.rotation.set(-Math.PI / 2 + .001, seat.yaw, 0);
      if (camera.fov !== 75) {camera.fov = 75;camera.updateProjectionMatrix();}
    } else if (player.siteView === 1) {
      const H = seat.yaw + (player.lookYaw || 0), dist = Math.max(10, v.length * .5 + 8), up = v.height + (crane ? 6 : 3.5), fx = -Math.sin(H), fz = -Math.cos(H);
      const look = new T.Vector3(v.x + fx * v.length * .4, v.y + 1.2, v.z + fz * v.length * .4), cam = new T.Vector3(v.x - fx * dist, v.y + up, v.z - fz * dist);
      cam.y = Math.max(cam.y, heightAt(cam.x, cam.z) + 1.5);camera.position.copy(cam);
      camera.rotation.set(Math.atan2(look.y - cam.y, Math.hypot(look.x - cam.x, look.z - cam.z)) + (player.lookPitch || 0) * .5, H, 0);
    }
  }
  // Mode 2 sticks for the aircraft and the drone; the keyboard uses W/S, A/D and the arrow keys.
  // Battlefield-style mouse flying (issue #16): the mouse is the right stick – mouse up = nose down, mouse down = nose up,
  // left / right = roll – with W / S and A / D as the left stick. The mouse's speed is the stick deflection (700 px/s = full
  // at sensitivity 1), so how far you move it is how far the aircraft tilts; `hold` asks the aircraft to keep that tilt rather
  // than level itself. Arrow keys and the controller work as before (they turn `hold` off).
  const mouseFly = {x: 0, y: 0, hold: false};
  function flightSticks(input, dl, dt = 1 / 60, mouseScale = 1) {
    const dz = a => Math.abs(a) < .07 ? 0 : a, kb = (a, b) => (input.held[a] ? 1 : 0) - (input.held[b] ? 1 : 0), wob = dl ? Math.sin(performance.now() / 480) * .3 * dl : 0;
    const k = input.freeLook ? 0 : mouseScale * sensitivity.mouse / 700 / Math.max(dt, .004), a = Math.min(1, dt / .05);
    mouseFly.x += (input.mouse.dx * k - mouseFly.x) * a;mouseFly.y += (input.mouse.dy * k - mouseFly.y) * a;
    if (k && (input.mouse.dx || input.mouse.dy)) mouseFly.hold = true;
    if (Math.abs(input.look.x) + Math.abs(input.look.y) > .1 || kb('right', 'left') || kb('down', 'up')) mouseFly.hold = false;
    return {lx: dz(input.move.x) + wob * .5, ly: dz(input.move.y), rx: Math.max(-1, Math.min(1, dz(input.look.x) + kb('right', 'left') + wob + mouseFly.x)), ry: Math.max(-1, Math.min(1, dz(input.look.y) + kb('down', 'up') + wob * .4 + mouseFly.y)), brake: input.l2, hold: mouseFly.hold};
  }
  // Free look while flying: Shift or the right mouse button held, the mouse turns your head; let go and it turns back.
  function flightLook(input, dt) {
    if (input.freeLook) {player.lookYaw = Math.max(-2.6, Math.min(2.6, (player.lookYaw || 0) - input.mouse.dx * .0024 * sensitivity.mouse));player.lookPitch = Math.max(-1.1, Math.min(1, (player.lookPitch || 0) - input.mouse.dy * .0024 * sensitivity.mouse));}
    else {const k = Math.max(0, 1 - dt * 5);player.lookYaw = (player.lookYaw || 0) * k;player.lookPitch = (player.lookPitch || 0) * k;}
    camera.rotateY(player.lookYaw);camera.rotateX(player.lookPitch);
  }
  function updateAircraft(dt, input, dl) {
    const v = player.vehicle;
    if (input.pressed.has('square') && v.grounded && v.speed < 3) {exitVehicle();return;}
    // The Caravan: △ hands it to the game's pilot (you go to the back); ✕ above 300 m hands it over and jumps.
    if (v === caravan && input.pressed.has('triangle')) {handOver(false);return;}
    if (v === caravan && input.pressed.has('cross') && !v.grounded) {if (v.y - heightAt(v.x, v.z) > 300) {handOver(true);return;}notice('Climb above 300 m to jump.', 2);}
    if (input.pressed.has('r3') || input.pressed.has('view')) {player.chase = !player.chase;player.chaseCam = null;}
    v.update(dt, flightSticks(input, dl, dt));
    const pose = v.cameraPose(player.chase, player.chaseCam);if (player.chase) player.chaseCam = pose.position.clone();
    camera.position.copy(pose.position);camera.quaternion.copy(pose.quaternion);
    if (!player.chase) flightLook(input, dt);
    if (camera.fov !== 72) {camera.fov = 72;camera.updateProjectionMatrix();}
    player.x = v.x;player.z = v.z;player.feet = v.y;player.yaw = v.yaw;
    const sp = $('speedo');sp.hidden = false;sp.classList.add('air');sp.textContent = v.broken ? 'CRASHED' : v.hud();
  }
  // ---------- FPV drone ----------
  function floorBelow(p, y) {
    let best = null;
    for (const f of walkWorld.floors) {const b = f.bounds;if (p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ || !inside(p, f.points)) continue;const h = f.surface(p);if (h <= y + .05 && (!best || h > best.y)) best = {y: h, ceiling: f.ceilingHeight ?? Infinity};}
    return best;
  }
  function startDrone() {
    const f = {x: -Math.sin(player.yaw), z: -Math.cos(player.yaw)}, p = {x: player.x + f.x * 1.1, z: player.z + f.z * 1.1}, fl = floorBelow(p, player.feet + .4);
    if (!fl || Math.abs(fl.y - player.feet) > .6 || collision.hitsSolid(walkWorld, p, fl.y, fl.y + .35)) {notice('No room to launch the drone here – face an open space.');return;}
    watch.hide();if (photo.active) photo.toggle();drone.launch(p.x, fl.y, p.z, player.yaw);player.mode = 'drone';setClip(.03, 900);view.dataset.drone = '';
    notice('FPV drone · left stick ↑↓ thrust, ←→ yaw · right stick tilt · L1 / Q angle ↔ acro · ✕ reset after a crash · ○ / △ pack it away', 8);
  }
  function stopDrone() {drone.stop();player.mode = 'foot';setClip(.05, 450);$('osd').hidden = true;delete view.dataset.drone;}
  let osdT = 0;
  function updateDrone(dt, input, dl) {
    if (input.pressed.has('circle') || input.pressed.has('triangle')) {stopDrone();notice('Drone packed away.', 2);return;}
    if (input.pressed.has('l1')) {drone.setMode(drone.mode === 'angle' ? 'acro' : 'angle');notice(drone.mode === 'acro' ? 'ACRO: the right stick sets rotation rates – nothing self-levels. Flips and rolls!' : 'ANGLE: the drone levels itself and holds altitude with the stick centred.', 4);}
    if (input.pressed.has('cross') && (drone.crashed || !drone.armed)) {if (drone.battery > 0) drone.reset();else notice('Battery empty – ○ to pack the drone away, then launch it again with a fresh pack.', 4);}
    drone.update(dt, flightSticks(input, dl, dt, drone.mode === 'acro' ? .3 : 1), {floor: floorBelow, solid: (p, a, b) => collision.hitsSolid(walkWorld, p, a, b), listener: {x: player.x, y: player.feet + 1.6, z: player.z}});
    const pose = drone.cameraPose();camera.position.copy(pose.position);camera.quaternion.copy(pose.quaternion);flightLook(input, dt);
    if (camera.fov !== 100) {camera.fov = 100;camera.updateProjectionMatrix();}
    if ((osdT -= dt) > 0) return;osdT = .1;
    const fl = floorBelow(drone.pos, drone.pos.y + .1), o = drone.osd(fl ? fl.y : heightAt(drone.pos.x, drone.pos.z)), mm = Math.floor(o.time / 60), ss = String(Math.floor(o.time % 60)).padStart(2, '0');
    const el = $('osd');el.hidden = false;
    el.innerHTML = `<div class="tl">${o.mode}<br>${o.armed ? 'ARMED' : 'DISARMED'}</div><div class="tr">${o.volts} V · ${o.battery} %<span class="bar"><i style="width:${o.battery}%"></i></span><br>${mm}:${ss}</div>` +
      `<div class="bl">ALT ${o.alt.toFixed(1)} m<br>THR ${Math.round(o.thrust * 100)} %</div><div class="br">${Math.round(o.speed)} km/h<br>HOME ${Math.round(o.dist)} m</div><div class="mid">-+-</div>` +
      (o.crashed ? '<div class="warn">CRASHED<br><small>✕ reset · ○ pack away</small></div>' : o.battery <= 0 ? '<div class="warn">BATTERY EMPTY</div>' : o.battery < 20 ? '<div class="warn">LOW BATTERY</div>' : '');
  }
  // ---------- Skydiving (issue #22) ----------
  // The scheduled jump flight: an 8-minute cycle on the shared server clock (boarding at the strip, take-off, a climbing
  // spiral to 3000 m, a 60 s jump run with the green light, then it flies off). Everybody sees the same flight.
  const SKY = window.GameSkydive, jumpStart = {x: AIR.plane.x - Math.sin(AIR.plane.yaw) * 45, z: AIR.plane.z - Math.cos(AIR.plane.yaw) * 45};
  const jumpPlan = SKY.plan({start: jumpStart, yaw: AIR.plane.yaw, groundY: heightAt(jumpStart.x, jumpStart.z), gearH: 1.55, ground: heightAt});
  // The game's pilot lines the Caravan up 26 m from the strip's north end, behind the scheduled flight's boarding place (45 m).
  const CARAVAN_HOLD = {x: AIR.plane.x - Math.sin(AIR.plane.yaw) * 26, z: AIR.plane.z - Math.cos(AIR.plane.yaw) * 26, yaw: AIR.plane.yaw};
  const autoPlane = new AC.JumpPlane(jumpStart.x, jumpStart.z, AIR.plane.yaw);autoPlane.prop = 900;scene.add(autoPlane.group);
  const skyd = {ride: null, jumper: null, canopy: null, beeps: {}, chase: false, chaseCam: null};// skydiving state
  let jumpFlight = SKY.flight(0, jumpPlan);
  const skyClock = () => (mp && mp.net.online ? mp.net.serverNow() : Date.now()) / 1000;
  function updateJumpFlight(dt) {
    const f = jumpFlight = SKY.flight(skyClock(), jumpPlan);
    autoPlane.pos.set(f.x, f.y, f.z);autoPlane.q.setFromEuler(new T.Euler(f.pitch, f.yaw, f.roll, 'YXZ'));autoPlane.vel.set(-Math.sin(f.yaw) * f.speed, 0, -Math.cos(f.yaw) * f.speed);
    autoPlane.prop = f.phase === 'board' ? 900 : 2600;autoPlane.spin(dt);autoPlane.place();autoPlane.group.visible = f.visible;
  }
  // Your place in the plane: your player number in a lobby (12 places, 12 players), else the first place.
  const mySeat = () => (mp && mp.net.online ? mp.net.slot : 0) % 12;
  function boardPrompt() {
    if (player.mode !== 'foot') return null;
    const f = jumpFlight;
    if (f.phase === 'board' && Math.hypot(player.x - f.x, player.z - f.z) < 9) {const m = Math.floor(f.leavesIn / 60), ss = String(Math.floor(f.leavesIn % 60)).padStart(2, '0');return {text: `□ Board the jump flight (leaves in ${m}:${ss}, up to 3000 m) · place ${mySeat() + 1}`, act: () => boardAuto()};}
    const d = caravan.doorWorld(), drv = mp.occupant(caravanIndex(), 'd');
    if (Math.hypot(player.x - d.x, player.z - d.z) < 3.2 && caravan.grounded && caravan.speed < 3) return {text: `□ Board the Caravan as a jumper (place ${mySeat() + 1})${gamePilotFlies() || drv ? ' · ' + driverName(caravanIndex()) + ' flies' : " · no pilot: fly it yourself, or board and press △ for the game's pilot"}`, act: () => boardCaravan()};
    return null;
  }
  function enterSeat(craft, auto) {
    watch.hide();if (photo.active) photo.toggle();player.mode = 'jumpseat';player.vehicle = null;skyd.ride = {craft, auto, seat: mySeat()};player.lookYaw = 0;player.lookPitch = 0;
    setClip(.12, 1600);audio.sfx('doorClose');notice(auto ? 'You are on the jump flight. It climbs to 3000 m; at the green light press ✕ (Space) to jump. □ gets off before take-off.' : 'You are a jumper in the Caravan. When it is above 300 m, press ✕ (Space) to jump.', 6);
  }
  const boardAuto = () => enterSeat(autoPlane, true), boardCaravan = () => enterSeat(caravan, false);
  function leaveSeat(where) {const p = where || skyd.ride.craft.doorWorld();skyd.ride = null;player.mode = 'foot';place(p.x, p.z, player.yaw);setClip(.05, 450);}
  function canJump() {
    const R = skyd.ride;if (!R) return false;const c = R.craft, agl = c.pos.y - heightAt(c.pos.x, c.pos.z);
    return R.auto ? jumpFlight.green : !c.grounded && agl > 300;
  }
  function jumpseatPrompt() {
    const R = skyd.ride;if (!R) return null;
    const onGround = R.auto ? jumpFlight.phase === 'board' : R.craft.grounded && R.craft.speed < 3;
    if (onGround) return {text: '□ Get off the plane' + (!R.auto && !gamePilotFlies() && !mp.occupant(caravanIndex(), 'd') ? " · △ / F: the game's pilot flies you up" : ''), act: () => leaveSeat()};
    return null;
  }
  function updateJumpseat(dt, input, dl) {
    const R = skyd.ride, c = R.craft, f = jumpFlight;
    // The scheduled flight: anybody still on board when it has flown off is brought back to the airstrip.
    if (R.auto && f.phase === 'away' && !f.visible) {leaveSeat(jumpStart);notice('The jump plane landed back at the airfield.', 4);return;}
    if (!R.auto && c.broken) {leaveSeat(c.exitPoint());return;}
    if (input.pressed.has('cross') && canJump()) {jump();return;}
    if (input.pressed.has('square')) {const p = jumpseatPrompt();if (p) {p.act();return;}}// get off while it stands still
    if (input.pressed.has('triangle') && !R.auto) callGamePilot();
    player.lookYaw = Math.max(-2.6, Math.min(2.6, (player.lookYaw || 0) - input.mouse.dx * .0024 * sensitivity.mouse - input.look.x * 2.2 * sensitivity.pad * dt));
    player.lookPitch = Math.max(-1.1, Math.min(1, (player.lookPitch || 0) - input.mouse.dy * .0024 * sensitivity.mouse - input.look.y * 1.6 * sensitivity.pad * dt));
    const hip = seatCamera();
    if (camera.fov !== 70) {camera.fov = 70;camera.updateProjectionMatrix();}
    player.x = hip.x;player.z = hip.z;player.feet = hip.y;player.yaw = new T.Euler().setFromQuaternion(c.q, 'YXZ').y + Math.PI;// you face the tail
    const agl = c.pos.y - heightAt(c.pos.x, c.pos.z), sp = $('speedo');sp.hidden = false;sp.classList.add('air');
    const m = Math.floor(Math.max(0, R.auto && f.phase === 'board' ? f.leavesIn : 0) / 60), ss = String(Math.floor(Math.max(0, R.auto ? f.leavesIn || 0 : 0) % 60)).padStart(2, '0');
    sp.textContent = R.auto ? (f.phase === 'board' ? `JUMP FLIGHT · boarding · leaves in ${m}:${ss}` : f.green ? `GREEN LIGHT · ${Math.round(agl)} m · ✕ / Space: JUMP` : f.phase === 'run' ? `Jump run · ${Math.round(agl)} m · door open, wait for the green light` : `Climbing · ${Math.round(agl)} m${f.phase === 'climb' ? ' · the climb is sped up' : ''}`)
      : pilotHud(agl, c);
    setClip(agl > 800 ? .4 : .12, Math.min(9000, Math.max(1600, agl * 2.5 + 1200)));
  }
  // You sit facing the tail; looking round turns your head. Placed again at the end of the frame, after a plane flown on
  // another computer has moved (else the camera trails it by a frame and can end up behind the cabin wall).
  function seatCamera() {
    const R = skyd.ride, c = R.craft, hip = c.seatWorld(R.seat);
    camera.position.copy(hip).add(new T.Vector3(0, .78, 0).applyQuaternion(c.q));
    camera.quaternion.copy(c.q).multiply(new T.Quaternion().setFromEuler(new T.Euler(player.lookPitch, Math.PI + player.lookYaw, 0, 'YXZ')));
    return hip;
  }
  // Out of the door: the jumper starts with the plane's speed and falls; the plane keeps flying.
  function jump() {
    const R = skyd.ride, c = R.craft, d = c.doorWorld(), v = c.vel;
    skyd.jumper = new SKY.Jumper({x: d.x, y: d.y, z: d.z, vx: v.x, vy: v.y, vz: v.z, yaw: new T.Euler().setFromQuaternion(c.q, 'YXZ').y + Math.PI / 2});// out of the left door, facing away from the plane
    skyd.ride = null;skyd.beeps = {};player.mode = 'skydive';skyd.chase = false;skyd.chaseCam = null;audio.sfx('throw');
    if (!skyd.canopy) {const av = window.GameAvatars.create({T, lib});skyd.canopy = SKY.canopy(T, av.SLOT_COLORS[mySeat() % 12]);skyd.canopy.visible = false;scene.add(skyd.canopy);
      skyd.body = av.avatar(mySeat(), '');skyd.body.group.visible = false;scene.add(skyd.body.group);}// your own body, seen in the outside view
    notice('Freefall! W tracks, A/D turn, S back-slides · ✕ / Space pulls at about 1000 m · R3 / V outside view', 6);
  }
  function updateSkydive(dt, input, dl) {
    const J = skyd.jumper;
    if (input.pressed.has('r3') || input.pressed.has('view')) {skyd.chase = !skyd.chase;skyd.chaseCam = null;}
    const inp = {fwd: Math.max(-1, Math.min(1, -input.move.y)), turn: Math.max(-1, Math.min(1, input.move.x)), pull: input.pressed.has('cross')};
    const ev = J.update(dt, inp, {ground: (x, z) => groundAt(x, z), wind: weatherWind, blocked: (x, y, z) => collision.hitsSolid(walkWorld, {x, z}, y + .2, y + 1.6)});
    const agl = J.agl;
    if (ev === 'pull') audio.sfx('throw');
    if (ev === 'reserve') notice('Your reserve opened automatically (300 m)!', 4);
    if (ev === 'open') {audio.sfx('thud', {gain: .7});notice('Canopy open · A/D steer · W front risers · S flare just before you land', 5);}
    for (const [h, txt] of [[1500, '1500 m'], [1000, 'PULL!']]) if (J.state === 'freefall' && agl < h && !skyd.beeps[h]) {skyd.beeps[h] = true;audio.sfx('locked');notice(txt, 1.5);}
    skyd.canopy.visible = J.state === 'opening' || J.state === 'canopy';
    {const b = skyd.body.group;b.visible = skyd.chase;b.position.set(J.pos.x, J.pos.y, J.pos.z);b.rotation.set(0, J.yaw, 0);if (J.state === 'freefall') {b.rotateX(-Math.PI / 2);b.translateY(-.9);}skyd.body.pose({stance: 'stand', speed: 0, dt});}
    if (skyd.canopy.visible) {const k = J.state === 'opening' ? Math.min(1, J.openT / 3) : 1;skyd.canopy.position.set(J.pos.x, J.pos.y + 1.2, J.pos.z);skyd.canopy.rotation.set(0, J.yaw, 0);skyd.canopy.scale.set(.3 + .7 * k, .3 + .7 * k, .3 + .7 * k);}
    if (ev === 'land') {
      const off = Math.hypot(J.pos.x - SKY_TARGET.x, J.pos.z - SKY_TARGET.z), rec = badges.record('skydive', {landing: J.landing, dist: off});
      const msg = {soft: 'Nice soft landing!', hard: 'Hard landing – flare a little earlier next time (S just before the ground).', crash: 'Ouch! You hit the ground hard (no flare).'}[J.landing];
      const aim = off < 400 && J.landing !== 'crash' ? ` ${off.toFixed(1)} m from the target${rec.best ? ' – your closest yet' : ''}.` : '';
      audio.sfx(J.landing === 'soft' ? 'thud' : 'hit', {gain: J.landing === 'soft' ? .3 : .7});notice(msg + aim, 5);
      skyd.canopy.visible = false;skyd.body.group.visible = false;const p = {x: J.pos.x, z: J.pos.z};skyd.jumper = null;player.mode = 'foot';
      const spn = collision.findSafeSpawn(walkWorld, p, player.eye, {y: groundAt(p.x, p.z), maxDistance: 8});place(spn ? spn.x : p.x, spn ? spn.z : p.z, J.yaw, spn ? spn.y : undefined);setClip(.05, 450);return;
    }
    // Camera: your eyes (looking ahead and down in freefall, ahead under the canopy), or behind you (R3 / V).
    player.lookYaw = Math.max(-2.4, Math.min(2.4, (player.lookYaw || 0) - input.mouse.dx * .0024 * sensitivity.mouse - input.look.x * 2 * sensitivity.pad * dt));
    player.lookPitch = Math.max(-1.4, Math.min(.8, (player.lookPitch || 0) - input.mouse.dy * .0024 * sensitivity.mouse - input.look.y * 1.5 * sensitivity.pad * dt));
    const head = new T.Vector3(J.pos.x, J.pos.y + (J.state === 'freefall' ? .3 : 1.6), J.pos.z), base = J.state === 'freefall' ? -.7 : -.15;
    if (skyd.chase) {
      const f = {x: -Math.sin(J.yaw), z: -Math.cos(J.yaw)}, want = new T.Vector3(J.pos.x - f.x * 9, J.pos.y + 4, J.pos.z - f.z * 9);
      const p = skyd.chaseCam ? skyd.chaseCam.lerp(want, .15) : want;skyd.chaseCam = p;camera.position.copy(p);camera.lookAt(J.pos.x, J.pos.y + 1, J.pos.z);
    } else {camera.position.copy(head);camera.rotation.order = 'YXZ';camera.rotation.set(base + player.lookPitch, J.yaw + player.lookYaw, 0);}
    if (camera.fov !== 75) {camera.fov = 75;camera.updateProjectionMatrix();}
    setClip(agl > 800 ? .4 : .12, Math.min(9000, Math.max(1600, agl * 2.5 + 1200)));
    player.x = J.pos.x;player.z = J.pos.z;player.feet = J.pos.y;player.yaw = J.yaw;
    const down = Math.max(0, -J.vel.y), sp = $('speedo');sp.hidden = false;sp.classList.add('air');
    sp.textContent = J.state === 'freefall' ? `FREEFALL · ${Math.round(agl)} m · ${Math.round(down)} m/s down · ${agl > 1100 ? 'pull (✕) at about 1000 m' : '✕ / Space: PULL!'}`
      : J.state === 'opening' ? `Opening… · ${Math.round(agl)} m` : `CANOPY · ${Math.round(agl)} m · ${down.toFixed(1)} m/s down · ${Math.hypot(J.vel.x, J.vel.z).toFixed(0)} m/s across · A/D steer · S flare`;
  }
  // Other players skydiving: belly-down in freefall, upright under their canopy.
  const remoteCanopies = new Map();
  function skyPose(r, st, g) {
    let c = remoteCanopies.get(r.id);
    if (st.sky === 'f') {g.rotateX(-Math.PI / 2);g.translateY(-.9);}
    if (st.sky === 'c') {if (!c) {c = SKY.canopy(T, window.GameAvatars.create({T, lib}).SLOT_COLORS[(r.slot || 0) % 12]);remoteCanopies.set(r.id, c);scene.add(c);}c.visible = true;c.position.set(r.pos.x, r.pos.y + 1.2, r.pos.z);c.rotation.set(0, r.yaw, 0);}
    else if (c) c.visible = false;
  }
  // ---------- The game's pilot in the Caravan (1 Nov 2026, the user's wish) ----------
  // Called from a jump seat (△), or handed the controls by the player flying it (△; ✕ above 300 m hands over and jumps at
  // once). The computer that calls it holds the Caravan's driver seat for the pilot and sends the plane's position, as a
  // player flying it would; everybody sees a pilot in the left seat. If the plane has no pilot in the air, a jumper's
  // computer takes over. With nobody aboard it is called off on the ground, or flies home after 30 s in the air.
  let gp = null, noPilotT = 0, pilotAv = null;
  const caravanIndex = () => vehicles.indexOf(caravan), meAboard = () => player.mode === 'jumpseat' && !!skyd.ride && skyd.ride.craft === caravan;
  function remotesAboard() {let n = 0;for (const r of mp.remotes.values()) {const st = r.st;if (st && st.v === caravanIndex() && (st.s === 'p' || /^j/.test(st.s || ''))) n++;}return n;}
  function remotePilot() {const d = mp.occupant(caravanIndex(), 'd');if (!d || d === mp.net.you) return null;const r = mp.remotes.get(d);return r && r.st && r.st.gp ? r : null;}
  const gamePilotFlies = () => !!gp || !!remotePilot();
  const driverName = i => i === caravanIndex() && gamePilotFlies() ? "the game's pilot" : mp.nameOf(mp.occupant(i, 'd'));
  function startGamePilot() {
    const c = caravan, now = skyClock();c.active = false;c.broken = false;
    if (!c.grounded) {
      const e = new T.Euler().setFromQuaternion(c.q, 'YXZ');
      gp = {G: SKY.pilotOrbit({t0: now, pos: {x: c.pos.x, y: c.pos.y, z: c.pos.z}, yaw: e.y, pitch: e.x, roll: e.z, speed: c.speed, vy: c.vel.y, toward: {x: 0, z: 0}, ground: heightAt})};
    } else {
      // It taxis from where it stands if the hold point is a short way ahead; anywhere else it is first brought back to its place.
      const H = CARAVAN_HOLD, f = c.forward(), dist = Math.hypot(H.x - c.pos.x, H.z - c.pos.z), ahead = (H.x - c.pos.x) * f.x + (H.z - c.pos.z) * f.z;
      const turn = Math.abs(Math.atan2(Math.sin(c.yaw - H.yaw), Math.cos(c.yaw - H.yaw))), atHold = dist < 3 && turn < .35;
      if (!atHold && !(dist < 60 && ahead > 5 && turn < 1.75)) {c.reset();notice('The pilot brought the Caravan back to its place at the airstrip.', 3);}
      gp = {G: SKY.pilotGround({t0: now, from: atHold ? H : {x: c.pos.x, z: c.pos.z, yaw: c.yaw}, hold: H, ground: heightAt, gearH: c.gearH})};
    }
    gp.empty = 0;gp.f = SKY.pilotFlight(now, gp.G);
  }
  // home: the pilot flies it back to its place (it reappears there); else it stops where it is.
  function stopGamePilot(home) {
    const c = caravan;gp = null;if (home) c.reset();else c.vel.set(0, 0, 0);c.throttle = 0;
    mp.release(caravanIndex(), 'd', c.netGet());
  }
  // Before this computer takes another seat: with jumpers aboard their computer takes over, else the pilot flies home.
  function leaveGamePilot() {if (!gp) return;if (remotesAboard()) gp = null;else stopGamePilot(!caravan.grounded);}
  function callGamePilot() {
    const i = caravanIndex(), d = mp.occupant(i, 'd');
    if (gamePilotFlies()) {notice("The game's pilot is already flying.", 2);return;}
    if (d && d !== mp.net.you) {notice(`${mp.nameOf(d)} is flying the Caravan.`, 3);return;}
    if (!caravan.grounded) return;// in the air the pilot takes over by itself
    mp.claim(i, 'd').then(r => {
      if (!meAboard() || gp) {if (r.ok && !gp) mp.release(i, 'd');return;}
      if (r.ok) {startGamePilot();notice("The game's pilot takes off in 10 s (others can still board) and climbs to 3000 m. Jump with ✕ / Space above 300 m – best at the green light.", 7);}
      else notice(r.timeout ? 'No answer from the lobby – try again.' : `${mp.nameOf(r.by)} just took the controls.`, 3);
    });
  }
  // The player flying the Caravan hands it to the game's pilot and goes back to the jump seats (△), or jumps at once (✕).
  function handOver(jumpNow) {
    const c = caravan;c.exit();player.mode = 'jumpseat';player.vehicle = null;player.chase = false;player.lookYaw = 0;player.lookPitch = 0;
    skyd.ride = {craft: c, auto: false, seat: mySeat()};for (const [, w] of vehicleWorlds) collision.setDynamic(w, []);updateDynamic();
    startGamePilot();
    if (jumpNow) jump();
    else notice(c.grounded ? "The game's pilot takes the controls and takes off in 10 s. You are in the back: jump with ✕ / Space above 300 m." : "The game's pilot takes the controls and circles. You are in the back: ✕ / Space jumps.", 6);
  }
  function updateGamePilot(dt) {
    const c = caravan, i = caravanIndex();
    if (gp && mp.net.online && mp.occupant(i, 'd') !== mp.net.you) gp = null;// the lobby gave the seat away (we took another one, or reconnected)
    // A jumper in the air with no pilot (the player flying it, or the computer flying the game's pilot, left): take over.
    if (!gp && meAboard() && !c.grounded && mp.net.online && !mp.occupant(i, 'd')) {
      if ((noPilotT += dt) > 1.5) {noPilotT = -3;mp.claim(i, 'd').then(r => {if (r.ok && meAboard() && !gp) {startGamePilot();notice("The plane had no pilot – the game's pilot took over.", 4);}});}
    } else if (noPilotT > 0) noPilotT = 0;
    if (!gp) return;
    const f = gp.f = SKY.pilotFlight(skyClock(), gp.G);
    if (f.phase === 'done') {stopGamePilot(true);if (meAboard()) notice('The pilot landed back at the airstrip.', 4);return;}
    c.pos.set(f.x, f.y, f.z);c.q.setFromEuler(new T.Euler(f.pitch, f.yaw, f.roll, 'YXZ'));c.vel.set(0, 0, -1).applyQuaternion(c.q).multiplyScalar(f.speed);
    const onGround = ['wait', 'taxi', 'hold', 'roll'].includes(f.phase);c.grounded = onGround;
    c.throttle = f.phase === 'roll' || f.phase === 'climb' || f.phase === 'orbit' ? 1 : f.phase === 'run' ? .6 : f.phase === 'away' ? .3 : .08;
    c.prop = f.phase === 'wait' || f.phase === 'hold' ? 900 : f.phase === 'taxi' ? 1200 : 2600;c.spin(dt);c.place();
    // Nobody aboard: on the ground it is called off once it stands still; in the air the pilot flies home after 30 s.
    if (meAboard() || remotesAboard()) gp.empty = 0;
    else if ((gp.empty += dt) > (onGround ? (f.speed < .5 ? 1 : Infinity) : 30)) stopGamePilot(!onGround);
  }
  // The pilot in the left seat, on every screen.
  function updatePilotAvatar(dt) {
    const show = gamePilotFlies() && caravan.group.visible;
    if (show && !pilotAv) {pilotAv = window.GameAvatars.create({T, lib}).avatar(0, 'Pilot', 0xe9ecef);scene.add(pilotAv.group);}
    if (!pilotAv) return;pilotAv.group.visible = show;if (!show) return;
    caravan.group.updateWorldMatrix(true, false);pilotAv.group.position.copy(caravan.group.localToWorld(caravan.hipAnchor('d').pos.clone()));pilotAv.group.quaternion.copy(caravan.group.quaternion);
    pilotAv.pose({stance: 'sit', dt});pilotAv.update(dt, camera, false);
  }
  // What the game's pilot is doing (here, or as told by the computer that flies it).
  function pilotStatus() {
    if (gp && gp.f) return {ph: gp.f.phase, left: gp.f.left || 0, green: !!gp.f.green};
    const r = remotePilot();return r ? {ph: r.st.gp, left: r.st.gl || 0, green: !!r.st.gg} : null;
  }
  function pilotHud(agl, c) {
    const ps = pilotStatus(), m = Math.round(agl), mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`, jumpHint = canJump() ? '✕ / Space: JUMP' : 'you can jump above 300 m';
    if (!ps) return c.grounded && !mp.occupant(caravanIndex(), 'd') ? "Jumper in the Caravan · no pilot · △ / F: the game's pilot flies you up · □ get off" : `Jumper in the Caravan · ${m} m · ${jumpHint}`;
    if (ps.ph === 'wait') return `The game's pilot · taxis in ${mmss(ps.left)} (others can board) · □ get off`;
    if (ps.ph === 'taxi') return "The game's pilot · taxiing onto the strip";
    if (ps.ph === 'hold') return `The game's pilot · holding: the jump flight ahead is on the strip · ${mmss(ps.left)} · □ get off`;
    if (ps.ph === 'roll') return "The game's pilot · take-off";
    if (ps.green) return `GREEN LIGHT · ${m} m · ✕ / Space: JUMP`;
    return `The game's pilot · ${ps.ph === 'run' ? 'jump run, door open' : ps.ph === 'orbit' ? 'circling' : ps.ph === 'away' ? 'flying home' : 'climbing (sped up)'} · ${m} m · ${jumpHint}`;
  }
  let gear = null, gearLast = 0;
  function showGear(sel) {const m = $('gearMenu');m.hidden = sel === null;if (sel !== null) m.querySelectorAll('.gm-item').forEach(e => e.classList.toggle('sel', +e.dataset.i === sel));}
  function updatePassenger(dt, input, dl) {
    const v = player.vehicle;
    if (input.pressed.has('square') && Math.abs(v.speed) < 3 && (!v.aircraft || v.grounded)) {exitPassenger();return;}
    player.lookYaw = Math.max(-2.6, Math.min(2.6, (player.lookYaw || 0) - input.mouse.dx * .0024 * sensitivity.mouse - input.look.x * 2.2 * dt));player.lookPitch = Math.max(-1.2, Math.min(1, (player.lookPitch || 0) - input.mouse.dy * .0024 * sensitivity.mouse - input.look.y * 1.6 * dt));
    v.group.updateMatrixWorld(true);camera.position.copy(v.group.localToWorld(v.passengerEye.clone()));
    camera.quaternion.copy(v.group.getWorldQuaternion(new T.Quaternion())).multiply(new T.Quaternion().setFromEuler(new T.Euler(player.lookPitch - (v.kind === 'motorcycle' ? .1 : .05), player.lookYaw, 0, 'YXZ')));
    if (dl) camera.rotateZ(Math.sin(performance.now() / 1300) * .08 * dl);
    if (camera.fov !== 72) {camera.fov = 72;camera.updateProjectionMatrix();}
    player.x = v.x;player.z = v.z;player.feet = v.y;player.yaw = v.yaw + player.lookYaw;
    const kmh = Math.abs(v.speed) * 3.6, drv = mp.occupant(vehicles.indexOf(v), 'd');
    if (passengerEngine) {if (v.kind === 'helicopter') passengerEngine.set(v.rpm, .5);else if (v.kind === 'plane') passengerEngine.set(v.prop || 700, v.throttle || 0);else if (v.kind === 'motorcycle') passengerEngine.set(1300 + (kmh % 50) / 50 * 8500, drv ? .5 : 0);else passengerEngine.set(800 + (kmh * 38) % 3600, drv ? .4 : 0);}
    const sp = $('speedo');sp.hidden = false;sp.classList.toggle('air', !!v.aircraft);sp.textContent = `Passenger${drv ? ' · ' + driverName(vehicles.indexOf(v)) + (v.aircraft ? ' flying' : ' driving') : ''} · ${Math.round(kmh)} km/h${v.aircraft ? ` · alt ${Math.max(0, v.y - heightAt(v.x, v.z)).toFixed(0)} m` : ''}`;
  }
  function updateSit(dt, input, dl) {
    const sp = player.sitSpot;
    if (input.pressed.has('square') || input.pressed.has('cross')) {standUp();return;}
    if ((input.r2 > .6 || input.mouse.left) && !player.r2Held) {player.r2Held = true;drinkBeer();}if (input.r2 < .3 && !input.mouse.left) player.r2Held = false;
    const curve = v => Math.sign(v) * v * v;
    player.lookYaw = Math.max(-2, Math.min(2, (player.lookYaw || 0) - input.mouse.dx * .0024 * sensitivity.mouse - curve(input.look.x) * 2.2 * sensitivity.pad * dt));player.lookPitch = Math.max(-1.2, Math.min(1.1, (player.lookPitch || 0) - input.mouse.dy * .0024 * sensitivity.mouse - curve(input.look.y) * 1.6 * sensitivity.pad * dt));
    const sway = dl ? Math.sin(performance.now() / 1300) * .07 * dl : 0;
    camera.position.set(sp.x, sp.y + .78, sp.z);camera.rotation.order = 'YXZ';camera.rotation.set(player.lookPitch, sp.yaw + player.lookYaw, sway);
    if (camera.fov !== 70) {camera.fov = 70;camera.updateProjectionMatrix();}
    player.x = sp.x;player.z = sp.z;player.feet = sp.y - .47;player.yaw = sp.yaw + player.lookYaw;
  }
  // What other players see of us (sent ~10 times a second when someone else is in the lobby).
  function localState() {
    const r = v => Math.round(v * 100) / 100, q = v => Math.round(v * 1000) / 1000;
    const s = {p: [r(player.x), r(player.feet + (player.jumpY || 0)), r(player.z)], y: r(player.yaw), st: player.stance, b: beerT > 0 ? 1 : 0};
    if ((player.mode === 'vehicle' || player.mode === 'passenger') && player.vehicle) {s.v = vehicles.indexOf(player.vehicle);s.s = player.mode === 'vehicle' ? 'd' : 'p';}
    if (player.mode === 'sit' && player.sitSpot) {const sp = player.sitSpot;s.sit = sp.id + 1;s.p = [r(sp.x), r(sp.y), r(sp.z)];s.y = r(sp.yaw);}
    if (player.mode === 'drone') {s.st = 'drone';s.dr = [...drone.pos.toArray().map(r), ...drone.q.toArray().map(q)];}
    if (player.mode === 'climb' && gym.climber.state !== 'off') {const c = gym.climber, ps = c.pose();s.p = [r(ps.feet.x), r(ps.feet.y), r(ps.feet.z)];s.y = r(ps.yaw);s.st = ps.hang ? 'hang' : 'climb';s.cr = c.route.id;}
    // Kayaking (issue #45): sitting in a kayak on Akerselva; running (the librarian in Deichman shushes runners, issue #47).
    if (player.mode === 'kayak' && kayak && kayak.pose) {const k = kayak.pose;s.st = 'sit';s.p = [r(k.x), r(k.y + .28), r(k.z)];s.y = r(k.yaw);s.ky = [r(k.x), r(k.y), r(k.z), r(k.yaw)];}
    if (player.running) s.rn = 1;
    if (magic.orb) s.mg = 1;// the light orb (issue #65): others see it by your shoulder
    // Skydiving: a jump seat in the flown Caravan (a vehicle seat 'j0'..'j11'), in the scheduled flight (ja), or in the air.
    if (player.mode === 'jumpseat' && skyd.ride) {if (skyd.ride.auto) s.ja = skyd.ride.seat;else {s.v = vehicles.indexOf(caravan);s.s = 'j' + skyd.ride.seat;}}
    if (player.mode === 'skydive' && skyd.jumper) {const J = skyd.jumper;s.p = [r(J.pos.x), r(J.pos.y), r(J.pos.z)];s.y = r(J.yaw);s.sky = J.state === 'freefall' ? 'f' : 'c';}
    // This computer flies the game's pilot in the Caravan: what it is doing, for the jumpers' screens.
    if (gp && gp.f) {s.gp = gp.f.phase;if (gp.f.left) s.gl = Math.round(gp.f.left);if (gp.f.green) s.gg = 1;}
    const pb = paintball && paintball.rules.localState();if (pb) s.pb = pb;
    // A city bike you have locked outside a dock (issue #57); your job, the taxi light and passenger (issue #56).
    if (rentals) {const lb = rentals.locked();if (lb >= 0) s.cb = lb;}
    {const js = jobs.localState();if (js) Object.assign(s, js);}
    return s;
  }
  // ---------- Chat ----------
  const chatLog = $('chatLog'), chatInput = $('chatInput'), QUICK = ['Hei! 👋', 'Skål! 🍺', 'Kom til bålet 🔥', 'Følg meg!', 'Hopp på!', 'Vent litt', 'Haha 😂', 'Ha det!', '⌨ Type a message…'];
  let quick = null;
  function chatLine(m, mine, old) {
    const row = document.createElement('div');row.className = 'line' + (m.sys ? ' sys' : '');
    const who = document.createElement('b');who.textContent = (m.name || 'Player') + (m.sys ? ' ' : ': ');who.style.color = window.GameAvatars.slotCss(m.slot || 0);
    const txt = document.createElement('span');txt.textContent = m.text;row.append(who, txt);chatLog.append(row);while (chatLog.children.length > 30) chatLog.firstChild.remove();
    row.dataset.t = old ? 0 : performance.now();chatLog.classList.add('recent');clearTimeout(chatLine.t);chatLine.t = setTimeout(() => chatLog.classList.remove('recent'), 12000);
    if (!mine && !old && !m.sys) audio.sfx('beep', {gain: .4});
  }
  function openChat() {chatInput.hidden = false;chatLog.classList.add('open');chatInput.value = '';setTimeout(() => chatInput.focus(), 0);if (document.pointerLockElement) document.exitPointerLock();}
  function closeChat() {chatInput.hidden = true;chatLog.classList.remove('open');chatInput.blur();if (started && !paused) lockPointer();}
  chatInput.addEventListener('keydown', e => {e.stopPropagation();if (e.code === 'Enter') {const t = chatInput.value.trim();if (t) {if (!mp.sendChat(t) && !mp.net.online) notice('You are offline – only you can see that.', 3);}closeChat();} else if (e.code === 'Escape') closeChat();});
  function renderQuick() {
    const el = $('quickChat');el.hidden = !quick;if (!quick) return;
    el.innerHTML = '<b>Quick chat</b>' + QUICK.map((q, i) => `<div class="${i === quick.sel ? 'sel' : ''}">${q}</div>`).join('') + '<small>↑↓ choose · ✕ send · ○ close</small>';
  }
  function quickInput(input) {
    const y = input.move.y;let moved = false;
    if (input.pressed.has('up') || (y < -.5 && !quick.stick)) {quick.sel = (quick.sel + QUICK.length - 1) % QUICK.length;moved = true;}
    if (input.pressed.has('down') || (y > .5 && !quick.stick)) {quick.sel = (quick.sel + 1) % QUICK.length;moved = true;}
    quick.stick = Math.abs(y) > .5;
    if (input.pressed.has('cross')) {const i = quick.sel;quick = null;if (i === QUICK.length - 1) openChat();else if (!mp.sendChat(QUICK[i]) && !mp.net.online) notice('You are offline – nobody else can hear you.', 3);}
    else if (input.pressed.has('circle')) quick = null;
    renderQuick();
    // The menu owns the sticks and buttons while it is open.
    input.move.x = input.move.y = 0;['cross', 'circle', 'up', 'down', 'square', 'triangle'].forEach(b => input.pressed.delete(b));void moved;
  }
  // ---------- Lobby (pause menu) ----------
  let codePad = null;
  function renderMp() {
    const n = mp.net, el = $('mpStatus');if (!el) return;
    el.textContent = n.online ? `Online · lobby ${n.code} · ${n.players.size}/${n.max} players` : n.status === 'connecting' ? `Connecting to lobby ${n.code || ''}…` : n.status === 'full' ? `That lobby is full (${n.max} players).` : 'Offline – single player (no connection to the lobby server).';
    $('mpOwnCode').textContent = n.ownCode;$('mpHome').hidden = !n.code || n.code === n.ownCode;
    $('mpWhere').textContent = n.code && n.code !== n.ownCode ? `You are in lobby ${n.code}.` : 'You are in your own lobby – friends join with your code.';
    $('mpLink').textContent = `${location.protocol === 'https:' ? location.origin : 'https://' + n.base.replace(/^wss?:\/\//, '')}/?lobby=${n.code || n.ownCode}`;
    $('mpPlayers').innerHTML = [...n.players.values()].sort((a, b) => a.slot - b.slot).map(p => `<li><i style="background:${window.GameAvatars.slotCss(p.slot)}"></i>${p.name.replace(/[<>&]/g, '')}${p.id === n.you ? ' (you)' : ''}${p.mic ? ' 🎙' : ''}</li>`).join('');
    if (document.activeElement !== $('mpName')) $('mpName').value = n.name;$('mpMic').checked = mp.voice.mic;
    const pad = $('codePad');pad.hidden = !codePad;if (codePad) pad.innerHTML = '<b>Join lobby</b><div class="slots">' + codePad.chars.map((c, i) => `<span class="${i === codePad.pos ? 'sel' : ''}">${c}</span>`).join('') + '</div><small>←→ move · ↑↓ change · ✕ join · ○ cancel</small>';
  }
  function openCodePad() {codePad = {chars: (mp.net.code && mp.net.code !== mp.net.ownCode ? mp.net.code : 'AAAA').split(''), pos: 0};renderMp();}
  function codePadInput(input) {
    const A = window.GameNet.ALPHABET, c = codePad;
    if (input.pressed.has('left')) c.pos = (c.pos + 3) % 4;if (input.pressed.has('right')) c.pos = (c.pos + 1) % 4;
    const step = input.pressed.has('up') ? 1 : input.pressed.has('down') ? -1 : 0;if (step) c.chars[c.pos] = A[(A.indexOf(c.chars[c.pos]) + step + A.length) % A.length];
    if (input.pressed.has('cross')) {const code = c.chars.join('');codePad = null;if (mp.net.connect(code)) notice(`Joining lobby ${code}…`, 3);}
    if (input.pressed.has('circle')) codePad = null;
    renderMp();
  }
  $('mpJoin').onclick = () => {const c = $('mpJoinCode').value.toUpperCase().trim();if (!mp.net.connect(c)) notice('A lobby code is 4 letters/digits (no O, 0, I or 1).', 4);else notice(`Joining lobby ${c}…`, 3);};
  $('mpJoinCode').addEventListener('keydown', e => {if (e.code === 'Enter') $('mpJoin').click();});
  $('mpHome').onclick = () => {mp.net.home();notice('Back in your own lobby.', 3);};
  $('mpName').onchange = e => {mp.net.setName(e.target.value);renderMp();};
  $('mpMic').onchange = async e => {const ok = await mp.setMic(e.target.checked);if (!ok && e.target.checked) notice('The microphone could not be opened (permission denied or no microphone).', 5);renderMp();};
  // ---------- Account (pause menu, optional): email + password through the Worker (Better Auth + Supabase) ----------
  let acctMode = 'login';
  const account = window.GameAccount.create({onChange: renderAccount});
  // Saved progress (issue #54): logged in, your progress is the account's – loaded when you log in and saved by itself.
  const safeStore = {getItem: k => {try {return localStorage.getItem(k);} catch {return null;}}, setItem: (k, v) => {try {localStorage.setItem(k, v);} catch {}}, removeItem: k => {try {localStorage.removeItem(k);} catch {}}};
  const progress = window.GameProgress.create({account, store: safeStore, camera: photo, ask, notice, rules: {...badges.MERGE, ...(window.GameStorgata ? window.GameStorgata.MERGE : {})},
    onApplied: () => window.dispatchEvent(new Event('haarklous-progress'))});
  window.addEventListener('haarklous-progress', () => {loadSens();badges.reload();renderSettings();});
  // A yes / no question over everything (✕ / ○ on the controller, or the buttons).
  let asking = null;
  function ask(text) {
    return new Promise(resolve => {asking = resolve;$('askText').textContent = text;$('askBox').hidden = false;if (document.pointerLockElement === canvas) document.exitPointerLock();});
  }
  function answer(yes) {const r = asking;asking = null;$('askBox').hidden = true;if (started && !paused) lockPointer();if (r) r(yes);}
  $('askYes').onclick = () => answer(true);$('askNo').onclick = () => answer(false);
  function renderAccount() {
    const u = account.user, signup = acctMode === 'signup';
    $('acctStatus').textContent = !account.available ? `Accounts work in the online version (${account.onlineUrl}) – you can play without one.` :
      u ? `Logged in as ${u.name} (${u.email}). Your account name is your name in the lobbies, and your progress (money, bag, photos, badges, best scores, settings) is saved to the account.` : signup ? 'Create an account: player name, email and a password of at least 8 characters.' : 'You are not logged in – you can play without an account.';
    $('acctForm').hidden = !account.available || !!u;$('acctIn').hidden = !u;
    $('acctNameRow').hidden = !signup;$('acctPassword').autocomplete = signup ? 'new-password' : 'current-password';
    $('acctSubmit').textContent = account.busy ? 'Wait…' : signup ? 'Create account' : 'Log in';
    $('acctMode').textContent = signup ? 'I have an account – log in' : 'New here? Create an account';
    $('acctSubmit').disabled = $('acctLogout').disabled = account.busy;
  }
  // The account name is the lobby name while you are logged in.
  const acctDone = err => {$('acctError').textContent = err;if (!err) {$('acctPassword').value = '';if (account.user) {mp.net.setName(account.user.name);renderMp();}progress.userChanged(account.user);}renderAccount();};
  $('acctMode').onclick = () => {acctMode = acctMode === 'signup' ? 'login' : 'signup';if (!$('acctName').value) $('acctName').value = mp.net.name;$('acctError').textContent = '';renderAccount();};
  $('acctForm').onsubmit = async e => {
    e.preventDefault();const email = $('acctEmail').value, pw = $('acctPassword').value;
    const err = acctMode === 'signup' ? await account.signUp($('acctName').value, email, pw) : await account.logIn(email, pw);
    acctDone(err);if (!err) notice(`Logged in as ${account.user.name}.`, 3);
  };
  // Save once more while the session is still valid; then this browser's own progress comes back.
  $('acctLogout').onclick = async () => {await progress.beforeLogout();const err = await account.logOut();acctDone(err);if (!err) notice('Logged out. This browser’s own progress is back.', 4);};
  renderAccount();if (account.available) account.load().then(acctDone);
  function applyDoor(id, open, instant) {
    const d = doors.find(x => x.id === id);if (!d) return;
    if (instant) {d.anim = null;d.open = open;setDoor(d, open ? 1 : 0);updateDynamic();return;}
    if (d.open === open || d.anim) return;d.anim = {from: d.open ? 1 : 0, to: open ? 1 : 0, t: 0};
    const p = d.leaf.getWorldPosition(new T.Vector3()), dist = Math.hypot(p.x - player.x, p.z - player.z);if (dist < 25) audio.sfx(open ? 'doorOpen' : 'doorClose', {gain: Math.max(.1, 1 - dist / 25)});
  }
  mp = window.GameMultiplayer.create({T, lib, scene, camera, vehicles, fireDecayS: fire.DECAY_S, fireMax: fire.MAX, localState, notice,
    drivingIndex: () => player.mode === 'vehicle' && player.vehicle ? vehicles.indexOf(player.vehicle) : gp ? caravanIndex() : -1,
    listener: () => ({x: player.x, y: player.feet + 1.5, z: player.z}), applyDoor, onChat: chatLine, onStatus: () => {renderMp();onLobbyChange();},
    onRemoteWood: r => fire.throwLog({x: r.pos.x, y: r.pos.y + 1.3, z: r.pos.z}), holdsMarker: id => !!paintball && paintball.rules.memberPlaying(id),
    autoAnchor: seat => autoPlane.hipAnchor('j' + seat), skyPose: (r, st, g) => {skyPose(r, st, g);kayakPose(r, st, g);orbPose(r, st, g);},
    // In a paintball game you see your team-mates' names, not your opponents' (issue #25).
    showTag: id => !paintball || !paintball.rules.inGame() || !paintball.rules.memberPlaying(id) || paintball.rules.teamOfMember(id) === paintball.rules.myTeam()});
  // A new lobby: vehicles go back to where everybody else has them (the lobby then sends the ones that were moved).
  let lastLobby = null;
  function onLobbyChange() {
    const n = mp.net;if (!n.online || n.code === lastLobby) return;lastLobby = n.code;gp = null;// the game's pilot stays in the old lobby
    if (rentals && rentals.trip && rentals.trip.locked) rentals.end('lobby');// the locked city bike goes back to its dock in the new lobby
    vehicles.forEach((v, i) => {if (v === player.vehicle) {mp.claim(i, player.mode === 'vehicle' ? 'd' : 'p');return;}v.netSet(v.spawn);if (v.aircraft) v.reset();});
  }
  function updateMinigame(dt, input, dl) {
    const g = player.minigame, mouseScale = .0024 * sensitivity.mouse, curve = v => Math.sign(v) * v * v, walking = g.walk != null;
    // Disc golf between holes (issue #60): you walk to the next tee; R2 (run) must be let go before it charges a throw there.
    if (walking) g.r2Wait = true;else if (input.r2 < .3) g.r2Wait = false;
    if (!walking) {player.yaw -= input.mouse.dx * mouseScale + curve(input.look.x) * 2 * sensitivity.pad * dt;player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - input.mouse.dy * mouseScale - curve(input.look.y) * 1.4 * sensitivity.pad * dt));}
    const holding = input.r2 > .5 && !walking && !g.r2Wait;if (holding) g.charge = Math.min(1, (g.charge || 0) + dt / 1.2);
    const release = !holding && (g.charge || 0) > 0, power = g.charge || 0;if (release) g.charge = 0;
    const r = g.update(dt * worldScale(), {aimYaw: player.yaw + (dl ? Math.sin(performance.now() / 600) * .05 * dl : 0), aimPitch: player.pitch, charge: g.charge || 0, power, release, alt: input.l2 > .5, hyzer: input.move.x, cancel: input.pressed.has('circle'), drunk: dl, at: {x: player.x, z: player.z, y: player.feet}, skip: walking && input.pressed.has('square')}, camera) || {};
    if (r.walk) {input.pressed.delete('square');input.pressed.delete('circle');updateFoot(dt, input, dl);return;}
    if (r.teleport) place(r.teleport.x, r.teleport.z, r.teleport.yaw);
    if (r.stand) {player.x = r.stand.x;player.z = r.stand.z;player.feet = r.stand.y ?? heightAt(player.x, player.z);}
    if (r.face !== undefined) {player.yaw = r.face;player.pitch = -.12;}
    if (r.done) {notice(r.done, 6);player.mode = 'foot';player.minigame = null;}
    if (r.camera) {camera.position.set(r.camera.x, r.camera.y, r.camera.z);camera.lookAt(r.camera.lookAt);}
    else {camera.position.set(player.x, player.feet + player.eye, player.z);camera.rotation.order = 'YXZ';camera.rotation.set(player.pitch, player.yaw, 0);}
  }
  // ---------- Catacomb (issue #43) ----------
  // Underground the map shows only what you have seen down there; L1 / Q is your torch. Deep down (off the stairs) the world
  // above, the far scene and the sun's shadows are not drawn, and the sun and sky are dimmed for anything not made for the dark.
  let deepNow = false, deepSaved = null;
  function catacombTick(dt, input) {
    const st = catacomb.update(dt, {camera, player}), layer = st.inside ? catacomb.mapLayer : null;
    // The tunnels are 2 m wide, so the map zooms in down here and back out above.
    if (map.layer !== layer) {map.layer = layer;if (layer) {map.surfaceScale = map.scale;map.scale = Math.max(map.scale, 6);notice('The catacombs. Your map is blank down here – it fills in with what you see.', 5);} else if (map.surfaceScale) map.scale = map.surfaceScale;}
    if (input.pressed.has('l1') && st.inside && player.mode === 'foot') notice(catacomb.toggleLamp() ? 'Torch on · L1 / Q switches it off' : 'Torch off', 2);
    const deep = st.camDeep;
    if (deep) {
      if (!deepSaved) deepSaved = {fog: scene.fog.color.clone()};
      if (sun.intensity > 0) {deepSaved.sun = sun.intensity;deepSaved.sky = sky.intensity;sun.intensity = 0;sky.intensity = deepSaved.sky * .15;}
      scene.fog.color.setHex(0x0a0807);scene.fog.density = .045;
    } else if (deepSaved) {
      if (deepSaved.sun !== undefined) {sun.intensity = deepSaved.sun;sky.intensity = deepSaved.sky;}
      scene.fog.color.copy(deepSaved.fog);deepSaved = null;applyNearFog();if (weather.state) applyWeather(weather.state);
    }
    // Eyes get used to the dark: more exposure deep down.
    if (deep !== deepNow) {deepNow = deep;world.near.visible = !deep;renderer.shadowMap.autoUpdate = !deep;renderer.shadowMap.needsUpdate = true;renderer.toneMappingExposure = deep ? 1.6 : 1.05;}
  }
  let weatherIndoor = false;
  function updateAmbience() {
    const inApt = inFlat(), tw = towerAt(player.x, player.z, player.feet), under = catacomb?.state.depth > .3, indoor = inApt || tw || under || shops.shopAt(player, player.feet) || (library && library.inside(player.x, player.z, player.feet)) || gym.zoneAt(player, player.feet) ? 1 : player.mode === 'jumpseat' ? .6 : player.vehicle && player.vehicle.kind === 'car' ? .7 : player.vehicle && player.vehicle.aircraft ? .4 : 0;
    weatherIndoor = indoor >= 1 && player.mode !== 'drone';
    const skyAir = player.mode === 'skydive' && skyd.jumper ? Math.hypot(skyd.jumper.vel.x, skyd.jumper.vel.y, skyd.jumper.vel.z) : 0;const ws = weather.state, wet = ws && ['rain', 'sleet', 'snow'].includes(ws.kind) ? ws.intensity : 0;
    audio.ambience({indoor, rain: ws && ws.kind === 'rain' ? wet : ws && ws.kind === 'sleet' ? wet * .6 : 0, windSpeed: Math.max(ws ? ws.wind : 4, skyAir), green: world.greenery(player.x, player.z), traffic: world.trafficDistance(player.x, player.z), height: Math.max(0, player.feet - heightAt(player.x, player.z)) + (inApt ? 10 : 0), stair: Boolean(tw) || under, kitchen: inApt && roomAt() === 'kitchen'});
    // Stair-tower light follows the player into whichever stairwell they are in.
    if (tw) {const l = tw.t.stair.lampAt({x: tw.l.x, z: tw.l.z}, player.feet - tw.t.matrix.elements[13]);if (l) {const p = new T.Vector3(l.x, l.y, l.z).applyMatrix4(tw.t.matrix);towerLamp.position.copy(p);towerLamp.intensity = 5.5;}} else towerLamp.intensity = 0;
    if (!['vehicle', 'passenger', 'jumpseat', 'skydive', 'kayak'].includes(player.mode)) $('speedo').hidden = true;
    const dl = drunkLevel();$('drunk').hidden = !dl;if (dl) $('drunk').textContent = `Drunk · ${Math.ceil(drunk)} s`;
  }

  // ---------- Rendering ----------
  const ghost = $('ghost'), gctx = ghost.getContext('2d');
  function renderFrame(dt, t, forPhoto = false) {
    // Sun shadow frustum follows the player (wide outdoors, tight indoors for crisp shadows).
    const flying = player.mode === 'drone' || player.vehicle?.aircraft, indoor = !flying && (inApartment() || towerAt(player.x, player.z, player.feet) || !!gym.zoneAt(player, player.feet) || catacomb?.state.inside), reach = indoor ? 16 : 42;
    if (flying) {const c = camera.position;sun.target.position.set(c.x, Math.max(heightAt(c.x, c.z), c.y - 25), c.z);} else sun.target.position.set(player.x, player.feet, player.z);sun.position.copy(sun.target.position).addScaledVector(sunDir, indoor ? 45 : 110);sun.target.updateMatrixWorld();
    if (sun.shadow.camera.right !== reach) {Object.assign(sun.shadow.camera, {left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: indoor ? 100 : 240});sun.shadow.camera.updateProjectionMatrix();}
    camera.updateMatrixWorld();
    farCamera.fov = camera.fov;farCamera.aspect = camera.aspect;farCamera.position.copy(camera.position);farCamera.quaternion.copy(camera.quaternion);farCamera.updateProjectionMatrix();farCamera.updateMatrixWorld();
    renderer.autoClear = false;renderer.clear();if (!deepNow) renderer.render(farScene, farCamera);renderer.clearDepth();renderer.render(scene, camera);
    if (!forPhoto) {
      if (caseGame?.active) caseGame.renderOverlay(camera);
      else {const showWatch = watch.update(dt), showPhoto = photo.active && !photo.gallery;photo.model.visible = showPhoto;if (showPhoto || showWatch || paintball?.marker.visible) {renderer.clearDepth();renderer.render(overlayScene, overlayCamera);}}
    }
    renderer.autoClear = true;
    // Drunk: blur and a drifting double image.
    const dl = drunkLevel();
    const boostFilter = !boost ? '' : boost.kind === 'speed' ? ' saturate(1.35) contrast(1.06)' : boost.kind === 'jump' ? ' hue-rotate(-14deg) saturate(1.25)' : ' saturate(.35) contrast(1.15) brightness(.96)';
    canvas.style.filter = ((dl ? `blur(${(dl * 2.2).toFixed(2)}px) saturate(${1 + dl * .3})` : '') + boostFilter).trim();
    const fx = $('boostFx');fx.hidden = !boost;if (boost) fx.className = boost.kind;
    const bh = $('boost');bh.hidden = !boost;if (boost) bh.textContent = `${BOOSTS[boost.kind]} · ${Math.ceil(boost.t)} s`;
    ghost.hidden = !dl;
    if (dl) {ghost.width = canvas.width / 2;ghost.height = canvas.height / 2;gctx.globalAlpha = .35 * dl;const off = Math.sin(performance.now() / 650) * 12 * dl;gctx.drawImage(canvas, off, Math.cos(performance.now() / 900) * 4 * dl, ghost.width, ghost.height);}
  }

  // ---------- KIWI Storgata (issue #65): the regulars' quests, the finds and Sopp-Sigvald's magic ----------
  const SG = window.GameStorgata;
  // Even's photo of Grønland kirke: the tower (at the narrow end of the church, like game-landmarks draws it).
  const GRONLAND = (() => {
    const l = DISTRICTS.flatMap(d => d.landmarks).find(x => x.name === 'Grønland kirke');if (!l) return null;
    const a = l.tower.end * (l.L / 2 - l.tower.side), c = world.toWorld(l.c[0] + l.axis[0] * a, l.c[1] + l.axis[1] * a);
    return {id: 'gronland', name: 'Grønland kirke', size: 40, r: 8, maxDist: 170, at: {x: c.x, y: world.heightWorld(c.x, c.z) + l.top * .42, z: c.z}};
  })();
  // The finds and the bottles go on walkable ground (the walk world exists now).
  if (storgata) {
    const snap = (x, z, y, max = 6) => {const sp = collision.findSafeSpawn(walkWorld, {x, z}, 1.65, {y: y ?? groundAt(x, z), maxDistance: max});return sp ? {x: sp.x, y: sp.y, z: sp.z} : null;};
    const at = (x, s, y, max) => {const w = world.toWorld(x, s);return snap(w.x, w.z, y, max);};
    const pk = {}, marks = DISTRICTS.flatMap(d => d.landmarks);
    // Torshovdalen: west of HODET N.N., by the petanque court and by a disc golf basket.
    pk['dalen-1'] = at(SCULPTURE_AT.x - 14, SCULPTURE_AT.s - 6);
    if (D.petanque) pk['dalen-2'] = at(D.petanque.x + 9, D.petanque.s + 7);
    {const h = (D.discgolf || [])[1] || (D.discgolf || [])[0];if (h) pk['dalen-3'] = at(h.basket[0] + 5, h.basket[1] + 4);}
    // Akerselva: on the banks at Sagene, in Grünerløkka and above Vaterland (akerselva-data.js: 3 m beyond the water's edge).
    [[-1316.9, 1380.6], [-1167.7, 1886.3], [-922.3, 2309.3]].forEach(([x, s], i) => {pk[`elva-${i + 1}`] = at(x, s);});
    // The catacomb: beside the pillar of bones in the Rotunda.
    {const room = catacomb && catacomb.layout.rooms.find(r => r.id === 'rotunda');if (room) {const w = world.toWorld(room.cx + 2.2, room.cs);pk['bein-1'] = snap(w.x, w.z, catacomb.FLOOR_Y, 4);}}
    // MUNCH: the free spot round the building nearest the fjord (the southernmost one).
    {const l = marks.find(x => x.kind === 'munch');if (l) {const u = l.axis, n = [-u[1], u[0]], c = l.c, cand = [];for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {const d = a ? l.L / 2 + 4 : l.W / 2 + 4, x = c[0] + (u[0] * a + n[0] * b) * d, s = c[1] + (u[1] * a + n[1] * b) * d, q = at(x, s, undefined, 4);if (q) cand.push({q, s});}cand.sort((p, r) => r.s - p.s);if (cand.length) pk['mane-1'] = cand[0].q;}}
    // The Opera roof: just below the plateau, in front of the stage tower.
    {const l = marks.find(x => x.kind === 'opera'), roof = landmarks.floors.find(f => f.name === 'Opera roof');if (l && roof) {const a = -l.L * .2 + 4, w = world.toWorld(l.c[0] + l.axis[0] * a, l.c[1] + l.axis[1] * a);pk.harmonica = snap(w.x, w.z, roof.height(w), 3);}}
    // Empty bottles on the pavement either side of the shop and a little further along Storgata.
    const bottleSpots = [];
    for (const [a, o] of [[-15.6, 1.6], [-11, 2.6], [-6.4, 1.8], [-1.2, 2.9], [16.2, 2.4], [20.4, 1.7], [25.6, 2.8], [31.5, 1.9], [-20, 2.2], [36, 2.0], [8.5, 3.0], [-24, 1.5]]) {
      const [x, s] = storgata.along(a, o), w = world.toWorld(x, s), q = snap(w.x, w.z, undefined, 1.5);if (q) bottleSpots.push(q);
    }
    storgata.place({pickups: Object.fromEntries(Object.entries(pk).filter(([, v]) => v)), bottleSpots});
  }
  const storgataCtx = () => ({pant: wallet.pant, bag: wallet.bag});
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const POWER_HELP = {levitate: 'Hold R1 (keyboard: hold 1) to float up to 3 m; let go and you sink slowly.', blink: 'R1 (keyboard: 2) jumps you up to 8 m the way you look – not through walls.',
    gust: 'R1 (keyboard: 3) blows a gust ahead: it pushes a parked car, motorcycle or e-scooter and scares the pigeons.', orb: 'R1 (keyboard: 4) lights the light orb by your shoulder, and puts it out again.'};
  function storgataPrompt() {
    if (!storgata || player.mode !== 'foot' || caseGame?.active) return null;
    const pr = storgata.prompt(player, lookTarget());return pr ? {text: pr.text, act: () => storgataAct(pr.act)} : null;
  }
  function storgataAct(a) {
    if (a.talk) {watch.hide();if (photo.active) photo.toggle();magic.release('levitate');storgata.open(a.talk, storgataCtx());return;}
    if (a.bottle) {storgata.takeBottle(a.bottle);wallet.addPant(1);walletT = 5;audio.sfx('click');notice(`An empty bottle (+1 for the deposit, ${wallet.pant} now)${storgata.status('kjell') === 'active' ? ' · Kjell-Arne wants ten' : ''}`, 2.5);return;}
    if (a.pick) {
      const r = storgata.pick(a.pick);if (!r) return;const f = storgata.finds[a.pick], q = SG.QUESTS.find(x => x.id === r.quest);
      audio.sfx(r.pickup.kind === 'harmonica' ? 'harmonica' : 'mushroom');if (f) fx.burst({x: f.at.x, y: f.at.y + .3, z: f.at.z}, 0xffe38a, 40, 1.6);
      questWaypoint(r.quest);
      notice(r.ready ? `${cap(r.pickup.name.en)}${r.need > 1 ? ` – that is all ${r.need}` : ''}! Take ${r.need > 1 ? 'them' : 'it'} to ${SG.PEOPLE[q.who].name} outside Kiwi Storgata (the waypoint shows the way).` : `${cap(r.pickup.name.en)}: ${r.count} of ${r.need}. The waypoint shows the next one.`, 5);
    }
  }
  // Our own waypoint for a quest: the next thing to find, Rolf, the church, or back to the one who asked.
  function questWaypoint(id) {
    if (!storgata) return;let w = storgata.target(id, player);
    if (!w && id === 'even' && GRONLAND && storgata.status('even') === 'active') w = GRONLAND.at;
    if (!w) return false;const l = world.toLocal(w.x, w.z);map.waypoint = {x: l.x, s: l.s};questWp = map.waypoint;return true;
  }
  // What a choice in a conversation does to the rest of the game: waypoints, money, the bag, bottles, a new power.
  function storgataResult(r, who) {
    const P = SG.PEOPLE[who], msg = [];
    if (r.accepted) {const q = SG.QUESTS.find(x => x.id === r.accepted);audio.sfx('quest');const wp = storgata.status(q.id) === 'active' && questWaypoint(q.id);msg.push(`New task from ${P.name}: ${q.title.en} · ${storgata.goal(q.id, storgataCtx()).en}${wp ? ' · the waypoint shows the way' : ''}`);}
    if (r.delivered) {audio.sfx('quest');questWaypoint('mona');msg.push("Rolf has read Mona's note. Go back to Mona outside Kiwi Storgata.");}
    if (r.reward) {
      const rw = r.reward;
      if (rw.takePant) wallet.takePant(rw.takePant);
      (rw.takeItems || []).forEach(id => wallet.take(id));
      if (rw.item) wallet.add(rw.item);
      if (questWp && map.waypoint === questWp) map.waypoint = null;questWp = null;
      if (rw.kr) {wallet.earn(rw.kr);audio.sfx('coin');msg.push(`+${KR(rw.kr)} from ${P.name}`);}
      const item = rw.item ? shops.products.find(x => x.id === rw.item) : null;if (item) msg.push(`${P.name} gives you ${item.name} (in your bag: D-pad ↓)`);
      if (r.done === 'bente') audio.sfx('harmonica');if (r.done === 'tore') audio.sfx('bark');
      if (rw.teach) {magic.learn(rw.teach);const pw = window.GameMagic.byId(rw.teach);audio.sfx('learn');fx.burst({x: player.x, y: player.feet + 1, z: player.z}, pw.color, 90, 2.2);msg.push(`You learned ${pw.icon} ${pw.no} (${pw.en})! ${POWER_HELP[pw.id]} D-pad ← / ← chooses the power for R1 / X.`);}
      else if (SG.REGULARS.includes(r.done)) {audio.sfx('cheer');msg.push(`Storgata trusts you a little more (${storgata.trust} of 5) – Sopp-Sigvald on the corner has noticed.`);}
      walletT = 6;badges.check();
    }
    if (msg.length) notice(msg.join(' · '), 8);
  }
  let questT = 0, questHudKey = '';
  function storgataTick(dt) {
    if (!storgata) return;storgata.update(dt, player, camera);
    questT -= dt;if (questT > 0) return;questT = .3;
    const act = SG.QUESTS.filter(q => ['active', 'ready'].includes(storgata.status(q.id))), show = act.length && player.mode === 'foot' && !caseGame?.active && !pbBusy() && !storgata.talking;
    const html = show ? '<b>Storgata</b>' + act.slice(0, 3).map(q => `<div>${esc(q.title.en)}<small>${esc(storgata.goal(q.id, storgataCtx()).en)}</small></div>`).join('') + (act.length > 3 ? `<small>+ ${act.length - 3} more</small>` : '') : '';
    if (html !== questHudKey) {questHudKey = html;const el = $('questHud');el.innerHTML = html;el.hidden = !html;}
  }
  // ---- Magic (GameMagic): R1 / X casts the chosen power, D-pad ← / ← chooses, 1–4 cast one directly ----
  const POWER_KEYS = ['magic1', 'magic2', 'magic3', 'magic4'];
  const magicAllowed = () => player.mode === 'foot' && !caseGame?.active && !pbBusy() && !photo.active && !gear && !bag && !gymMenu && !jobs.phone.open && !quick && !map.open &&
    !(storgata && storgata.talking) && !(route && route.running) && !(library && library.reading);
  function magicTick(dt, input) {
    magicKick = Math.max(0, magicKick - dt * 4);pushTick(dt);
    if (!magic.known.size) {renderMagicHud(false);return;}
    for (const e of magic.tick(dt)) {if (e.id === 'levitate') notice('Out of mana – you sink slowly to the ground.', 2.5);if (e.id === 'orb') {fx.orb.on = false;audio.sfx('orbOff');notice('Out of mana – the light orb goes out.', 2.5);}}
    // The orb goes out in a vehicle, in the mission and at paintball; levitation stops whenever the powers are not allowed.
    if (magic.orb && (!['foot', 'sit'].includes(player.mode) || caseGame?.active || pbBusy())) {magic.orb = false;fx.orb.on = false;}
    const ok = magicAllowed();
    if (!ok) {
      magic.release('levitate');
      if (route && route.running && player.mode === 'foot' && (input.pressed.has('r1') || input.pressed.has('cast') || POWER_KEYS.some(k => input.pressed.has(k)))) notice('No magic during the timed run – that would be cheating!', 2);
      renderMagicHud(player.mode === 'foot' && !caseGame?.active && !pbBusy() && !(storgata && storgata.talking));return;
    }
    const direct = POWER_KEYS.find(k => input.pressed.has(k));
    if (input.pressed.has('left')) {const pw = window.GameMagic.byId(magic.select(1));audio.sfx('click');notice(`${pw.icon} ${pw.no} (${pw.en}) · R1 / X`, 1.5);}
    if (direct) {const pw = window.GameMagic.POWERS[POWER_KEYS.indexOf(direct)];if (magic.knows(pw.id)) {magic.sel = pw.id;castPower(pw.id);} else notice(`${pw.icon} ${pw.en}: not learned yet – Sopp-Sigvald in Storgata teaches it.`, 2.5);}
    else if (input.pressed.has('r1') || input.pressed.has('cast')) castPower(magic.selected);
    // Levitation lasts while its button is held.
    if (magic.levitating && !(input.held.magic1 || ((input.held.r1 || input.held.cast) && magic.selected === 'levitate'))) magic.release('levitate');
    renderMagicHud(true);
  }
  function castPower(id) {
    if (!id) return false;const pw = window.GameMagic.byId(id), r = magic.cast(id);
    if (!r.ok) {audio.sfx('noMana');notice(r.why === 'cooldown' ? `${pw.icon} ${pw.no} is not ready yet (${Math.ceil(magic.cool[id])} s)` : r.why === 'mana' ? `Not enough mana for ${pw.no} (${pw.cost} needed)` : `${pw.en}: not learned yet`, 1.5);return false;}
    if (id === 'levitate') {audio.sfx('levitate');player.floating = true;fx.burst({x: player.x, y: player.feet + .1, z: player.z}, pw.color, 26, 1.2);}
    else if (id === 'blink') doBlink(pw);
    else if (id === 'gust') doGust(pw);
    else if (id === 'orb') {fx.orb.on = r.on;if (r.on) fx.orb.pos.copy(camera.position);audio.sfx(r.on ? 'orbOn' : 'orbOff');}
    return true;
  }
  // Blink: straight ahead the way you face, up to 8 m, stopping where you could no longer stand (a wall, a drop, a closed door).
  function doBlink(pw) {
    const eye = stanceEye(player.stance), dir = {x: -Math.sin(player.yaw), z: -Math.cos(player.yaw)};
    const test = (p, y) => {const sp = collision.supportAt(walkWorld, p, y);return sp && collision.canStand(walkWorld, p, eye, sp.y) ? sp.y : null;};
    const t = window.GameMagic.blinkTarget({x: player.x, z: player.z, y: player.feet}, dir, pw.dist, test);
    if (t.d < .6) {magic.mana += pw.cost;magic.cool.blink = 0;audio.sfx('noMana');notice('Something is in the way – nowhere to blink to.', 2);return;}
    fx.burst({x: player.x, y: player.feet + player.jumpY + 1, z: player.z}, pw.color, 55, 2.4);
    player.x = t.x;player.z = t.z;player.feet = t.y;
    fx.burst({x: t.x, y: t.y + player.jumpY + 1, z: t.z}, pw.color, 55, 2.4);audio.sfx('blink');magicKick = 1;
    if (storgata) storgata.scare({x: t.x, z: t.z}, null, .8);
  }
  // Gust: wind streaks ahead, the pigeons fly off, and the nearest free parked car / motorcycle / e-scooter in the cone is pushed.
  // Online the pushed vehicle is claimed like a seat while it moves, and its final place goes to the lobby when it stops.
  const pushedList = [];let pushDynT = 0;
  function pushable(v, i) {
    if (!v.group.visible || v.aircraft || v.site || v.pushed || v === player.vehicle || !['car', 'motorcycle', 'scooter'].includes(v.kind)) return false;
    if (mp.occupant(i, 'd') || mp.occupant(i, 'p') || lockedByOthers().has(i)) return false;
    return Math.abs(v.y - player.feet) < 3;
  }
  function doGust(pw) {
    const dir = {x: -Math.sin(player.yaw), z: -Math.cos(player.yaw)};
    fx.wind({x: camera.position.x, y: camera.position.y - .35, z: camera.position.z}, dir);audio.sfx('gust');
    if (storgata) storgata.scare({x: player.x, z: player.z}, dir, 1.3);
    const free = vehicles.map((v, i) => ({x: v.x, z: v.z, v, i})).filter(c => pushable(c.v, c.i));
    const hit = window.GameMagic.gustTargets({x: player.x, z: player.z}, dir, free, pw.range, pw.cone)[0];
    if (hit) pushVehicle(hit.item.v, hit.item.i, dir, hit.k);
  }
  function pushVehicle(v, i, dir, k) {
    v.pushed = {i, vx: 0, vz: 0, spin: 0, t: 0};
    mp.claim(i, 'd').then(r => {
      if (!r.ok || player.mode !== 'foot') {v.pushed = null;if (r.ok) mp.release(i, 'd');return;}
      const s = (v.kind === 'car' ? 6 : 8) * k;Object.assign(v.pushed, {vx: dir.x * s, vz: dir.z * s, spin: (Math.random() - .5) * (v.kind === 'car' ? .8 : 2) * k});
      if (v.flies) v.vy = (v.kind === 'car' ? 2.2 : 2.8) * k;// a little hop as the gust catches it
      if (v.rental) v.rested = false;pushedList.push(v);updateDynamic();
    });
  }
  function pushTick(dt) {
    if (!pushedList.length) return;
    for (const v of [...pushedList]) {
      const p = v.pushed, f = Math.exp(-2.4 * dt), sp = Math.hypot(p.vx, p.vz);p.t += dt;p.vx *= f;p.vz *= f;p.spin *= f;
      if (sp > .02) {const nx = v.x + p.vx * dt, nz = v.z + p.vz * dt;if (v.clear(nx, nz)) {v.x = nx;v.z = nz;} else {if (sp > 2) audio.sfx('thud', {gain: .6});p.vx = p.vz = 0;}}
      v.yaw += p.spin * dt;if (v.rental) v.rested = false;
      if (p.t > 4 || player.mode !== 'foot' || (p.t > .6 && sp < .05 && !v.airborne)) {v.pushed = null;v.speed = 0;pushedList.splice(pushedList.indexOf(v), 1);v.place();mp.release(p.i, 'd', v.netGet());updateDynamic();}
    }
    pushDynT -= dt;if (pushDynT <= 0 && pushedList.length) {pushDynT = .25;updateDynamic();}
  }
  let magicHudKey = '';
  function renderMagicHud(show) {
    let html = '';
    if (show && magic.known.size) {
      const sel = window.GameMagic.byId(magic.selected);
      html = `<div class="mg-mana" title="Mana"><u style="width:${Math.round(magic.mana / 2) * 2}%"></u></div><div class="mg-row">` + window.GameMagic.POWERS.map(pw => {
        const k = magic.knows(pw.id), cd = magic.cool[pw.id] || 0, f = cd > 0 ? Math.round(Math.min(1, cd / pw.cd) * 20) * 5 : 0, on = (pw.id === 'orb' && magic.orb) || (pw.id === 'levitate' && magic.levitating);
        return `<i class="${k ? '' : 'no'}${pw.id === sel.id ? ' sel' : ''}${on ? ' on' : ''}" style="--cd:${f}%"><span>${k ? pw.icon : '·'}</span><b>${pw.key}</b></i>`;
      }).join('') + `</div><small>${sel.no} (${sel.en}) · R1 / X · ← chooses</small>`;
    }
    if (html !== magicHudKey) {magicHudKey = html;const el = $('magicHud');el.innerHTML = html;el.hidden = !html;}
  }
  const orbView = new T.Vector3();
  function magicFx(dt) {
    fx.update(dt, camera);
    if (catacomb) {if (fx.orb.level > .02) {camera.updateMatrixWorld();orbView.copy(fx.orb.pos).applyMatrix4(camera.matrixWorldInverse);catacomb.setOrb(orbView, fx.orb.level);} else catacomb.setOrb(null, 0);}
  }
  // Other players' light orbs: a small glowing ball by their shoulder (no light, to keep the light count fixed).
  const remoteOrbMat = new T.MeshBasicMaterial({color: 0xfff1c8});
  function orbPose(r, st) {
    if (st.mg && !r.orb) {r.orb = new T.Mesh(new T.SphereGeometry(.09, 12, 8), remoteOrbMat);r.orb.name = 'Remote light orb';scene.add(r.orb);}
    if (r.orb) {r.orb.visible = !!st.mg && r.seen !== false;if (r.orb.visible) r.orb.position.set(r.pos.x + Math.cos(r.yaw) * .55, r.pos.y + 1.85 + Math.sin(performance.now() / 500) * .05, r.pos.z - Math.sin(r.yaw) * .55);}
  }
  // ---------- Test / inspection handle ----------
  // ---------- Photo hunt places, badge checks (issue #58) ----------
  const huntSpots = (() => {
    const W = (x, s) => world.toWorld(x, s), up = (p, h) => p && {x: p.x, y: (p.y ?? world.heightWorld(p.x, p.z)) + h, z: p.z};
    const pairs = r => Array.isArray(r[0]) ? r : r.reduce((o, v, i) => (i % 2 ? o[o.length - 1].push(v) : o.push([v]), o), []);
    const mid = r => {const p = pairs(r), c = p.reduce((a, [x, s]) => [a[0] + x / p.length, a[1] + s / p.length], [0, 0]);return W(c[0], c[1]);};
    const mark = kind => {const l = DISTRICTS.flatMap(d => d.landmarks).find(l => l.kind === kind);return l && mid(l.ring);};
    const room = catacomb && catacomb.layout.rooms.find(r => r.id === 'rotunda');
    const door = ownStair.floors().find(f => f.name === 'Street door threshold');
    const at = {
      'photo-oksen': {...W(OKSEN_AT.x, OKSEN_AT.s), y: oksen.base + 2.4},
      'photo-hodet': {...W(SCULPTURE_AT.x, SCULPTURE_AT.s), y: sculpture.base + 3.5},
      'photo-deichman': library && {...library.centre, y: library.floorY + 4},
      'photo-klatreverket': window.KLATREVERKET && up(mid(window.KLATREVERKET.ring), 6.5),
      'photo-rotunda': room && {...W(room.cx, room.cs), y: catacomb.FLOOR_Y + 1.3},
      'photo-muselunden': mini.muselunden && (() => {const b = mini.muselunden.holes[0].basket;return {x: b.x, y: b.y + .8, z: b.z};})(),
      'photo-munch': up(mark('munch'), 29),
      'photo-opera': up(mark('opera'), 12),
      'photo-rathkes': rathkes && up(rathkes.gate, 1.8),
      'photo-home': door && (() => {const p = door.points, c = p.reduce((a, q) => ({x: a.x + q.x / p.length, z: a.z + q.z / p.length}), {x: 0, z: 0});return {...c, y: (door.y ?? world.heightWorld(c.x, c.z)) + 2.5};})()
    };
    // The street door faces across its threshold (the short side), toward the street where the mission ring is.
    const face = {};
    if (door) {
      const p = door.points, e = p.map((q, i) => ({x: p[(i + 1) % p.length].x - q.x, z: p[(i + 1) % p.length].z - q.z})).sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z))[0], L = Math.hypot(e.x, e.z);
      let n = {x: -e.z / L, z: e.x / L};const h = at['photo-home'];if ((MISSION_MARK.x - h.x) * n.x + (MISSION_MARK.z - h.z) * n.z < 0) n = {x: -n.x, z: -n.z};face['photo-home'] = n;
    }
    return window.GameBadges.SPOTS.map(s => ({...s, at: at[s.id] || null, face: face[s.id]})).filter(s => s.at && [s.at.x, s.at.y, s.at.z].every(Number.isFinite));
  })();
  // Is the line from the camera to a place blocked by a wall, a tree, a vehicle or a hill? (stops `stop` metres before it)
  function sightBlocked(a, b, stop) {
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), steps = Math.floor((d - stop) / .5), under = a.y < groundAt(a.x, a.z) - 2;
    for (let i = 1; i <= steps; i++) {
      const k = i * .5 / d, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
      if (collision.hitsSolid(walkWorld, {x, z}, y - .05, y + .05) || (!under && y < groundAt(x, z) - .3)) return true;
    }
    return false;
  }
  function huntPhoto() {
    const shot = {cam: camera.position.clone(), fovY: camera.fov, ndc: p => new T.Vector3(p.x, p.y, p.z).project(camera), blocked: sightBlocked};
    const msg = badges.photo(shot, huntSpots, canvas);if (msg) notice(msg, 5);
    if (storgata && GRONLAND && storgata.status('even') === 'active') {
      const j = window.GameBadges.judge(GRONLAND, shot);
      if (j.ok) {storgata.photo('gronland');audio.sfx('quest');questWaypoint('even');notice('A good photo of Grønland kirke! Show it to Even outside Kiwi Storgata.', 5);}
      else if (j.d < GRONLAND.maxDist * 1.6) notice(`Even's photo of Grønland kirke: ${{far: `come closer (within ${GRONLAND.maxDist} m)`, frame: 'aim at the tower', small: 'get the whole tower in, a bit bigger – go closer or zoom in', blocked: 'something is in the way'}[j.why] || 'try again'}.`, 5);
    }
  }
  // Badges that come from what you do: checked twice a second (the rest come from the best scores and saved states).
  let badgeT = 0, pbSeen = 0;
  function badgeTick(dt) {
    badgeT -= dt;if (badgeT > 0) return;badgeT = .5;
    if (catacomb && catacomb.state.inside) markBadge('catacomb');
    if (library && library.reading && library.reading.which === 'moby') markBadge('moby');
    const v = player.vehicle;if (player.mode === 'vehicle' && v && v.aircraft && v.y - groundAt(v.x, v.z) > 50) markBadge('airborne');
    // A paintball game you played in ended: won or lost (a win counts only with somebody on the other team).
    if (pbRules && pbRules.inGame() && pbRules.ses.state === 'end' && pbRules.ses.id !== pbSeen) {
      const S = pbRules.ses, me = pbRules.myTeam();pbSeen = S.id;
      if (me >= 0 && Object.values(S.team).some(t => t === 1 - me)) badges.record('paintball', {won: S.winner === me});
    }
    badges.check();
  }
  window.haarklousGame = {player, vehicles, site, paintball, catacomb, groundAt, heli, plane, drone, watch, fire, stash, shops, gym, startClimb, openGymMenu, startBelay, get belay() {return belay;}, sculpture, oksen, weather, caravan, get skyd() {return skyd;}, get autoPlane() {return autoPlane;}, get jumpFlight() {return jumpFlight;}, boardAuto, boardCaravan, jump, get gp() {return gp;}, callGamePilot, handOver, CARAVAN_HOLD, applyWeather, wallet, get basket() {return basket;}, payAt, takeProduct, useItem, earn, openBag, takeBoost, get boost() {return boost;}, set boost(b) {boost = b;}, get mp() {return mp;}, sitDown, standUp, tryDrive, tryRide, openChat, startDrone, stopDrone, floorBelow, doors, mini, music, photo, map, world, apt, towers, walkWorld, route, landmarks, districts: DISTRICTS, get caseGame() {return caseGame;}, place, toggleDoor, enterVehicle, exitVehicle, startMinigame, startMission, drink, interact, findPrompt, renderFrame, begin, get fps() {return fpsAvg;}, kick: () => requestAnimationFrame(frame), get drunk() {return drunk;}, set drunk(v) {drunk = v;}, setStance, camera, scene};
  Object.assign(window.haarklousGame, {library, pingpong, rathkes, kayak, startKayak, hushedFor: () => hushed});
  Object.assign(window.haarklousGame, {badges, huntSpots, huntPhoto, sightBlocked, SKY_TARGET, progress, account});
  Object.assign(window.haarklousGame, {rides, get rentals() {return rentals;}, jobs, openPhone, rentDrive, JOB_SIGNS});
  Object.assign(window.haarklousGame, {storgata, magic, magicFxApi: fx, castPower, GRONLAND, storgataAct, questWaypoint, collision});
  loading.remove();$('start').hidden = false;
  requestAnimationFrame(frame);
})();
