/* Lobby voice chat: peer-to-peer WebRTC audio between the players in the lobby.
 * Everybody in the lobby hears everybody at full volume, wherever they are on the map (no distance fall-off).
 * Each pair of players has one two-way audio channel. Only the player with the lower id makes the offer (no offer
 * collisions); switching the microphone on or off just swaps the track on that channel, so it never needs renegotiation.
 * Signalling (offer/answer/ICE) goes through the lobby server; Cloudflare's public STUN server finds a direct route.
 * GameVoice.create({send(to, data), you()}) -> {setMic(on) -> Promise<bool>, mic, onSignal(from, data), peerJoined(id),
 *   peerLeft(id), setVolume(id, v), reset(), peers, levels() -> {me, [id]: dBFS}}
 * levels(): how loud each voice is right now (RMS in dB full scale, -100 when silent or unknown) – the librarian in Deichman
 * Grünerløkka shushes players who talk loudly there (issue #47).
 */
(function (root, factory) {
  root.GameVoice = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const ICE = [{urls: 'stun:stun.cloudflare.com:3478'}, {urls: 'stun:stun.l.google.com:19302'}];
  function create({send, you}) {
    let stream = null;
    const peers = new Map();// id -> {pc, audio, offerer, queue}
    const micTrack = () => (stream ? stream.getAudioTracks()[0] : null) || null;
    function attachMic(p) {const t = p.pc.getTransceivers()[0];if (t && t.sender) t.sender.replaceTrack(micTrack()).catch(() => {});}
    async function setMic(on) {
      if (on && !stream) {
        try {stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false});}
        catch {stream = null;return false;}
      } else if (!on && stream) {stream.getTracks().forEach(t => t.stop());stream = null;}
      for (const p of peers.values()) attachMic(p);
      return true;
    }
    function peer(id) {
      if (peers.has(id)) return peers.get(id);
      const pc = new RTCPeerConnection({iceServers: ICE}), audio = new Audio();audio.autoplay = true;audio.volume = 1;
      const p = {pc, audio, offerer: (you() || 0) < id, queue: []};peers.set(id, p);
      pc.onicecandidate = e => {if (e.candidate) send(id, {c: e.candidate});};
      pc.ontrack = e => {audio.srcObject = e.streams[0] || new MediaStream([e.track]);audio.play().catch(() => {});};
      if (p.offerer) {
        pc.addTransceiver('audio', {direction: 'sendrecv'});attachMic(p);
        pc.onnegotiationneeded = async () => {try {await pc.setLocalDescription();send(id, {d: pc.localDescription});} catch {}};
        pc.onconnectionstatechange = () => {if (pc.connectionState === 'failed') pc.restartIce();};
      }
      return p;
    }
    async function onSignal(from, data) {
      const p = peer(from), pc = p.pc;
      try {
        if (data.d) {
          if (data.d.type === 'offer' && p.offerer) return;// the other side never offers; ignore stray offers
          await pc.setRemoteDescription(data.d);
          for (const c of p.queue.splice(0)) await pc.addIceCandidate(c).catch(() => {});
          if (data.d.type === 'offer') {
            const t = pc.getTransceivers()[0];if (t) {t.direction = 'sendrecv';attachMic(p);}
            await pc.setLocalDescription();send(from, {d: pc.localDescription});
          }
        } else if (data.c) {
          if (pc.remoteDescription) await pc.addIceCandidate(data.c).catch(() => {});else p.queue.push(data.c);
        }
      } catch {}
    }
    function peerJoined(id) {peer(id);}
    function peerLeft(id) {meters.delete(id);const p = peers.get(id);if (!p) return;try {p.pc.close();} catch {}p.audio.srcObject = null;peers.delete(id);}
    function setVolume(id, v) {const p = peers.get(id);if (p) p.audio.volume = Math.max(0, Math.min(1, v));}
    function reset() {for (const id of [...peers.keys()]) peerLeft(id);}
    // Voice levels: an analyser per stream (not connected to the speakers; the <audio> element plays the voice).
    let actx = null;const meters = new Map();
    function meter(key, src) {
      if (!src) {meters.delete(key);return null;}
      let m = meters.get(key);if (m && m.src === src) return m;
      try {actx = actx || new (window.AudioContext || window.webkitAudioContext)();const node = actx.createMediaStreamSource(src), an = actx.createAnalyser();an.fftSize = 1024;node.connect(an);m = {src, node, an, buf: new Float32Array(an.fftSize)};meters.set(key, m);return m;} catch {return null;}
    }
    function level(m) {if (!m) return -100;m.an.getFloatTimeDomainData(m.buf);let s = 0;for (let i = 0; i < m.buf.length; i++) s += m.buf[i] * m.buf[i];return 10 * Math.log10(s / m.buf.length + 1e-12);}
    function levels() {
      if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
      const out = {me: stream ? level(meter('me', stream)) : -100};
      for (const [id, p] of peers) out[id] = p.audio.srcObject ? level(meter(id, p.audio.srcObject)) : -100;
      return out;
    }
    // If the browser held back autoplay of someone's voice, keep retrying (any later click, key or controller input unlocks it).
    setInterval(() => {for (const p of peers.values()) if (p.audio.srcObject && p.audio.paused) p.audio.play().catch(() => {});}, 1500);
    return {setMic, onSignal, peerJoined, peerLeft, setVolume, reset, levels, get mic() {return !!stream;}, peers};
  }
  return {create};
});
