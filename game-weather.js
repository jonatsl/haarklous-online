/* Real weather (issue #23): MET Norway's forecast for Haarklous plass (Locationforecast 2.0 complete), fetched through the
 * game's own Cloudflare Worker (/weather adds the User-Agent MET asks for and caches the answer for everybody) when the game
 * starts and then every hour plus a random 0–10 minutes. The hour now is the last forecast entry that has started.
 * Credit: "Weather: data from MET Norway (CC BY 4.0)".
 *
 * GameWeather.parse(json, nowMs) -> state | null   (pure, Node-tested)
 *   state: {time, temp °C, wind m/s, windFrom °, gust, clouds 0..1, fog 0..1, humidity %, precip mm/h, symbol,
 *           kind 'clear'|'fair'|'partly'|'cloudy'|'fog'|'rain'|'sleet'|'snow', intensity 0..1, thunder, updatedAt, fetchedAt}
 * GameWeather.classify(symbol, precip) -> {kind, intensity, thunder}   (pure)
 * GameWeather.describe(state) -> e.g. "7.9 °C · partly cloudy · wind 4.6 m/s from NNE"
 * GameWeather.create({T, url, onChange}) -> {state, group (precipitation), load(), update(dt, camera, {indoor, windWorld})}
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameWeather = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const clamp01 = v => Math.max(0, Math.min(1, v));
  // MET symbol codes (github.com/metno/weathericons): strip _day/_night/_polartwilight, then read the words.
  function classify(symbol, precip = 0) {
    const s = String(symbol || '').trim().replace(/_(day|night|polartwilight)$/, '');
    const thunder = s.includes('thunder');
    const amount = s.startsWith('heavy') ? .95 : s.startsWith('light') ? .35 : .65;
    const intensity = clamp01(Math.max(amount * (s.includes('showers') ? .85 : 1), Math.min(1, (precip || 0) / 4)));
    if (s.includes('snow')) return {kind: 'snow', intensity, thunder};
    if (s.includes('sleet')) return {kind: 'sleet', intensity, thunder};
    if (s.includes('rain')) return {kind: 'rain', intensity, thunder};
    if (s === 'fog') return {kind: 'fog', intensity: 0, thunder};
    if (s === 'cloudy') return {kind: 'cloudy', intensity: 0, thunder};
    if (s === 'partlycloudy') return {kind: 'partly', intensity: 0, thunder};
    if (s === 'fair') return {kind: 'fair', intensity: 0, thunder};
    return {kind: 'clear', intensity: 0, thunder};
  }
  function parse(json, nowMs = Date.now()) {
    const ts = json && json.timeseries;if (!Array.isArray(ts) || !ts.length) return null;
    let e = ts[0];for (const t of ts) if (Date.parse(t.time) <= nowMs) e = t;
    const d = (e.data && e.data.instant && e.data.instant.details) || {}, n1 = (e.data && (e.data.next_1_hours || e.data.next_6_hours)) || {};
    const symbol = (n1.summary && n1.summary.symbol_code) || 'cloudy', precip = (n1.details && n1.details.precipitation_amount) || 0;
    const c = classify(symbol, precip);
    return {time: e.time, temp: d.air_temperature, wind: d.wind_speed || 0, windFrom: d.wind_from_direction || 0, gust: d.wind_speed_of_gust,
      clouds: clamp01((d.cloud_area_fraction ?? 50) / 100), fog: clamp01((d.fog_area_fraction || 0) / 100), humidity: d.relative_humidity,
      precip, symbol, ...c, updatedAt: json.updated_at, fetchedAt: json.fetched_at};
  }
  const NAMES = {clear: 'clear sky', fair: 'fair', partly: 'partly cloudy', cloudy: 'cloudy', fog: 'fog', rain: 'rain', sleet: 'sleet', snow: 'snow'};
  const compass = deg => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  function describe(w) {
    if (!w) return 'No weather data';
    const what = (w.intensity > .8 && ['rain', 'sleet', 'snow'].includes(w.kind) ? 'heavy ' : w.intensity < .4 && ['rain', 'sleet', 'snow'].includes(w.kind) ? 'light ' : '') + NAMES[w.kind] + (w.thunder ? ' and thunder' : '');
    return `${w.temp != null ? w.temp.toFixed(1) + ' °C · ' : ''}${what} · wind ${w.wind.toFixed(1)} m/s from ${compass(w.windFrom)}`;
  }

  function create({T, url, onChange = () => {}}) {
    const api = {state: null, group: new T.Group(), error: null};api.group.name = 'Weather (precipitation)';
    // Precipitation: a 30 m box of drops that follows the camera. Rain = short streaks along the fall, snow / sleet = flakes.
    const N = 7000, BOX = 30, HALF = BOX / 2, pos = new Float32Array(N * 3), seg = new Float32Array(N * 6), rnd = () => Math.random();
    for (let i = 0; i < N; i++) {pos[i * 3] = (rnd() - .5) * BOX;pos[i * 3 + 1] = rnd() * BOX - 6;pos[i * 3 + 2] = (rnd() - .5) * BOX;}
    const rainGeo = new T.BufferGeometry();rainGeo.setAttribute('position', new T.BufferAttribute(seg, 3));
    const rain = new T.LineSegments(rainGeo, new T.LineBasicMaterial({color: 0xb8c4d0, transparent: true, opacity: .6, depthWrite: false}));
    const flakeGeo = new T.BufferGeometry();flakeGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
    const dot = document.createElement('canvas');dot.width = dot.height = 32;{const x = dot.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);gr.addColorStop(0, 'rgba(255,255,255,1)');gr.addColorStop(.5, 'rgba(255,255,255,.8)');gr.addColorStop(1, 'rgba(255,255,255,0)');x.fillStyle = gr;x.fillRect(0, 0, 32, 32);}
    const flakes = new T.Points(flakeGeo, new T.PointsMaterial({color: 0xffffff, size: .09, map: new T.CanvasTexture(dot), transparent: true, opacity: .95, depthWrite: false}));// round, soft flakes
    for (const m of [rain, flakes]) {m.frustumCulled = false;m.visible = false;api.group.add(m);}
    let refreshT = null;
    async function load() {
      try {
        const r = await fetch(url, {cache: 'no-store'});if (!r.ok) throw new Error('HTTP ' + r.status);
        api.json = await r.json();api.state = parse(api.json);api.error = null;onChange(api.state);
      } catch (e) {api.error = String(e.message || e);}
      clearTimeout(refreshT);refreshT = setTimeout(load, (60 + Math.random() * 10) * 60e3);// every hour, never on the dot
    }
    // The forecast steps on every hour by itself (the cached answer holds six hours).
    let hourCheck = 0;
    api.update = (dt, camera, {indoor = false, windWorld = {x: 0, z: 0}} = {}) => {
      if (api.json && (hourCheck -= dt) <= 0) {hourCheck = 30;const s = parse(api.json);if (s && api.state && s.time !== api.state.time) {api.state = s;onChange(s);}}
      const w = api.state, kind = w && w.kind, wet = !indoor && w && ['rain', 'sleet', 'snow'].includes(kind) && w.intensity > 0;
      rain.visible = !!wet && kind !== 'snow';flakes.visible = !!wet && kind !== 'rain';if (!wet) return;
      const count = Math.round(N * (.15 + .85 * w.intensity)), c = camera.position;
      const fall = kind === 'rain' ? 8.5 : kind === 'sleet' ? 4.5 : 1.1, drift = kind === 'snow' ? .55 : .9;
      const vx = windWorld.x * drift, vz = windWorld.z * drift, len = kind === 'rain' ? .07 : 0;
      for (let i = 0; i < N; i++) {
        let x = pos[i * 3] + vx * dt, y = pos[i * 3 + 1] - fall * dt, z = pos[i * 3 + 2] + vz * dt;
        if (kind === 'snow') {x += Math.sin(y * 1.7 + i) * .3 * dt;z += Math.cos(y * 1.3 + i) * .3 * dt;}
        if (y < -6) y += BOX;x = ((x + HALF) % BOX + BOX) % BOX - HALF;z = ((z + HALF) % BOX + BOX) % BOX - HALF;
        pos[i * 3] = x;pos[i * 3 + 1] = y;pos[i * 3 + 2] = z;
        const k = i * 6;seg[k] = x;seg[k + 1] = y;seg[k + 2] = z;seg[k + 3] = x - vx * len;seg[k + 4] = y + fall * len;seg[k + 5] = z - vz * len;
      }
      rainGeo.setDrawRange(0, count * 2);flakeGeo.setDrawRange(0, kind === 'sleet' ? Math.round(count * .5) : count);
      rainGeo.attributes.position.needsUpdate = true;flakeGeo.attributes.position.needsUpdate = true;
      api.group.position.set(c.x, c.y, c.z);
    };
    api.load = load;
    return api;
  }
  return {create, parse, classify, describe};
});
