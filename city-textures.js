/* City textures (issues #67 and #68): ground that reads as real ground up close, and building facades that look like the real
 * streets. Everything is painted in code at start-up (no photos are stored; Google Street View was only looked at for reference,
 * see docs/DECISIONS.md). Pure parts (also used by the Node tests):
 *   CityTextures.zoneAt(x, s) -> 'torshov' | 'sandaker' | 'myrens' | 'lokka' | 'toyen' | 'gronland' | 'kampen' | 'ensjo' | 'bjorvika'
 *   CityTextures.classify(info) -> look: which facade a building gets, from its type, height, place and OpenStreetMap tags
 *     info = {style, kind, h, x, s, colour, roofColour, roofShape, material, year, heritage, architect, seed, keep}
 *   CityTextures.wallBands(look, g0, bottom, top, shop) -> [{y0, y1, cell, mode, v0, v1, bay}] the plinth / ground floor / storeys /
 *     cornice bands of one wall, touching but never overlapping (no coplanar faces)
 *   CityTextures.shopLook(look) -> the look with a ground-floor band, for buildings with shops (OSM shop / café nodes)
 *   CityTextures.edgeU(len, bay) -> u at the end of a wall edge (whole bays, so no window is cut at a corner)
 *   CityTextures.looksOf(raw) -> {old(i), byId(id)}: the decoded building-looks-data.js
 *   CityTextures.CELLS: the atlas cells by name
 * Browser parts: CityTextures.create(T, renderer) (made once per page) -> {atlas, normal, material(), farColour(cell, tint), ground(material),
 *   setPhoto(on), cellCanvas(name) -> {colour, height} (lib.facade / lib.plinth tile these), bytes}
 *   One facade + roof atlas (2048 x 1024, 32 cells of 256 px with 8 px wrap-around borders) and a half-size normal atlas, so every
 *   building tile is one draw call. The ground detail is one 1024 x 1024 texture with four tileable patterns (grass, asphalt,
 *   paving, gravel) that the terrain shader blends by the colour under it (map painting or aerial photo), slope and noise.
 * Local frame: metres east (x) and south (s) of Haarklous plass 17A.
 */
(function (root, factory) {
  const api = factory();
  root.CityTextures = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // ---------- Atlas cells ----------
  // Each cell is one bay x one storey of a facade (repeats along and up the wall), one band (plinth, ground floor, cornice: repeats
  // along the wall only) or a roof tile patch. w x h are the metres the painting assumes. The last four (a plain brick wall, ground
  // storeys with a door or other frames) are painted but not used by any look yet: spare variants for doors and entrances.
  const CELL_LIST = [
    ['brick', 3.0, 2.85], ['brickCream', 3.0, 2.85], ['buff', 3.0, 3.0], ['hals', 3.0, 2.85], ['halsWhite', 3.0, 2.85], ['func', 3.2, 2.8], ['tenement', 2.7, 3.3], ['tenement2', 2.7, 3.3],
    ['concrete', 3.0, 3.0], ['newRender', 3.0, 3.0], ['newBrick', 3.0, 3.0], ['glass', 1.5, 3.6], ['ribbed', 2.0, 3.0], ['wood', 2.4, 2.7], ['shed', 2.0, 2.6], ['civic', 3.5, 3.6],
    ['shop', 4.0, 3.6], ['rustic', 2.7, 3.6], ['glassGround', 3.0, 3.6], ['plinthStone', 3.0, 1.0], ['plinthConcrete', 3.0, 1.0], ['plinthRender', 3.0, 1.0], ['cornice', 2.7, 0.9], ['blank', 3.0, 3.0],
    ['roofTile', 2.0, 2.0], ['roofMetal', 2.0, 2.0], ['roofFlat', 4.0, 4.0], ['roofSlate', 2.0, 2.0], ['brickPlain', 3.0, 2.85], ['halsGround', 3.0, 2.85], ['funcGround', 3.2, 2.8], ['woodGround', 2.4, 2.7]
  ];
  const CELLS = {};CELL_LIST.forEach(([name, w, h], i) => {CELLS[name] = {i, w, h};});
  const SLOT = 256, PAD = 8, CONTENT = SLOT - 2 * PAD, AW = 2048, AH = 1024, COLS = AW / SLOT;

  // ---------- Small helpers ----------
  const hash = n => {let h = (n | 0) ^ 0x9e3779b9;h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);return ((h ^ (h >>> 16)) >>> 0) / 4294967296;};
  const hashXY = (x, s, k = 0) => hash(Math.floor(x) * 73856093 ^ Math.floor(s) * 19349663 ^ k * 83492791);
  const NAMED = {white: '#eeeeea', black: '#2a2a2a', grey: '#8f8f8f', gray: '#8f8f8f', darkgrey: '#555759', darkgray: '#555759', lightgrey: '#c4c4c0', lightgray: '#c4c4c0',
    red: '#a3453a', brown: '#7a4e3a', orange: '#d98a4a', yellow: '#e3c46a', beige: '#d9c8a5', cream: '#ece2c6', pink: '#e0aaa0', green: '#7f9a74', blue: '#8fa6b8', silver: '#bfc3c4'};
  function parseColour(v) {
    if (!v) return null;let t = String(v).trim().toLowerCase();if (NAMED[t]) t = NAMED[t];
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(t);if (!m) return null;
    let h = m[1];if (h.length === 3) h = h.split('').map(c => c + c).join('');return parseInt(h, 16);
  }
  const rgb = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const mixHex = (a, b, t) => {const A = rgb(a), B = rgb(b);return (Math.round(A[0] + (B[0] - A[0]) * t) << 16) | (Math.round(A[1] + (B[1] - A[1]) * t) << 8) | Math.round(A[2] + (B[2] - A[2]) * t);};
  const pickOf = (list, r) => list[Math.min(list.length - 1, Math.floor(r * list.length))];

  // ---------- Areas of the city (rough boxes in local metres; the old square is Torshov) ----------
  // Checked against known places: Haarklous plass (0, 0), Thorvald Meyers gate (-970, 1500), Grønland church (-744, 2672), Tøyen
  // station (-148, 2382), Kampen park (213, 2594), Vålerenga church (559, 3017), Ensjø station (565, 2561), Helsfyr (1328, 2683).
  function zoneAt(x, s) {
    if (s > 3400) return 'bjorvika';
    if (s < 600 && x < -688) return 'myrens';
    if (s < 900 && x < -650) return 'sandaker';
    if (Math.abs(x) <= 800 && s <= 600) return 'torshov';
    if (x < -350) return s < 2200 ? 'lokka' : 'gronland';
    if (x < 100 && s >= 2500) return 'gronland';// with Gamlebyen and Vaterland
    if (x < 100 && s >= 1500) return 'toyen';
    if (x < 420 && s < 1500) return 'sandaker';// Rodeløkka, Carl Berners plass and Sinsen: tenements, buff brick and 1950s blocks
    if (x < 420 && s >= 2250) return 'kampen';
    if (x < 900 && s >= 2850) return 'kampen';// Vålerenga: small wooden houses and tenements like Kampen
    return 'ensjo';// Ensjø, Hasle, Løren and Helsfyr
  }

  // ---------- Which facade a building gets ----------
  // Street View notes (3 Nov 2026, looked at only): Torshov = dark red-brown brick blocks (brown or cream window frames, stone or
  // concrete plinths) mixed with Harald Hals' pale yellow / cream / pink plastered blocks (dark green small-paned windows, red tile
  // hip roofs) and white 1950s plaster blocks; Sandaker / Grønland = buff-yellow brick and plastered tenements; Grünerløkka = 1880-1900
  // plastered tenements in white, cream, grey, ochre, deep red, pale green and blue with cornices, window surrounds and shops on the
  // ground floor; Tøyen = 1960s concrete; Kampen / Vålerenga = small painted wooden houses; Ensjø / Bjørvika = new blocks of dark or
  // red-brown brick, light render and glass.
  const PLASTER = {
    hals: [0xe2c98e, 0xe8d6a6, 0xdc9e92, 0xd8bf85, 0xe6dcc4, 0xd4b46a],
    func: [0xecebe4, 0xe4e2da, 0xdedad0, 0xe8dcc0, 0xe2cfc4, 0xd6d8d2],
    tenement: [0xece8de, 0xe8dcc0, 0xcfd0cb, 0xd9b56a, 0xe3c77a, 0xa54a3c, 0xc9d3b8, 0xc3cdd3, 0xd9a48c, 0xd8c7a6, 0xe6e1d3, 0xb9b3a6],
    render: [0xeeeeea, 0xe2e2de, 0xd2d3d0, 0xb9bab6, 0x5f6264, 0xe8e0cc],
    newBrick: [0x5a5652, 0x4c4a48, 0x8c4c3a, 0x9a5a44, 0xc49a68, 0x6e6a64],
    wood: [0xeeebe4, 0xe2c46e, 0x8e3b2e, 0xa9bccb, 0x8fa38a, 0xbab7ae, 0xd6c49a, 0x7a2e26],
    civic: [0xe5d6b0, 0xece8de, 0xd8cfbd, 0xe2c79a],
    industrial: [0xd8dcde, 0xbfc5c9, 0xc4b9a8, 0xaab4b8, 0x8f9a9e, 0x6f7f86],
    shed: [0x8d7f6d, 0x6d5c4b, 0x8c3a2e, 0x9a9488]
  };
  const ROOF = {tile: [0xa76362, 0xa3695c, 0x9b5444, 0xb06a52], dark: [0x3f4246, 0x4a4c4f, 0x55585b, 0x36393c], flat: [0x58585a, 0x646462, 0x6f6e6a, 0x4e4f50], metal: [0x55595c, 0x6b7173, 0x4c5a56, 0x7d3b32]};
  const HOUSES = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'cabin', 'farm', 'villa', 'hut']);
  const SMALL = new Set(['garage', 'garages', 'shed', 'cabin', 'hut', 'greenhouse', 'kiosk', 'service', 'toilets', 'barn', 'allotment_house', 'carport', 'farm_auxiliary', 'transformer_tower', 'bicycle_parking']);
  const CIVIC = new Set(['school', 'kindergarten', 'university', 'college', 'civic', 'public', 'hospital', 'government', 'fire_station', 'church', 'chapel', 'religious', 'mosque', 'library', 'train_station', 'museum']);
  const INDUSTRY = new Set(['industrial', 'warehouse', 'manufacture', 'sports_centre', 'stadium', 'transportation', 'parking', 'hangar', 'sports_hall']);
  const OFFICE = new Set(['office', 'commercial', 'retail', 'hotel', 'supermarket']);
  // Era from a colour tag: OSM mappers in Torshov tag the brick blocks reddish (#cb9c89, #d79d88) and the plastered ones yellow, cream or pink.
  function brickish(c) {if (c == null) return false;const [r, g, b] = rgb(c);return r - b > 55 && r - g > 35 && r < 215;}

  function classify(info) {
    const {style = 'plaster', h = 9, x = 0, s = 0, seed = 0} = info, kind = info.kind || '';
    const zone = zoneAt(x, s), wall = parseColour(info.colour), roofC = parseColour(info.roofColour), mat = info.material || '';
    const r = hash(seed * 7 + 1), r2 = hash(seed * 13 + 5), r3 = hash(seed * 31 + 9);
    // Neighbouring blocks share a look: chance picks by a 70 m cell, not per building.
    const blockR = hashXY(x / 70, s / 70, 3) * .65 + r * .35, levels = Math.max(1, Math.round((h - 1) / 3));
    const look = (cls, o = {}) => finish(cls, o, {wall, roofC, r, r2, r3, zone, h, kind, roofShape: info.roofShape || ''});
    if (info.keep === 'brick') return look('torshovBrick', {frames: 'brown', keep: true});
    if (style === 'shed' && (SMALL.has(kind) || h <= 7)) return look(HOUSES.has(kind) ? 'house' : 'shed');
    if (SMALL.has(kind)) return look('shed');
    if (mat === 'wood' || (HOUSES.has(kind) && h < 11)) return look('house');
    // Halls and warehouses: ribbed metal out at Ensjø, Bjørvika and Myrens; in the old brick districts they are brick buildings too.
    if (style === 'industrial' || INDUSTRY.has(kind) || mat === 'metal') return look(mat === 'metal' || ['ensjo', 'bjorvika', 'myrens'].includes(zone) || h < 6 ? 'industrial' : zone === 'torshov' ? 'torshovBrick' : 'buffBrick');
    if (mat === 'glass') return look('glass');
    const year = info.year || 0;
    if (CIVIC.has(kind) && !info.heritage && !(year && year < 1915)) return look(year && year > 1960 ? 'newBlock' : 'civic');
    if (style === 'modern' || levels >= 9) return look(OFFICE.has(kind) || kind === 'yes' || !kind ? (r < .6 ? 'glass' : 'newBlock') : (r < .75 ? 'newBlock' : 'concrete60'));
    // Blocks of flats, shops and offices of normal height.
    if (year) {
      if (year < 1915) return look('tenement');
      if (year < 1930) return look(zone === 'torshov' ? 'hals' : 'tenement');
      if (year < 1956) return look(mat === 'plaster' ? 'func' : zone === 'torshov' ? 'torshovBrick' : 'buffBrick');
      if (year < 1986) return look('concrete60');
      return look('newBlock');
    }
    if (info.architect === 'hals') return look('hals');
    if (mat === 'brick' || brickish(wall)) return look(zone === 'torshov' || zone === 'myrens' ? 'torshovBrick' : 'buffBrick');
    if (mat === 'concrete') return look('concrete60');
    if (wall != null || mat === 'plaster') return look(zone === 'torshov' ? (roofC != null && brickish(roofC) ? 'hals' : (levels <= 4 ? 'hals' : 'func')) : 'tenement');
    if (info.heritage) return look(zone === 'torshov' ? 'hals' : 'tenement');
    if (levels >= 7) return look(blockR < .7 ? 'newBlock' : 'concrete60');
    const by = {
      // West of Haarklous plass (Hegermanns plass, Nordkappgata, Torshovgata) Harald Hals' plastered blocks dominate; round the flat, brick.
      torshov: x < -250 ? [[.25, 'torshovBrick'], [.75, 'hals'], [1, 'func']] : [[.6, 'torshovBrick'], [.8, 'hals'], [1, 'func']],
      sandaker: [[.4, 'buffBrick'], [.75, 'tenement'], [1, 'func']],
      myrens: [[.25, 'torshovBrick'], [.45, 'buffBrick'], [.8, 'tenement'], [1, 'newBlock']],// Sagene, Vogts gate (buff brick and tenements on Street View)
      lokka: [[.8, 'tenement'], [.9, 'buffBrick'], [1, 'func']],
      toyen: [[.4, 'concrete60'], [.8, 'tenement'], [1, 'buffBrick']],
      gronland: [[.62, 'tenement'], [.9, 'buffBrick'], [1, 'concrete60']],
      kampen: [[.5, 'tenement'], [.75, 'buffBrick'], [1, 'func']],
      ensjo: [[.65, 'newBlock'], [.85, 'concrete60'], [1, 'buffBrick']],
      bjorvika: [[.8, 'newBlock'], [1, 'glass']]
    }[zone];
    if (OFFICE.has(kind) && levels >= 5 && zone !== 'lokka') return look(blockR < .5 ? 'newBlock' : 'concrete60');
    return look(by.find(([p]) => blockR < p)[1]);
  }
  // The cells, band heights and colours for each kind of facade.
  function finish(cls, o, {wall, roofC, r, r2, r3, zone, h, kind, roofShape}) {
    const tintOf = list => wall != null && !brickish(wall) ? wall : pickOf(list, r2);
    const roofOf = (list, deflt) => roofC != null ? roofC : deflt != null ? deflt : pickOf(list, r3);
    const L = {cls, upper: 'blank', ground: null, plinth: null, top: null, roof: 'roofFlat', tint: 0xe6e2d8, roofTint: pickOf(ROOF.flat, r3), plinthH: 0, groundH: 0, topH: 0, shops: false};
    const flatRoof = roofShape === 'flat';
    switch (cls) {
      case 'torshovBrick': {
        const cream = o.frames ? o.frames === 'cream' : r < .45;
        Object.assign(L, {upper: cream ? 'brickCream' : 'brick', ground: cream ? 'brickCream' : 'brick', plinth: r2 < .55 ? 'plinthStone' : 'plinthConcrete', plinthH: 1.0, tint: 0xffffff,
          roof: 'roofSlate', roofTint: roofOf(ROOF.dark)});
        break;
      }
      case 'buffBrick': Object.assign(L, {upper: 'buff', ground: 'buff', plinth: 'plinthConcrete', plinthH: .8, tint: 0xffffff, roof: flatRoof || r3 < .5 ? 'roofFlat' : 'roofMetal', roofTint: roofOf(ROOF.flat)});break;
      case 'hals': Object.assign(L, {upper: r < .7 ? 'hals' : 'halsWhite', plinth: 'plinthRender', plinthH: .9, tint: tintOf(PLASTER.hals), roof: 'roofTile', roofTint: roofOf(ROOF.tile)});break;
      case 'func': Object.assign(L, {upper: 'func', plinth: 'plinthConcrete', plinthH: .7, tint: tintOf(PLASTER.func), roof: flatRoof ? 'roofFlat' : 'roofMetal', roofTint: roofOf(ROOF.dark)});break;
      case 'tenement': Object.assign(L, {upper: r < .55 ? 'tenement' : 'tenement2', ground: 'rustic', groundH: 3.6, top: 'cornice', topH: .9, tint: tintOf(PLASTER.tenement), roof: r3 < .25 ? 'roofTile' : 'roofMetal', roofTint: roofOf(r3 < .25 ? ROOF.tile : ROOF.dark)});break;
      case 'concrete60': Object.assign(L, {upper: 'concrete', ground: 'concrete', plinth: 'plinthConcrete', plinthH: .6, tint: mixHex(0xd8d6d0, tintOf(PLASTER.render), .3), roof: 'roofFlat', roofTint: roofOf(ROOF.flat)});break;
      case 'newBlock': {
        const brick = r < .5;
        Object.assign(L, {upper: brick ? 'newBrick' : 'newRender', ground: brick ? 'newBrick' : 'newRender', tint: brick ? pickOf(PLASTER.newBrick, r2) : tintOf(PLASTER.render), roof: 'roofFlat', roofTint: roofOf(ROOF.flat)});
        break;
      }
      case 'glass': Object.assign(L, {upper: 'glass', ground: 'glassGround', groundH: 4.2, tint: pickOf([0xffffff, 0xdfe6ee, 0xcfd6dc, 0xe8e2d8], r2), roof: 'roofFlat', roofTint: roofOf(ROOF.flat)});break;
      case 'industrial': Object.assign(L, {upper: 'ribbed', tint: tintOf(PLASTER.industrial), roof: 'roofMetal', roofTint: roofOf(ROOF.metal)});break;
      case 'house': Object.assign(L, {upper: 'wood', plinth: 'plinthConcrete', plinthH: .5, tint: tintOf(PLASTER.wood), roof: r3 < .55 ? 'roofTile' : 'roofMetal', roofTint: roofOf(r3 < .55 ? ROOF.tile : ROOF.dark)});break;
      case 'shed': Object.assign(L, {upper: 'shed', tint: tintOf(PLASTER.shed), roof: 'roofMetal', roofTint: roofOf(ROOF.metal)});break;
      case 'civic': Object.assign(L, {upper: 'civic', ground: 'civic', plinth: 'plinthConcrete', plinthH: .7, tint: tintOf(PLASTER.civic), roof: r3 < .5 ? 'roofTile' : 'roofMetal', roofTint: roofOf(r3 < .5 ? ROOF.tile : ROOF.dark)});break;
    }
    // Shop fronts where OSM has shops, except on sheds, halls, houses, schools and the buildings whose shop is modelled (Joker, Kiwi).
    L.shops = !['shed', 'industrial', 'house', 'civic'].includes(cls) && !o.keep;
    // Low buildings: no separate ground-floor band higher than half the building.
    if (L.groundH > (h - L.plinthH) * .6) L.groundH = 0;
    if (L.topH && h < 7) {L.top = null;L.topH = 0;}
    return L;
  }

  // ---------- Wall bands ----------
  // mode 0 = the cell repeats along and up the wall (storeys), 1 = it repeats along the wall only (v clamped: plinth, ground floor, cornice).
  // shop: this edge has a shop front on the ground floor (down to the street, no plinth); use shopLook(look) for the whole building
  // so every edge has the same storey lines.
  function wallBands(look, g0, bottom, top, shop = false) {
    const out = [], cellH = n => CELLS[n].h, add = (y0, y1, cell, mode, v0, v1) => {if (y1 - y0 > 1e-3) out.push({y0, y1, cell, mode, v0, v1, bay: CELLS[cell].w});};
    const P = look.plinth && look.plinthH > 0 ? look.plinthH : 0, base = g0 + P;
    const topBand = look.top && look.topH > 0 && top - look.topH > base + 2 ? top - look.topH : top;
    const G = look.ground && look.groundH > 0 && topBand - base > look.groundH + 1.2 ? look.groundH : 0;
    let y = bottom;
    if (shop && G > 0) {
      const yG = Math.min(top, base + G), H = base + G - g0;add(y, yG, look.shopCell || 'shop', 1, (y - g0) / H, (yG - g0) / H);y = yG;
    } else {
      if (P > 0) {const yP = Math.min(top, base);if (yP > y) {const H = cellH(look.plinth);add(y, yP, look.plinth, 1, 1 - (base - y) / H, 1 - (base - yP) / H);y = yP;}}
      if (G > 0 && y < base + G) {add(y, base + G, look.ground, 1, (y - base) / G, 1);y = base + G;}
    }
    if (topBand > y) {
      // Whole storeys from the base (or from the top of the ground-floor band): their height is stretched a little to fit.
      // Less than most of a storey left (low sheds, a house's gable band): part of one storey at its own height, not squashed.
      const start = y > base + 1e-6 ? y : base, nominal = cellH(look.upper), H = topBand - start, n = Math.max(1, Math.round(H / nominal)), st = H < nominal * .8 ? nominal : H / n;
      add(y, topBand, look.upper, 0, (y - start) / st, H / st);
    }
    if (topBand < top) add(Math.max(y, topBand), top, look.top, 1, 0, 1);
    return out;
  }
  // A building with shops gets a ground-floor band on every edge (shop fronts where the shops are, the facade elsewhere).
  function shopLook(look) {
    if (['shed', 'industrial', 'house'].includes(look.cls)) return look;
    return {...look, groundH: Math.max(look.groundH, 3.4), ground: look.ground || look.upper, shopCell: look.cls === 'newBlock' || look.cls === 'glass' ? 'glassGround' : 'shop'};
  }
  // Whole bays along an edge; a short edge (less than half a bay) shows only the plain wall at the start of a bay.
  const edgeU = (len, bay) => len < .45 * bay ? .12 * len / (.45 * bay) : Math.max(1, Math.round(len / bay));

  // ---------- building-looks-data.js ----------
  function looksOf(raw) {
    const none = {old: () => null, byId: () => null};if (!raw || !raw.table) return none;
    const row = code => {const t = raw.table[code];if (!t || !t.length) return null;const [kind, roofShape, roofColour, colour, material, year, heritage, architect] = t;return {kind, roofShape, roofColour, colour, material, year, heritage: !!heritage, architect};};
    const ids = new Map(), [w, r] = raw.ids.split(';'), codes = raw.codes;let k = 0;
    for (const [list, p] of [[w.slice(1), 'w'], [r.slice(1), 'r']]) {let id = 0;if (list) for (const d of list.split(',')) {id += parseInt(d, 36);ids.set(p + id, parseInt(codes.slice(k * 2, k * 2 + 2), 36));k++;}}
    return {old: i => row(parseInt(raw.old.slice(i * 2, i * 2 + 2), 36) || 0), byId: id => ids.has(id) ? row(ids.get(id)) : null, shops: raw.shops || []};
  }

  // ======================================================================================================================
  // Browser: painting the atlases and the shaders
  // ======================================================================================================================
  let instance = null;// one atlas per page (lib.facade and the surroundings share it)
  function create(T, renderer) {
    if (instance) return instance;
    let seed = 20261103;const rand = () => {seed = (seed * 16807) % 2147483647;return seed / 2147483647;};
    const canvas = (w, h = w) => {const c = document.createElement('canvas');c.width = w;c.height = h;return c;};
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4);
    const hex = n => '#' + n.toString(16).padStart(6, '0');
    const shade = (n, f) => {const [r, g, b] = rgb(n);return `rgb(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0})`;};
    // ---------- Facade atlas ----------
    // Three layers per cell: colour, mask (white = takes the building's tint, grey = keeps its own colour, black = glass) and height.
    // Each cell is painted on small CPU canvases and copied, with wrap-around borders, straight into typed arrays: the whole atlas
    // is never drawn or read back as one big canvas (that took about a second).
    const data = new Uint8Array(AW * AH * 4).fill(128), heights = new Uint8Array(AW * AH).fill(128);
    // One cell is painted into its own 240 px canvases in metres, then copied with wrap-around borders.
    const cellCanvases = new Map();
    function paintCell(name, draw) {
      const cell = CELLS[name], c = canvas(CONTENT), m = canvas(CONTENT), hh = canvas(CONTENT), sx = CONTENT / cell.w, sy = CONTENT / cell.h;cellCanvases.set(name, {colour: c, height: hh});
      const rf = {willReadFrequently: true}, C = c.getContext('2d', rf), M = m.getContext('2d', rf), H = hh.getContext('2d', rf);M.fillStyle = '#808080';M.fillRect(0, 0, CONTENT, CONTENT);H.fillStyle = '#808080';H.fillRect(0, 0, CONTENT, CONTENT);
      // P: drawing in metres, x along the bay, y up from the bottom of the cell.
      const P = {
        w: cell.w, h: cell.h, C, M, H,
        rect(x, y, w, h, col, mask = .5, height = .5) {
          const X = x * sx, Y = (cell.h - y - h) * sy, W = w * sx, HH = h * sy;
          if (col != null) {C.fillStyle = typeof col === 'string' ? col : hex(col);C.fillRect(X, Y, W, HH);}
          if (mask != null) {const v = Math.round(mask * 255);M.fillStyle = `rgb(${v},${v},${v})`;M.fillRect(X, Y, W, HH);}
          if (height != null) {const v = Math.round(height * 255);H.fillStyle = `rgb(${v},${v},${v})`;H.fillRect(X, Y, W, HH);}
        },
        grad(x, y, w, h, stops, mask = 0, height = .2) {
          const X = x * sx, Y = (cell.h - y - h) * sy, g = C.createLinearGradient(0, Y, 0, Y + h * sy);stops.forEach(([t, col]) => g.addColorStop(t, col));
          C.fillStyle = g;C.fillRect(X, Y, w * sx, h * sy);P.rect(x, y, w, h, null, mask, height);
        },
        noise(alpha, size = 1.2, colours = ['#000000', '#ffffff'], count = 2600) {for (let i = 0; i < count; i++) {C.globalAlpha = alpha * rand();C.fillStyle = colours[Math.floor(rand() * colours.length)];const s = size * (.4 + rand());C.fillRect(rand() * CONTENT, rand() * CONTENT, s, s);}C.globalAlpha = 1;},
        sx, sy
      };
      draw(P);
      const col = cell.i % COLS, row = Math.floor(cell.i / COLS), cd = C.getImageData(0, 0, CONTENT, CONTENT).data, md = M.getImageData(0, 0, CONTENT, CONTENT).data, hd = H.getImageData(0, 0, CONTENT, CONTENT).data;
      for (let y = -PAD; y < CONTENT + PAD; y++) {
        const sy0 = ((y % CONTENT) + CONTENT) % CONTENT, dy = row * SLOT + PAD + y;
        for (let x = -PAD; x < CONTENT + PAD; x++) {
          const si = (sy0 * CONTENT + ((x % CONTENT) + CONTENT) % CONTENT) * 4, di = dy * AW + col * SLOT + PAD + x;
          data[di * 4] = cd[si];data[di * 4 + 1] = cd[si + 1];data[di * 4 + 2] = cd[si + 2];data[di * 4 + 3] = md[si];heights[di] = hd[si];
        }
      }
    }
    // Brick courses (Norwegian brick, about 25 x 7 cm with mortar) in a palette; mask .5 keeps the brick's own colour, 1 takes the tint.
    function bricks(P, palette, mortar, mask = .5, course = .0713, len = .25) {
      P.rect(0, 0, P.w, P.h, mortar, mask, .35);
      const rows = Math.round(P.h / course), cols = Math.round(P.w / len), ch = P.h / rows, cw = P.w / cols, gap = .012;
      for (let r = 0; r < rows; r++) for (let k = -1; k < cols; k++) {
        const x = (k + (r % 2) * .5) * cw, c = palette[Math.floor(rand() * palette.length)], f = .88 + rand() * .22;
        P.rect(x + gap / 2, r * ch + gap / 2, cw - gap, ch - gap, shade(c, f), mask, .62 + rand() * .1);
        if (rand() < .25) P.rect(x + gap / 2, r * ch + gap / 2, cw - gap, ch * .4, shade(c, f * .9), null, null);
      }
    }
    const SKY = [[0, '#b6c6d3'], [.42, '#6f7f8b'], [1, '#2f373e']];
    // A window opening: dark reveal, frame, panes (glass, mask 0) with mullions, and a sill.
    function windowAt(P, x, y, w, h, o = {}) {
      const frame = o.frame ?? 0x4a3024, fw = o.fw ?? .06, cols = o.cols ?? 2, rows = o.rows ?? 1, transom = o.transom || 0;
      if (o.surround) P.rect(x - o.surround.w, y - (o.surround.below ?? .05), w + 2 * o.surround.w, h + o.surround.w + (o.surround.below ?? .05), o.surround.col, o.surround.mask ?? .5, .7);
      P.rect(x - .03, y - .02, w + .06, h + .05, '#2b2826', .5, .1);// reveal shadow
      P.rect(x, y, w, h, frame, .5, .4);
      const gx = x + fw, gy = y + fw, gw = w - 2 * fw, gh = h - 2 * fw;
      P.grad(gx, gy, gw, gh, SKY, 0, .15);
      if (transom) P.rect(gx, gy + gh - transom - fw / 2, gw, fw, frame, .5, .4);
      for (let i = 1; i < cols; i++) P.rect(gx + gw * i / cols - fw / 3, gy, fw * .66, transom ? gh - transom : gh, frame, .5, .4);
      for (let j = 1; j < rows; j++) P.rect(gx, gy + (transom ? gh - transom : gh) * j / rows - fw / 4, gw, fw / 2, frame, .5, .4);
      if (o.sill !== false) {P.rect(x - .06, y - .07, w + .12, .07, o.sillCol ?? '#9c9a94', .5, .8);P.rect(x - .06, y - .1, w + .12, .03, '#3a3734', .5, .3);}
    }
    // Plaster with a faint roller texture (mask 1: takes the building's colour).
    function plaster(P, base = '#ebe8e1', mask = 1) {P.rect(0, 0, P.w, P.h, base, mask, .5);P.noise(.18, 1.1, ['#d8d6d0', '#ffffff'], 3200);P.noise(.08, 3, ['#cfcac0'], 300);}
    const TORSHOV_BRICK = [0x7a4436, 0x6e3b30, 0x84493a, 0x733f37, 0x8a5040, 0x683a31, 0x7d4a3e, 0x6a3a35], BUFF = [0xb8894f, 0xae7f48, 0xc29257, 0xa67a45, 0xbc8c52, 0xc89a5e];
    const GREYS = [0xa0a0a0, 0x8e8e8e, 0xacacac, 0x969696, 0xb4b4b4];
    paintCell('brick', P => {bricks(P, TORSHOV_BRICK, '#8a7e72');windowAt(P, .85, .85, 1.3, 1.45, {frame: 0x4a2e22, cols: 2});P.rect(.85, 2.3, 1.3, .1, '#5e342a', .5, .55);});
    paintCell('brickCream', P => {bricks(P, TORSHOV_BRICK, '#8a7e72');windowAt(P, .8, .85, 1.4, 1.45, {frame: 0xe3d6a8, cols: 3, fw: .07});P.rect(.72, 2.3, 1.56, .1, '#5e342a', .5, .55);});
    paintCell('brickPlain', P => {bricks(P, TORSHOV_BRICK, '#8a7e72');});
    paintCell('buff', P => {bricks(P, BUFF, '#b8ab95');windowAt(P, .75, .9, 1.5, 1.45, {frame: 0xf0eee8, cols: 3, sillCol: '#b9b5ac'});});
    paintCell('hals', P => {plaster(P);windowAt(P, .95, .9, 1.1, 1.35, {frame: 0x2f4a38, cols: 2, rows: 3, fw: .055, surround: {w: .09, col: '#f4f1ea', mask: .5}});});
    paintCell('halsWhite', P => {plaster(P);windowAt(P, .95, .9, 1.1, 1.35, {frame: 0xf2efe8, cols: 2, rows: 3, fw: .055, surround: {w: .07, col: '#e8e4da', mask: .5}});});
    paintCell('halsGround', P => {plaster(P);windowAt(P, .95, .85, 1.1, 1.3, {frame: 0x2f4a38, cols: 2, rows: 3, fw: .055, surround: {w: .09, col: '#f4f1ea', mask: .5}});});
    paintCell('func', P => {plaster(P);windowAt(P, .8, .9, 1.6, 1.3, {frame: 0xe9e7e0, cols: 3, fw: .06, sillCol: '#a7a49c'});});
    paintCell('funcGround', P => {plaster(P);windowAt(P, .8, .9, 1.6, 1.3, {frame: 0x6a6f72, cols: 3, fw: .06, sillCol: '#a7a49c'});});
    paintCell('tenement', P => {
      plaster(P);P.rect(0, 0, P.w, .1, null, 1, .58);// string course at the floor
      windowAt(P, .85, .9, 1.0, 1.85, {frame: 0xf3f1ec, cols: 2, transom: .42, fw: .055, surround: {w: .14, col: '#f3efe6', mask: .5}, sillCol: '#e9e4da'});
      P.rect(.65, 2.9, 1.4, .16, '#f6f3ec', .5, .8);P.rect(.65, 2.87, 1.4, .03, '#5e5a54', .5, .3);
    });
    paintCell('tenement2', P => {
      plaster(P);
      windowAt(P, .85, .9, 1.0, 1.8, {frame: 0xf3f1ec, cols: 2, transom: .4, fw: .055, surround: {w: .12, col: '#f1ede4', mask: .5}, sillCol: '#e9e4da'});
      // A small pediment over the window.
      const X = .85 * P.sx, Y = (P.h - 3.1) * P.sy, W = 1.0 * P.sx;
      for (const [k, col] of [[P.C, '#f4f0e7'], [P.M, '#808080'], [P.H, '#d0d0d0']]) {k.fillStyle = col;k.beginPath();k.moveTo(X - .2 * P.sx, Y + .38 * P.sy);k.lineTo(X + W / 2, Y);k.lineTo(X + W + .2 * P.sx, Y + .38 * P.sy);k.closePath();k.fill();}
      P.rect(.62, 2.75, 1.46, .05, '#5e5a54', .5, .3);
    });
    paintCell('rustic', P => {
      plaster(P, '#e8e4dc');for (let y = .18; y < P.h; y += .34) P.rect(0, y, P.w, .035, '#9c978e', 1, .25);// rusticated grooves
      P.rect(0, 0, P.w, .55, '#8d8a84', .5, .55);// stone plinth
      windowAt(P, .8, 1.15, 1.1, 1.85, {frame: 0xf3f1ec, cols: 2, transom: .4, fw: .055, sillCol: '#d9d4ca'});
      P.rect(0, 3.4, P.w, .2, '#f2eee6', .5, .8);
    });
    paintCell('shop', P => {
      plaster(P, '#e4e0d8');P.rect(0, 0, P.w, .3, '#6f6b66', .5, .55);
      // Two display windows and a door; a dark sign band above.
      windowAt(P, .3, .32, 2.35, 2.25, {frame: 0x2a2d30, cols: 2, fw: .07, sill: false});
      P.rect(2.95, .3, .85, 2.3, '#2a2d30', .5, .35);P.grad(3.02, .3, .71, 2.2, SKY, 0, .12);
      P.rect(.2, 2.72, 3.6, .55, '#2c2f33', .5, .6);P.rect(.2, 2.68, 3.6, .04, '#c9c4ba', .5, .7);
    });
    paintCell('glassGround', P => {P.rect(0, 0, P.w, P.h, '#3a3e42', .5, .4);P.grad(.08, .05, P.w - .16, P.h - .5, [[0, '#a9b9c6'], [.5, '#5d6b76'], [1, '#2a3036']], 0, .15);P.rect(P.w / 2 - .04, .05, .08, P.h - .5, '#3a3e42', .5, .4);});
    paintCell('plinthStone', P => {
      P.rect(0, 0, P.w, P.h, '#8c6f62', .5, .5);
      for (let r = 0; r < 3; r++) for (let k = -1; k < 4; k++) {const x = (k + (r % 2) * .5) * .9, y = r * .3;P.rect(x + .01, y + .01, .88, .28, shade(0x8c6f62, .9 + rand() * .2), .5, .6 + rand() * .1);}
      P.rect(0, .9, P.w, .1, '#9d8173', .5, .75);
      P.rect(1.15, .25, .7, .38, '#2c2a28', .5, .1);P.grad(1.2, .3, .6, .28, SKY, 0, .1);
    });
    paintCell('plinthConcrete', P => {
      P.rect(0, 0, P.w, P.h, '#8f8d88', .5, .5);P.noise(.25, 1.4, ['#6d6b67', '#b0aea8']);P.rect(0, .92, P.w, .08, '#a3a19b', .5, .75);
      P.rect(1.15, .3, .7, .36, '#2c2a28', .5, .1);P.grad(1.2, .34, .6, .28, SKY, 0, .1);
    });
    paintCell('plinthRender', P => {
      P.rect(0, 0, P.w, P.h, '#a99a98', .5, .5);P.noise(.2, 1.2, ['#8f817f', '#c4b7b4']);P.rect(0, .92, P.w, .08, '#c9c1b7', .5, .75);
      P.rect(1.2, .3, .6, .34, '#2f4a38', .5, .3);P.grad(1.25, .34, .5, .26, SKY, 0, .1);
    });
    paintCell('cornice', P => {
      plaster(P, '#f3f0e9');P.rect(0, 0, P.w, .12, '#f6f4ee', .5, .7);P.rect(0, .12, P.w, .04, '#7a766e', 1, .3);
      for (let x = .05; x < P.w; x += .18) P.rect(x, .2, .09, .14, '#f6f4ee', .5, .85);// dentils
      P.rect(0, .38, P.w, .06, '#6f6b64', 1, .3);P.rect(0, .44, P.w, .36, '#f5f2ec', .5, .9);P.rect(0, .8, P.w, .1, '#4a4743', .5, .4);
    });
    paintCell('concrete', P => {
      P.rect(0, 0, P.w, P.h, '#d0cec8', 1, .5);P.noise(.3, 1.4, ['#9a9892', '#e8e6e0']);
      for (let x = 0; x < P.w; x += 1.0) P.rect(x, 0, .015, P.h, '#a8a6a0', 1, .3);// panel joints
      windowAt(P, 0, 1.0, P.w, 1.3, {frame: 0x34383b, cols: 3, fw: .06, sill: false});P.rect(0, .92, P.w, .08, '#8e8c86', .5, .7);
    });
    paintCell('newRender', P => {
      plaster(P, '#f0efea');windowAt(P, .45, .25, 2.1, 2.45, {frame: 0x34383b, cols: 2, fw: .06, sill: false});
      P.rect(.4, .25, 2.2, .9, 'rgba(190,205,212,.35)', 0, .5);P.rect(.4, 1.12, 2.2, .04, '#5b6064', .5, .7);// glass french-balcony rail
    });
    paintCell('newBrick', P => {bricks(P, GREYS, '#c8c8c4', 1, .0833, .3);windowAt(P, .5, .3, 2.0, 2.3, {frame: 0x2e3134, cols: 2, fw: .07, sillCol: '#6a6c6e'});});
    paintCell('glass', P => {P.rect(0, 0, P.w, P.h, '#c9cdd1', 1, .6);P.grad(.04, .45, P.w - .08, P.h - .5, [[0, '#9fb3c4'], [.5, '#5c6e7e'], [1, '#33404c']], 0, .2);P.rect(0, .4, P.w, .06, '#2b333b', .5, .5);});
    paintCell('ribbed', P => {for (let x = 0; x < P.w; x += .2) {P.rect(x, 0, .1, P.h, '#d7dadc', 1, .7);P.rect(x + .1, 0, .1, P.h, '#b9bdc0', 1, .35);}P.rect(0, P.h - .06, P.w, .06, '#6e7275', .5, .3);});
    paintCell('wood', P => {
      for (let x = 0; x < P.w; x += .12) {P.rect(x, 0, .12, P.h, shade(0xeeeeea, .93 + rand() * .08), 1, .6);P.rect(x + .105, 0, .015, P.h, '#a8a8a4', 1, .25);}
      windowAt(P, .7, .9, 1.0, 1.2, {frame: 0xf4f3ef, cols: 2, rows: 2, fw: .06, surround: {w: .1, col: '#f4f3ef', mask: .5}, sillCol: '#efeee9'});
    });
    paintCell('woodGround', P => {
      for (let x = 0; x < P.w; x += .12) {P.rect(x, 0, .12, P.h, shade(0xeeeeea, .93 + rand() * .08), 1, .6);P.rect(x + .105, 0, .015, P.h, '#a8a8a4', 1, .25);}
      P.rect(.75, 0, .95, 2.1, '#f4f3ef', .5, .7);P.rect(.82, 0, .81, 2.03, '#5a4434', .5, .4);P.rect(.9, 1.2, .65, .7, null, null, .3);P.grad(.95, 1.25, .55, .6, SKY, 0, .12);
    });
    paintCell('shed', P => {for (let x = 0; x < P.w; x += .16) {P.rect(x, 0, .16, P.h, shade(0xd0d0d0, .85 + rand() * .2), 1, .6);P.rect(x + .14, 0, .02, P.h, '#5a5a5a', 1, .2);}});
    paintCell('civic', P => {plaster(P);windowAt(P, .45, .85, 2.6, 2.0, {frame: 0xeceae4, cols: 3, rows: 2, fw: .06, sillCol: '#b8b4aa'});});
    paintCell('blank', P => {plaster(P);});
    paintCell('roofTile', P => {
      P.rect(0, 0, P.w, P.h, '#b9a9a2', 1, .4);
      for (let r = 0; r < 8; r++) for (let k = -1; k < 10; k++) {const x = (k + (r % 2) * .5) * .22, y = r * .25;P.rect(x + .01, y, .2, .24, shade(0xd8cbc4, .82 + rand() * .3), 1, .55 + rand() * .2);P.rect(x + .01, y, .2, .05, '#8f817b', 1, .25);}
    });
    paintCell('roofMetal', P => {for (let x = 0; x < P.w; x += .5) {P.rect(x, 0, .5, P.h, shade(0xd4d4d4, .94 + rand() * .06), 1, .45);P.rect(x + .47, 0, .03, P.h, '#f4f4f4', 1, .9);P.rect(x + .5 - .005, 0, .01, P.h, '#7a7a7a', 1, .2);}P.noise(.12, 1.2, ['#9a9a9a', '#ffffff'], 1200);});
    paintCell('roofFlat', P => {P.rect(0, 0, P.w, P.h, '#c4c4c0', 1, .5);P.noise(.4, 1.6, ['#8f8f8c', '#f4f4f0', '#b5b5b0'], 9000);for (let y = 0; y < P.h; y += 1) P.rect(0, y, P.w, .02, '#a4a4a0', 1, .45);});
    paintCell('roofSlate', P => {P.rect(0, 0, P.w, P.h, '#9a9c9e', 1, .4);for (let r = 0; r < 10; r++) for (let k = -1; k < 8; k++) {const x = (k + (r % 2) * .5) * .3, y = r * .2;P.rect(x + .008, y, .284, .19, shade(0xcfd1d3, .85 + rand() * .2), 1, .5 + rand() * .2);}});
    // Combine colour + mask into one RGBA texture (no canvas alpha, so the colours under glass stay exact), and the normal map.
    // Each cell's average colour: the part that keeps its own colour (avg0) and the part that takes the tint (avg1), in linear light.
    const lin = v => {v /= 255;return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);}, linLut = new Float32Array(256);for (let i = 0; i < 256; i++) linLut[i] = lin(i);
    const sm = (a, b, x) => {const t = Math.max(0, Math.min(1, (x - a) / (b - a)));return t * t * (3 - 2 * t);};
    const avg0 = [], avg1 = [];
    for (let c = 0; c < COLS * (AH / SLOT); c++) {
      const ox = (c % COLS) * SLOT + PAD, oy = Math.floor(c / COLS) * SLOT + PAD, a0 = [0, 0, 0], a1 = [0, 0, 0];let n = 0;
      for (let y = 0; y < CONTENT; y += 2) for (let x = 0; x < CONTENT; x += 2) {const i = ((oy + y) * AW + ox + x) * 4, k = sm(.6, .9, data[i + 3] / 255);for (let j = 0; j < 3; j++) {const v = linLut[data[i + j]];a0[j] += v * (1 - k);a1[j] += v * k;}n++;}
      avg0.push(new T.Vector3(a0[0] / n, a0[1] / n, a0[2] / n));avg1.push(new T.Vector3(a1[0] / n, a1[1] / n, a1[2] / n));
    }
    const atlas = new T.DataTexture(data, AW, AH, T.RGBAFormat);atlas.colorSpace = T.SRGBColorSpace;atlas.generateMipmaps = true;atlas.minFilter = T.LinearMipmapLinearFilter;atlas.magFilter = T.LinearFilter;
    atlas.anisotropy = anisotropy;atlas.wrapS = atlas.wrapT = T.ClampToEdgeWrapping;atlas.needsUpdate = true;
    const normal = (() => {
      // Half size: average 2 x 2 height pixels (a box filter, no canvas readback of a blurred copy), then a Sobel-like slope.
      const w = AW / 2, h = AH / 2, hv = new Float32Array(w * h), nd = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {const i = y * 2 * AW + x * 2;hv[y * w + x] = (heights[i] + heights[i + 1] + heights[i + AW] + heights[i + AW + 1]) / 1020;}
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const xl = x ? x - 1 : x, xr = x < w - 1 ? x + 1 : x, yu = y ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
        const dx = (hv[y * w + xr] - hv[y * w + xl]) * 2.2, dy = (hv[yd * w + x] - hv[yu * w + x]) * 2.2, len = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
        nd[i] = (-dx / len * .5 + .5) * 255;nd[i + 1] = (dy / len * .5 + .5) * 255;nd[i + 2] = (1 / len * .5 + .5) * 255;nd[i + 3] = 255;
      }
      const t = new T.DataTexture(nd, w, h, T.RGBAFormat);t.generateMipmaps = true;t.minFilter = T.LinearMipmapLinearFilter;t.magFilter = T.LinearFilter;t.anisotropy = anisotropy;t.wrapS = t.wrapT = T.ClampToEdgeWrapping;t.needsUpdate = true;return t;
    })();
    // The facade shader: atlas cell from the vertex (index, mode, seed), whole-bay UVs, the tint where the mask says so, some
    // variety per window (curtains, blinds, a lit room), shinier glass, and the cell's average colour far away instead of shimmer.
    const CELL_GLSL = `
      float cityHash(vec2 p){return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);}
      vec2 cityAtlasUv(vec2 uvT, vec3 cell){
        float idx = floor(cell.x + .5);vec2 slot = vec2(mod(idx, ${COLS}.0), floor(idx / ${COLS}.0));
        vec2 f = vec2(fract(uvT.x), cell.y > .5 ? clamp(uvT.y, .002, .998) : fract(uvT.y));
        vec2 px = slot * ${SLOT}.0 + ${PAD}.0 + vec2(f.x, 1.0 - f.y) * ${CONTENT}.0;
        return px / vec2(${AW}.0, ${AH}.0);
      }`;
    function material() {
      const mat = new T.MeshStandardMaterial({map: atlas, normalMap: normal, normalScale: new T.Vector2(.9, .9), roughness: .88, metalness: 0, envMapIntensity: .8});
      mat.onBeforeCompile = sh => {
        sh.uniforms.uAvg0 = {value: avg0};sh.uniforms.uAvg1 = {value: avg1};
        sh.vertexShader = 'attribute vec3 aCell;attribute vec3 aTint;varying vec3 vCell;varying vec3 vTint;varying vec2 vCityUv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvCell = aCell;vTint = aTint;vCityUv = uv;');
        sh.fragmentShader = `uniform vec3 uAvg0[${CELL_LIST.length}];uniform vec3 uAvg1[${CELL_LIST.length}];varying vec3 vCell;varying vec3 vTint;varying vec2 vCityUv;\n${CELL_GLSL}\n` + sh.fragmentShader
          .replace('#include <map_fragment>', `
            vec2 cAuv = cityAtlasUv(vCityUv, vCell);
            vec2 cScale = vec2(${CONTENT}.0 / ${AW}.0, ${CONTENT}.0 / ${AH}.0);
            vec2 cDx = dFdx(vCityUv) * cScale, cDy = dFdy(vCityUv) * cScale;
            float cLod = .5 * log2(max(dot(cDx * vec2(${AW}.0, ${AH}.0), cDx * vec2(${AW}.0, ${AH}.0)), dot(cDy * vec2(${AW}.0, ${AH}.0), cDy * vec2(${AW}.0, ${AH}.0))) + 1e-8);
            float cK = exp2(min(0.0, 3.0 - cLod));cDx *= cK;cDy *= cK;
            vec4 cTex = textureGrad(map, cAuv, cDx, cDy);
            float cTintK = smoothstep(.6, .9, cTex.a), cGlass = 1.0 - smoothstep(.12, .4, cTex.a);
            vec3 cCol = cTex.rgb * mix(vec3(1.0), vTint, cTintK);
            float cH = cityHash(floor(vCityUv) + vCell.z * 61.7);
            vec2 cF = fract(vCityUv);
            if (cGlass > .01 && (vCell.x < 23.5 || vCell.x > 27.5)) {
              // Per window: net curtains, blinds, a lit room or just the reflection.
              vec3 cur = cH < .3 ? mix(cCol, vec3(.55, .52, .47), .55) : cH < .45 ? cCol * (.62 + .38 * step(.5, fract(cF.y * 36.0))) : cH < .5 ? vec3(.5, .36, .2) : cCol;
              cCol = mix(cCol, cur, cGlass);
            }
            int cI = int(floor(vCell.x + .5));
            vec3 cAvg = uAvg0[cI] + uAvg1[cI] * vTint;
            cCol = mix(cCol, cAvg, smoothstep(3.0, 4.5, cLod));
            diffuseColor.rgb *= cCol;`)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, .18, cGlass * (1.0 - smoothstep(3.0, 4.5, cLod)));')
          .replace('#include <normal_fragment_maps>', `
            vec3 mapN = textureGrad(normalMap, cAuv, cDx, cDy).xyz * 2.0 - 1.0;mapN.xy *= normalScale * (1.0 - smoothstep(3.0, 4.5, cLod));
            normal = normalize(tbn * mapN);`);
      };
      mat.customProgramCacheKey = () => 'city-facade-v1';
      return mat;
    }
    // Far away (beyond the near pass) buildings are vertex-coloured with the same average colours.
    function farColour(cell, tint) {
      const i = CELLS[cell].i, t = new T.Color(tint);// t is linear after the colour management conversion
      return new T.Color(avg0[i].x + avg1[i].x * t.r, avg0[i].y + avg1[i].y * t.g, avg0[i].z + avg1[i].z * t.b);
    }

    // ---------- Ground detail ----------
    // R grass blades and clumps, G asphalt aggregate with cracks and patches, B paving slabs with joints, A gravel and soil.
    const GS = 1024, gR = new Float32Array(GS * GS).fill(.5), gG = new Float32Array(GS * GS).fill(.5), gB = new Float32Array(GS * GS).fill(.5), gA = new Float32Array(GS * GS).fill(.5);
    const wrap = v => ((v % GS) + GS) % GS, put = (arr, x, y, v, a = 1) => {const i = wrap(Math.round(y)) * GS + wrap(Math.round(x));arr[i] += (v - arr[i]) * a;};
    const blob = (arr, x0, y0, r, v, a) => {for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {const d = (x * x + y * y) / (r * r);if (d <= 1) put(arr, x0 + x, y0 + y, v, a * (1 - d));}};
    // Grass: soft clumps, then thousands of short blades.
    for (let i = 0; i < 90; i++) blob(gR, rand() * GS, rand() * GS, 24 + rand() * 50, rand() < .5 ? .34 : .66, .4);
    for (let i = 0; i < 300; i++) blob(gR, rand() * GS, rand() * GS, 6 + rand() * 14, rand() < .5 ? .3 : .7, .35);
    // Blades of 2-5 cm, dark at the root and light at the tip, leaning in about the same direction like mown grass.
    for (let i = 0; i < 16000; i++) {
      const x = rand() * GS, y = rand() * GS, a = -1.2 + rand() * 2.4 + (rand() < .5 ? 0 : Math.PI), len = 10 + rand() * 18, v = .25 + rand() * .7;
      for (let t = 0; t < len; t++) {const k = t / len, px = x + Math.cos(a) * t, py = y + Math.sin(a) * t;put(gR, px, py, v * (.55 + .45 * k), .6);if (k < .5) put(gR, px + 1, py, v * .6, .3);}
    }
    // Asphalt: fine grain, stones, a few repaired patches and thin cracks.
    for (let i = 0; i < gG.length; i++) gG[i] = .5 + (rand() - .5) * .22;
    for (let i = 0; i < 9; i++) {const x0 = rand() * GS, y0 = rand() * GS, w = 80 + rand() * 220, h = 60 + rand() * 160, v = rand() < .5 ? .4 : .58;for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(gG, x0 + x, y0 + y, v, .35);}
    for (let i = 0; i < 9000; i++) blob(gG, rand() * GS, rand() * GS, 1 + rand() * 1.6, rand() < .55 ? .78 : .22, .7);
    for (let i = 0; i < 14; i++) {let x = rand() * GS, y = rand() * GS, a = rand() * 6.28;for (let t = 0; t < 120 + rand() * 260; t++) {a += (rand() - .5) * .5;x += Math.cos(a);y += Math.sin(a);put(gG, x, y, .12, .8);}}
    // Paving: granite slabs of about 60 x 45 cm in a running bond (1024 px = 1.8 m), each a little different, dark joints.
    {
      const cols = 3, rows = 4, sw = GS / cols, sh = GS / rows;
      for (let r = 0; r < rows; r++) for (let k = 0; k <= cols; k++) {
        const x0 = (k + (r % 2) * .5) * sw, y0 = r * sh, tone = .42 + rand() * .22;
        for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {const edge = Math.min(x, y, sw - 1 - x, sh - 1 - y);put(gB, x0 + x, y0 + y, edge < 3 ? .3 : edge < 6 ? tone * .88 : tone + (rand() - .5) * .1, 1);}
      }
      for (let i = 0; i < 6000; i++) blob(gB, rand() * GS, rand() * GS, 1 + rand(), rand() < .5 ? .7 : .35, .4);
    }
    // Gravel: pebbles with a shadowed side on mottled soil.
    for (let i = 0; i < 200; i++) blob(gA, rand() * GS, rand() * GS, 8 + rand() * 20, rand() < .5 ? .4 : .58, .3);
    for (let i = 0; i < 16000; i++) {const x = rand() * GS, y = rand() * GS, r = 1.5 + rand() * 3.2, v = .35 + rand() * .55;blob(gA, x + 1, y + 1, r, .15, .5);blob(gA, x, y, r, v, .85);}
    const gData = new Uint8Array(GS * GS * 4);
    for (let i = 0; i < GS * GS; i++) {gData[i * 4] = Math.max(0, Math.min(255, gR[i] * 255));gData[i * 4 + 1] = Math.max(0, Math.min(255, gG[i] * 255));gData[i * 4 + 2] = Math.max(0, Math.min(255, gB[i] * 255));gData[i * 4 + 3] = Math.max(0, Math.min(255, gA[i] * 255));}
    const detail = new T.DataTexture(gData, GS, GS, T.RGBAFormat);detail.wrapS = detail.wrapT = T.RepeatWrapping;detail.generateMipmaps = true;detail.minFilter = T.LinearMipmapLinearFilter;detail.magFilter = T.LinearFilter;detail.anisotropy = anisotropy;detail.needsUpdate = true;
    const groundU = {uDetail: {value: detail}, uPhoto: {value: 0}};
    // The terrain shader: the painting or photo gives the colour; under it the detail of the surface it looks like, at two scales
    // (rotated, so the 1.8 m tile never lines up), a large-scale noise against tiling, worn spots and rock on steep slopes, and
    // a little relief that catches the sun. Detail fades out with distance (the mipmaps would average it away anyway).
    function ground(mat) {
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, groundU);
        sh.vertexShader = 'varying vec2 vGround;varying float vSlope;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz;vSlope = 1.0 - normalize(objectNormal).y;');
        sh.fragmentShader = `uniform sampler2D uDetail;uniform float uPhoto;varying vec2 vGround;varying float vSlope;
          float gHash(vec2 p){return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);}
          float gNoise(vec2 p){vec2 i = floor(p), f = fract(p);f = f * f * (3.0 - 2.0 * f);return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);}
          vec3 gPerturb(vec3 pos, vec3 n, vec2 dh){vec3 sx = dFdx(pos), sy = dFdy(pos), r1 = cross(sy, n), r2 = cross(n, sx);float det = dot(sx, r1);vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);return normalize(abs(det) * n - g);}
          ` + sh.fragmentShader
          .replace('#include <map_fragment>', `
            vec4 gTexel = texture2D(map, vMapUv);
            vec3 gMacro = gTexel.rgb;
            vec3 gs = sqrt(gMacro);
            float gLum = dot(gs, vec3(.3, .59, .11)), gGreen = gs.g - max(gs.r, gs.b), gWarm = gs.r - gs.b;
            // What the texel is (issue #98, surroundings.js streetClasses): alpha 1 other ground, .85 pavement, .7 kerb, .55 road.
            float cRoad = 1.0 - smoothstep(.6, .64, gTexel.a), cKerb = smoothstep(.6, .64, gTexel.a) * (1.0 - smoothstep(.75, .79, gTexel.a));
            float cPave = smoothstep(.75, .79, gTexel.a) * (1.0 - smoothstep(.91, .95, gTexel.a)), cOther = 1.0 - cRoad - cKerb - cPave;
            float wGrass = cOther * smoothstep(.012, .055, gGreen);
            float wDirt = (cOther - wGrass) * smoothstep(.035, .1, gWarm);
            // Other grey ground: dark = asphalt, light = paving slabs in the map painting. The photo is brightened, so there grey is all
            // asphalt (its squares and yards look alike from the air; a slab pattern on asphalt would be worse than none on slabs).
            float wNeutral = cOther - wGrass - wDirt;
            float gSlab = smoothstep(.5, .58, gLum);// a pavement is slabs where it is painted light (Grünerløkka), else asphalt
            float wAsph = wNeutral * mix(1.0 - smoothstep(.43, .56, gLum), 1.0, uPhoto) + cRoad + cPave * (1.0 - gSlab);
            float wPave = wNeutral * (1.0 - mix(1.0 - smoothstep(.43, .56, gLum), 1.0, uPhoto)) + cPave * gSlab;
            float gDist = length(vViewPosition), gNear = 1.0 - smoothstep(35.0, 140.0, gDist), gMid = 1.0 - smoothstep(120.0, 520.0, gDist);
            vec2 gp = vGround;
            vec4 d1 = texture2D(uDetail, gp * .5556);
            vec4 d2 = texture2D(uDetail, mat2(.8, -.6, .6, .8) * gp * .17 + .37);
            float n0 = gNoise(gp * .37 + 1.7), n1 = gNoise(gp * .09), n2 = gNoise(gp * .023 + 7.3), n3 = gNoise(gp * .006 + 3.1);
            float big = (n2 - .5) * .2 + (n3 - .5) * .14;
            vec3 gCol = gMacro * (1.0 + big * (1.0 - .55 * uPhoto));
            // Grass: blades near, clumps further, dry and lush patches.
            float grassD = mix(.5, d1.r, gNear) * .6 + mix(.5, d2.r, gMid) * .4;
            // Light tips are yellower, shaded roots bluer: hue as well as brightness.
            vec3 grass = gCol * mix(vec3(.66, .74, .86), vec3(1.3, 1.24, .9), grassD) * (1.0 + (n0 - .5) * .28 * gMid);
            grass = mix(grass, grass * vec3(1.18, 1.06, .72), smoothstep(.55, .85, n1 * .6 + d2.r * .4) * .5 * gMid);
            float worn = smoothstep(.70, .86, n1 * .55 + d2.a * .45) * gMid + smoothstep(.22, .45, vSlope);
            vec3 soil = vec3(.13, .10, .07) * (.7 + d1.a * .6);
            grass = mix(grass, mix(soil, vec3(.24, .23, .22) * (.6 + d1.a * .7), smoothstep(.35, .6, vSlope)), min(.75, worn * .6));
            // The photo is brightened for its shadows; its asphalt would look like concrete, so it is taken down again.
            vec3 asph = gCol * mix(1.0, .7, uPhoto * cOther) * (1.0 + (mix(.5, d1.g, gNear) - .5) * 1.1 + (mix(.5, d2.g, gMid) - .5) * .55 + (n0 - .5) * .12 * gMid);
            vec3 pave = gCol * (1.0 + (mix(.5, d1.b, 1.0 - smoothstep(25.0, 90.0, gDist)) - .5) * .6 + (mix(.5, d2.g, gMid) - .5) * .2);
            vec3 dirt = gCol * (1.0 + (mix(.5, d1.a, gNear) - .5) * .9 + (mix(.5, d2.a, gMid) - .5) * .4);
            // The granite kerb: light stone with a fine grain; its band stands up in the relief, so its edges catch the light.
            vec3 kerb = gCol * (1.0 + (mix(.5, d1.a, gNear) - .5) * .35 + (n0 - .5) * .06);
            gCol = grass * wGrass + asph * wAsph + pave * wPave + dirt * wDirt + kerb * cKerb;
            float gHeight = (d1.r * wGrass * .7 + d1.g * wAsph * .25 + d1.b * wPave * 1.0 + d1.a * wDirt * .9 + (1.2 + d1.a * .3) * cKerb) * gNear;
            diffuseColor.rgb *= gCol;`)
          .replace('#include <normal_fragment_maps>', `
            #include <normal_fragment_maps>
            normal = gPerturb(-vViewPosition, normal, vec2(dFdx(gHeight), dFdy(gHeight)) * .045);`)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness - wAsph * .08 * gNear;');
      };
      mat.customProgramCacheKey = () => 'city-ground-v2';
      return mat;
    }
    const bytes = {atlas: AW * AH * 4 * 4 / 3, normal: AW * AH / 4 * 4 * 4 / 3, ground: GS * GS * 4 * 4 / 3};
    instance = {atlas, normal, detail, material, farColour, ground, setPhoto: on => {groundU.uPhoto.value = on ? 1 : 0;}, bytes, CELLS, cellCanvas: name => cellCanvases.get(name)};
    return instance;
  }

  return {CELLS, CELL_LIST, zoneAt, classify, wallBands, shopLook, edgeU, looksOf, parseColour, hash, hashXY, create};
});
