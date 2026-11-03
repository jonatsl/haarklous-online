/* Photo camera: take it out (△ / F), raise it to the eye (L2 / right mouse) for the viewfinder and zoom,
 * take a photo (R2 / left mouse), browse the photos (□ / G opens the gallery, ←/→ or the left stick to scroll,
 * ✕ / Delete twice deletes the photo shown, ○ / Esc closes). Without an account the photos are kept in this browser
 * (IndexedDB), so they are still there next time; logged in, they are in the account's album on the server (issue #54).
 * GameCamera.create({T, lib, audio, root, notice}) -> {active, raised, gallery, photos, toggle(), capture(canvas, place), ...,
 *   local: {all(), remove(id)} (this browser's photos), useAlbum(album | null) -> Promise (null = this browser's photos)}
 *   album: {remote: true, list() -> [{id, place, src}], add({id, data, place}), remove(id)}, see GameProgress.
 */
(function (root, factory) {
  root.GameCamera = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  function create({T, lib, audio, root, notice = () => {}}) {
    const photos = [];let db = null, album = null, deleteArm = 0;
    // This browser's photos (IndexedDB 'haarklous-photos'): always kept, also while an account's album is shown.
    const ready = new Promise(resolve => {
      try {
        const req = indexedDB.open('haarklous-photos', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos', {keyPath: 'id'});
        req.onsuccess = () => {db = req.result;resolve();};req.onerror = () => resolve();
      } catch {resolve();}
    });
    const store = mode => db.transaction('photos', mode).objectStore('photos');
    const asPromise = req => new Promise((ok, no) => {req.onsuccess = () => ok(req.result);req.onerror = () => no(req.error);});
    const local = {
      all: async () => {await ready;return db ? (await asPromise(store('readonly').getAll())).sort((a, b) => a.id - b.id) : [];},
      put: async p => {await ready;if (db) await asPromise(store('readwrite').put({id: p.id, data: p.data, place: p.place}));},
      remove: async id => {await ready;if (db) await asPromise(store('readwrite').delete(id));}
    };
    const show = list => {photos.splice(0, photos.length, ...list);render();};
    local.all().then(list => {if (!album) show(list);}).catch(() => {});
    // Overlay: viewfinder frame and gallery.
    const el = document.createElement('div');el.id = 'photoCam';el.hidden = true;
    el.innerHTML = '<div class="vf"><i></i><i></i><i></i><i></i><b class="focus"></b><span class="vf-info"></span></div><div class="flash"></div><img class="preview" alt=""><div class="gallery" hidden><img alt=""><div class="g-bar"><span class="g-pos"></span><span class="g-date"></span><span class="g-help"></span></div></div><div class="cam-help"></div>';
    root.append(el);
    const $ = s => el.querySelector(s);
    const cam = {active: false, raised: 0, zoom: 1, gallery: false, index: 0, photos};
    // A camera body held in the gloved hands (drawn in the weapon overlay scene).
    const model = new T.Group(), body = lib.polymer(0x1a1b1d), metal = lib.metal(0x3c3f42, .35), glass = new T.MeshStandardMaterial({color: 0x10161c, roughness: .02, metalness: .9});
    const add = (geo, mat, x, y, z) => {const m = new T.Mesh(geo, mat);m.position.set(x, y, z);model.add(m);return m;};
    add(new T.BoxGeometry(.14, .095, .07), body, 0, 0, 0);add(new T.BoxGeometry(.05, .08, .045), body, .055, -.005, -.04);
    const lens = add(new T.CylinderGeometry(.034, .036, .09, 24), metal, -.012, 0, -.075);lens.rotation.x = Math.PI / 2;
    const front = add(new T.CylinderGeometry(.028, .028, .004, 24), glass, -.012, 0, -.122);front.rotation.x = Math.PI / 2;
    add(new T.BoxGeometry(.05, .03, .04), body, -.03, .06, .005);add(new T.CylinderGeometry(.009, .009, .01, 12), metal, .05, .053, -.01);
    const glove = lib.glove();for (const s of [-1, 1]) {const h = add(new T.BoxGeometry(.04, .09, .08), glove, s * .085, -.01, .01);h.rotation.z = s * .1;}
    model.visible = false;
    function render() {
      el.hidden = !cam.active;el.classList.toggle('raised', cam.raised > .5);model.visible = cam.active && cam.raised < .5 && !cam.gallery;
      $('.vf-info').textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'} · ${cam.zoom.toFixed(1)}×`;
      $('.cam-help').textContent = cam.gallery ? '' : 'R2 / left mouse: take photo · L2 / right mouse: viewfinder · right stick up/down: zoom · □ / G: gallery · △ / F: put away';
      $('.g-help').textContent = deleteArm > performance.now() ? 'Press ✕ / Delete again to delete this photo · ○ keep it' : `←/→ browse · ✕ / Delete: delete · ○ close${album ? ' · in your account' : ''}`;
      const g = $('.gallery');g.hidden = !cam.gallery;
      if (cam.gallery) {
        if (!photos.length) {$('.g-pos').textContent = 'No photos yet';$('.gallery img').removeAttribute('src');$('.g-date').textContent = '';return;}
        cam.index = Math.max(0, Math.min(photos.length - 1, cam.index));const p = photos[cam.index];
        $('.gallery img').src = p.data || p.src;$('.g-pos').textContent = `${cam.index + 1} / ${photos.length}`;$('.g-date').textContent = `${new Date(p.id).toLocaleString()}${p.place ? ' · ' + p.place : ''}`;
      }
    }
    cam.model = model;
    cam.toggle = () => {cam.active = !cam.active;cam.gallery = false;cam.raised = 0;cam.zoom = 1;render();};
    cam.openGallery = (open = !cam.gallery) => {cam.gallery = open;if (open) cam.index = photos.length - 1;render();};
    cam.browse = d => {if (!cam.gallery) return;cam.index += d;deleteArm = 0;render();};
    // ✕ / Delete in the gallery: the first press asks, a second one within 3 s deletes (here or in the account's album).
    cam.deleteShown = () => {
      if (!cam.gallery || !photos.length) return;
      if (deleteArm < performance.now()) {deleteArm = performance.now() + 3000;render();setTimeout(render, 3100);return;}
      deleteArm = 0;const p = photos[cam.index];photos.splice(cam.index, 1);render();
      (album ? album.remove(p.id) : local.remove(p.id)).catch(() => {photos.push(p);photos.sort((a, b) => a.id - b.id);render();notice('Could not delete the photo – try again.', 3);});
    };
    cam.cancelDelete = () => {const was = deleteArm > performance.now();deleteArm = 0;render();return was;};
    cam.local = local;
    cam.useAlbum = async a => {album = a || null;deleteArm = 0;cam.index = 0;show(album ? await album.list() : await local.all());};
    Object.defineProperty(cam, 'album', {get: () => album});
    cam.setRaised = r => {const before = cam.raised > .5;cam.raised = r;if (before !== r > .5) render();};
    cam.setZoom = z => {cam.zoom = Math.max(1, Math.min(4, z));render();};
    // Grab the frame that was just rendered (call right after rendering, without the HUD overlays).
    cam.capture = (canvas, place) => {
      const w = 1280, h = Math.round(1280 * canvas.height / canvas.width), c = document.createElement('canvas');c.width = w;c.height = h;c.getContext('2d').drawImage(canvas, 0, 0, w, h);
      const p = {id: Date.now(), data: c.toDataURL('image/jpeg', .86), place};photos.push(p);audio.sfx('shutter');
      const into = album;
      (into ? into.add(p) : local.put(p)).catch(e => {
        const i = photos.indexOf(p);if (i >= 0 && into) photos.splice(i, 1);render();
        notice(e && e.status === 409 ? `Your account's album is full (${(e.body && e.body.limit) || 60} photos) – delete some in the gallery (□, then ✕).` : 'The photo could not be saved.', 6);
      });
      const f = $('.flash');f.classList.remove('on');void f.offsetWidth;f.classList.add('on');
      const pv = $('.preview');pv.src = p.data;pv.classList.remove('show');void pv.offsetWidth;pv.classList.add('show');render();
    };
    render();
    return cam;
  }
  return {create};
});
