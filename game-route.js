/* The Ensjø -> Rathkes gate run (issue #38: "I also need to practice the most effective way from Ensjø to Rathkes!").
 * A green ring outside Ensjø T-bane starts the clock (□); it stops when you reach the chequered ring in Rathkes gate, on foot,
 * by bike, car or air: any way you like. Your best time is kept in this browser (localStorage haarklous-route-v1).
 * At the finish, □ takes you back to the start for another try. The HUD shows the time, the straight-line distance left
 * and your best.
 * GameRoute.create({T, lib, route, toWorld, heightAt, root, sound(name), onFinish(seconds, best, isBest), teleport({x, y, z})})
 *   -> {group, prompt(player), tick(player, dt), poi(), begin(), running, t, best, runs, start {x, y, z}, finish {x, y, z}}
 *   (player: {x, z, feet, mode}; route: {start: {name, at: [x, s]}, finish: {...}})
 */
(function (root, factory) {
  root.GameRoute = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const KEY = 'haarklous-route-v1', RING = 3.2, fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  function create({T, lib, route, toWorld, heightAt, root, sound = () => {}, onFinish = () => {}, teleport = () => {}}) {
    const group = new T.Group();group.name = 'Route Ensjø – Rathkes gate';
    const where = p => {const w = toWorld(p.at[0], p.at[1]);return {x: w.x, z: w.z, y: heightAt(w.x, w.z)};};
    const A = where(route.start), B = where(route.finish);
    const sign = (lines, bg, fg) => {
      const c = document.createElement('canvas');c.width = 512;c.height = 256;const x = c.getContext('2d');x.fillStyle = bg;x.fillRect(0, 0, 512, 256);x.strokeStyle = fg;x.lineWidth = 10;x.strokeRect(10, 10, 492, 236);
      x.fillStyle = fg;x.textAlign = 'center';lines.forEach(([text, size], i) => {x.font = `bold ${size}px Segoe UI, Arial, sans-serif`;x.fillText(text, 256, 70 + i * 66 + (i ? 10 : 0));});
      const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;return new T.Mesh(new T.PlaneGeometry(1.2, .6), new T.MeshStandardMaterial({map: tex, side: T.DoubleSide, roughness: .6}));
    };
    function marker(at, color, lines, bg, chequered) {
      const g = new T.Group();g.position.set(at.x, at.y, at.z);group.add(g);
      const ring = new T.Mesh(new T.TorusGeometry(RING, .08, 8, 64), new T.MeshStandardMaterial({color, emissive: color, emissiveIntensity: .7}));ring.rotation.x = -Math.PI / 2;ring.position.y = .05;g.add(ring);
      const post = new T.Mesh(new T.CylinderGeometry(.05, .05, 2.2, 10), lib.metal(0x5c6166, .4));post.position.set(0, 1.1, -RING - .2);post.castShadow = true;g.add(post);
      const s = sign(lines, bg, '#fff');s.position.set(0, 2.15, -RING - .2);s.castShadow = true;g.add(s);
      if (chequered) {
        const c = document.createElement('canvas');c.width = c.height = 64;const x = c.getContext('2d');for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {x.fillStyle = (i + j) % 2 ? '#111' : '#fff';x.fillRect(i * 8, j * 8, 8, 8);}
        const tex = new T.CanvasTexture(c);tex.magFilter = T.NearestFilter;const flag = new T.Mesh(new T.PlaneGeometry(.9, .6), new T.MeshStandardMaterial({map: tex, side: T.DoubleSide}));flag.position.set(.5, 2.85, -RING - .2);g.add(flag);
        const pole = new T.Mesh(new T.CylinderGeometry(.03, .03, 1, 8), lib.metal(0x5c6166, .4));pole.position.set(.05, 2.7, -RING - .2);g.add(pole);
      }
      return g;
    }
    marker(A, 0x2e9d4b, [['ENSJØ → RATHKES GATE', 40], ['Stand in the ring', 34], ['□ start the clock', 34]], '#1d6b34');
    marker(B, 0xf2f2f2, [['RATHKES GATE', 54], ['Finish of the run', 34], ['from Ensjø T-bane', 34]], '#222', true);
    let saved;
    const load = () => {saved = {best: null, runs: 0};try {saved = {...saved, ...JSON.parse(localStorage.getItem(KEY) || '{}')};} catch {}};
    load();window.addEventListener('haarklous-progress', load);// an account's saved progress was loaded (issue #54)
    const save = () => {try {localStorage.setItem(KEY, JSON.stringify(saved));} catch {}};
    const hud = document.createElement('div');hud.id = 'routeHud';hud.className = 'game-card';hud.hidden = true;root.append(hud);
    const api = {group, running: false, t: 0, get best() {return saved.best;}, get runs() {return saved.runs;}, start: {...A}, finish: {...B}};
    const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z), at = (p, q) => dist(p, q) < RING && Math.abs((p.feet ?? q.y) - q.y) < 4;
    api.begin = () => {api.running = true;api.t = 0;sound('whistle');};
    api.end = () => {
      api.running = false;saved.runs++;const best = saved.best === null || api.t < saved.best;if (best) saved.best = api.t;save();
      sound('whistle');onFinish(api.t, saved.best, best);
    };
    api.prompt = player => {
      if (at(player, A)) return {text: api.running ? `□ Restart the run (now ${fmt(api.t)})` : `□ Start the run: Ensjø → Rathkes gate${saved.best !== null ? ` · best ${fmt(saved.best)}` : ''}`, act: () => api.begin()};
      if (!api.running && at(player, B) && player.mode === 'foot') return {text: '□ Back to the start at Ensjø T-bane (try again)', act: () => teleport(A)};
      return null;
    };
    api.tick = (player, dt) => {
      if (api.running) {
        api.t += dt;
        if (at(player, B)) api.end();
        else if (api.t > 3600) api.running = false;// an hour: given up
      }
      hud.hidden = !api.running;
      if (api.running) hud.innerHTML = `<b>Ensjø → Rathkes gate · ${fmt(api.t)}</b><span>${Math.round(dist(player, B))} m to the finish (straight line)${saved.best !== null ? ` · best ${fmt(saved.best)}` : ''}</span><small>Any way counts: run, ride or drive · □ in the green ring restarts</small>`;
    };
    api.poi = () => [{x: route.start.at[0], s: route.start.at[1], color: '#2e9d4b', label: 'Run start: Ensjø T-bane', glyph: '▶'}, {x: route.finish.at[0], s: route.finish.at[1], color: '#222', label: 'Run finish: Rathkes gate', glyph: '⚑'}];
    api.format = fmt;
    return api;
  }
  return {create, format: fmt};
});
