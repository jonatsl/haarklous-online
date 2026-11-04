// Ground and building textures (issues #67 and #68): which facade a building gets, how its walls are cut into bands, and the
// OpenStreetMap looks data (building-looks-data.js) that feeds it.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
global.window = globalThis;
const CT = require(path.join(__dirname, '..', 'city-textures.js'));
require(path.join(__dirname, '..', 'surroundings-data.js'));
require(path.join(__dirname, '..', 'gamle-oslo-data.js'));
require(path.join(__dirname, '..', 'myrens-data.js'));
require(path.join(__dirname, '..', 'building-looks-data.js'));
const District = require(path.join(__dirname, '..', 'district.js'));
const D = window.SURROUNDINGS, DISTRICTS = window.DISTRICTS.map(d => District.decode(d));

test('known places fall in the right part of town', () => {
  const at = {torshov: [0, 0], lokka: [-970, 1500], gronland: [-744, 2672], toyen: [-148, 2382], kampen: [213, 2594], ensjo: [565, 2561], bjorvika: [-600, 3800]};
  for (const [zone, [x, s]] of Object.entries(at)) assert.strictEqual(CT.zoneAt(x, s), zone, `${x}, ${s}`);
  assert.strictEqual(CT.zoneAt(559, 3017), 'kampen', 'Vålerenga is like Kampen');
});

test('every look uses cells that exist in the atlas', () => {
  const styles = ['brick', 'plaster', 'shed', 'modern', 'industrial'], kinds = ['', 'apartments', 'house', 'garage', 'school', 'office', 'retail', 'warehouse', 'terrace', 'church'];
  for (let seed = 1; seed < 400; seed++) {
    const L = CT.classify({style: styles[seed % 5], kind: kinds[seed % kinds.length], h: 3 + (seed % 40), x: (seed * 37) % 2000 - 1000, s: (seed * 91) % 4200 - 200, seed});
    for (const k of ['upper', 'ground', 'plinth', 'top', 'roof', 'shopCell']) if (L[k]) assert.ok(CT.CELLS[L[k]], `${L.cls} ${k} ${L[k]}`);
    assert.ok(Number.isInteger(L.tint) && Number.isInteger(L.roofTint), L.cls);
    const S = CT.shopLook(L);if (S.shopCell) assert.ok(CT.CELLS[S.shopCell]);
  }
});

test('what OpenStreetMap says wins: kind, year, colour, material and roof colour', () => {
  const at = (o, x = -970, s = 1500) => CT.classify({style: 'brick', h: 16, x, s, seed: 7, ...o});
  assert.strictEqual(at({kind: 'house', h: 7}).cls, 'house');
  assert.strictEqual(at({kind: 'garage', h: 3}).cls, 'shed');
  assert.strictEqual(at({year: 1890}).cls, 'tenement');
  assert.strictEqual(at({year: 1925}, 0, 0).cls, 'hals');
  assert.strictEqual(at({year: 1965}).cls, 'concrete60');
  assert.strictEqual(at({year: 2012}).cls, 'newBlock');
  assert.strictEqual(at({material: 'brick'}, 0, 0).cls, 'torshovBrick');
  // Torshov mappers tag the brick blocks reddish (#cb9c89) and the plastered ones yellow (#e5d3aa); a plaster colour is used as the tint.
  assert.strictEqual(at({colour: '#cb9c89'}, -69, 57).cls, 'torshovBrick');
  const yellow = at({colour: '#e5d3aa'}, -140, -70);
  assert.ok(['hals', 'func'].includes(yellow.cls));assert.strictEqual(yellow.tint, 0xe5d3aa);
  assert.strictEqual(at({roofColour: '#a76362'}, -140, -70).roofTint, 0xa76362);
  const kept = CT.classify({style: 'brick', h: 14, x: 0, s: 0, seed: 3, keep: 'brick'});
  assert.strictEqual(kept.upper, 'brick', 'the shop and stair-tower buildings keep the brick of lib.facade');
  assert.strictEqual(kept.shops, false, 'Joker and Kiwi are modelled, so no painted shop front there');
  assert.strictEqual(at({}).shops, true);assert.strictEqual(at({kind: 'garage', h: 3}).shops, false);
});

test('the districts get their own mix: tenements in Grünerløkka, new blocks at Ensjø, brick and plaster in Torshov', () => {
  const share = (x0, s0, cls, n = 300) => {let k = 0;for (let i = 0; i < n; i++) if (CT.classify({style: 'brick', kind: 'apartments', h: 16, x: x0 + (i % 20) * 37, s: s0 + Math.floor(i / 20) * 41, seed: i + 1}).cls === cls) k++;return k / n;};
  assert.ok(share(-1200, 900, 'tenement') > .6, 'Grünerløkka');
  assert.ok(share(500, 1950, 'newBlock') > .45, 'Ensjø');
  const torshov = ['torshovBrick', 'hals', 'func'].map(c => share(-600, -400, c));
  assert.ok(torshov.every(v => v > .1), `Torshov has all three: ${torshov}`);
});

test('wall bands run from the bottom to the top without gaps or overlaps (no coplanar faces), in whole storeys', () => {
  for (let seed = 1; seed < 300; seed++) {
    const h = 2.5 + (seed % 30), L = CT.classify({style: ['brick', 'plaster', 'shed'][seed % 3], kind: seed % 7 ? 'apartments' : 'retail', h, x: (seed * 53) % 1600 - 800, s: (seed * 71) % 3000, seed});
    for (const look of [L, CT.shopLook(L)]) for (const shop of [false, true]) {
      const g0 = 10, bottom = 9.2, top = g0 + h, bands = CT.wallBands(look, g0, bottom, top, shop);
      assert.ok(bands.length > 0);
      assert.ok(Math.abs(bands[0].y0 - bottom) < 1e-9, 'starts at the bottom');
      assert.ok(Math.abs(bands[bands.length - 1].y1 - top) < 1e-9, 'ends at the top');
      for (let i = 1; i < bands.length; i++) assert.ok(Math.abs(bands[i].y0 - bands[i - 1].y1) < 1e-9, `band ${i} touches the one below`);
      for (const b of bands) {
        assert.ok(b.y1 > b.y0 && CT.CELLS[b.cell]);
        if (b.mode === 0) {const n = b.v1 - b.v0, storey = (b.y1 - b.y0) / n, nominal = CT.CELLS[b.cell].h;assert.ok(storey > nominal * .5 && storey < nominal * 1.7, `${b.cell} storey ${storey}`);}
      }
      if (shop && look.shopCell && look.groundH && h > 7) assert.strictEqual(bands[0].cell, look.shopCell, 'a shop front starts at the street');
    }
  }
});

test('walls get whole bays, short edges only plain wall', () => {
  assert.strictEqual(CT.edgeU(12, 3), 4);
  assert.strictEqual(CT.edgeU(13.4, 3), 4);
  assert.strictEqual(CT.edgeU(2, 3), 1);
  assert.ok(CT.edgeU(1, 3) < .12);
});

test('building-looks-data.js matches the game world', () => {
  const raw = window.BUILDING_LOOKS, looks = CT.looksOf(raw);
  assert.strictEqual(raw.old.length, 2 * D.buildings.length, 'one code pair per old building');
  // The old square's colour tags came through (the generator kept them as b.c).
  let agree = 0, tagged = 0;D.buildings.forEach((b, i) => {if (!b.c) return;tagged++;if ((looks.old(i) || {}).colour === b.c) agree++;});
  assert.ok(tagged > 50 && agree / tagged > .9, `${agree}/${tagged}`);
  // District buildings are found by OSM id; houses and schools there have their kind.
  const ids = DISTRICTS.flatMap(d => d.buildings.map(b => b.id)), found = ids.filter(id => looks.byId(id));
  assert.ok(found.length > 4000, `${found.length} district buildings have looks`);
  const kinds = new Set(found.map(id => looks.byId(id).kind));
  for (const k of ['house', 'school', 'office', 'retail']) assert.ok(kinds.has(k), k);
  // Shops are ground-floor points inside the game area.
  assert.ok(raw.shops.length / 2 > 1000);
  for (let i = 0; i < raw.shops.length; i += 2) assert.ok(raw.shops[i] > -1700 && raw.shops[i] < 1900 && raw.shops[i + 1] > -900 && raw.shops[i + 1] < 4100);
});

test('colour tags are read as OSM writes them', () => {
  assert.strictEqual(CT.parseColour('#cb9c89'), 0xcb9c89);
  assert.strictEqual(CT.parseColour('#E96B39'), 0xe96b39);
  assert.strictEqual(CT.parseColour('#abc'), 0xaabbcc);
  assert.ok(CT.parseColour('grey') != null && CT.parseColour('darkgrey') != null);
  assert.strictEqual(CT.parseColour('rainbow'), null);
  assert.strictEqual(CT.parseColour(undefined), null);
});
