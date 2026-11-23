// Jumping (issue #144): a real jump with gravity, landing on tops, clearing fences, climbing ledges.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../walk-collision.js');
const rect = (x,z,w,d) => [{x,z},{x:x+w,z},{x:x+w,z:z+d},{x,z:z+d}];
const ground = (ceilingHeight=Infinity,y=0) => ({points:rect(-20,-20,40,40),ceilingHeight,y});
const box = (x,z,w,d,maxY,extra={}) => ({points:rect(x,z,w,d),minY:-1,maxY,...extra});
const EYE = 1.65, DT = 1/60;
// Jump from (x, z) at speed (vx, 0) holding the button for `hold` s with the stick pushed along +x; until landed (max 3 s).
function jump(world,{x=0,z=0,y=0,vx=6,hold=.3,wish=vx}={}) {
  const s=C.startJump({x,z,y,vx,vz:0}), log={top:y,mantle:false,vault:false};
  for (let t=0;t<3;t+=DT) {
    const e=C.stepAir(world,s,DT,{eye:EYE,held:t<hold,wish:{x:wish,z:0}});
    log.top=Math.max(log.top,s.y);if (e.mantle) log.mantle=true;if (e.vault) log.vault=true;
    if (e.landed) return {...log,s,e,t};
  }
  return {...log,s,e:null};
}

test('a full press peaks at about 1 m, a tap at about 0.5 m, the boost at 3x',()=>{
  const w=C.createWorld({floors:[ground()]});
  const full=jump(w,{vx:0,hold:1}), tap=jump(w,{vx:0,hold:0}), boost=C.startJump({x:0,z:0,y:0,vx:0,vz:0},3);
  assert.ok(Math.abs(full.top-1)<.05,`full ${full.top}`);
  assert.ok(Math.abs(tap.top-.5)<.05,`tap ${tap.top}`);
  let top=0;for (let t=0;t<3;t+=DT) {const e=C.stepAir(w,boost,DT,{held:true});top=Math.max(top,boost.y);if (e.landed) break;}
  assert.ok(Math.abs(top-3)<.12,`boost ${top}`);
  assert.ok(full.e.impact>4,'lands with speed');
});

test('you keep your speed in the air and land on a 0.5 m ledge',()=>{
  const w=C.createWorld({floors:[ground()],obstacles:[box(1.2,-2,3,4,.5)]});
  const r=jump(w,{vx:3});
  assert.equal(r.s.y,.5);assert.ok(r.s.x>1.2 && r.s.x<4.2,`x ${r.s.x}`);
  // On the top you walk, and walking off its edge drops you back down.
  assert.ok(C.canStand(w,r.s,EYE,.5));
  const off=C.walk(w,{x:4,z:0},{x:.5,z:0},EYE,.5);
  assert.equal(off.fall,true);assert.ok(off.x>4.1);
  // Walking (not jumping) into the same low solid still stops you, as before.
  assert.ok(C.move(w,{x:0,z:0},{x:2,z:0},EYE,0).x<1.1);
});

test('a running jump clears a 1.1 m fence and lands beyond it',()=>{
  const w=C.createWorld({floors:[ground()],obstacles:[box(1.5,-5,.06,10,1.1)]});
  const r=jump(w,{vx:6});
  assert.ok(r.s.x>1.8,`landed at ${r.s.x}`);assert.equal(r.s.y,0);
  assert.ok(C.canStand(w,r.s,EYE,0));
});

test('a 2 m wall stops the jump and you come down on your side',()=>{
  const w=C.createWorld({floors:[ground()],obstacles:[box(1.5,-5,.2,10,2)]});
  const r=jump(w,{vx:6});
  assert.ok(r.s.x<1.5,`x ${r.s.x}`);assert.equal(r.s.y,0);assert.equal(r.mantle,false);
});

test('jumping at a 1.5 m ledge pulls you up onto it, not under a low ceiling',()=>{
  const ledge=box(1.5,-5,3,10,1.5);
  const r=jump(C.createWorld({floors:[ground()],obstacles:[ledge]}),{vx:2.5});
  assert.equal(r.mantle,true);assert.equal(r.s.y,1.5);assert.ok(r.s.x>1.5);
  // A room 2.6 m high: no room to rise to 1.5 m with your head.
  const low=jump(C.createWorld({floors:[ground(2.6)],obstacles:[ledge]}),{vx:2.5});
  assert.equal(low.mantle,false);assert.equal(low.s.y,0);assert.ok(low.s.x<1.5);
  // Too high to reach (1.9 m): no climb.
  const high=jump(C.createWorld({floors:[ground()],obstacles:[box(1.5,-5,3,10,1.9)]}),{vx:2.5});
  assert.equal(high.mantle,false);assert.equal(high.s.y,0);
});

test('a 1.2 m railing is vaulted from a standing jump; noJump solids stay walls',()=>{
  const w=C.createWorld({floors:[ground()],obstacles:[box(.5,-5,.06,10,1.2)]});
  const r=jump(w,{x:0,vx:0,wish:2.5});
  assert.equal(r.vault,true);assert.ok(r.s.x>.6,`x ${r.s.x}`);assert.equal(r.s.y,0);
  const counter=C.createWorld({floors:[ground()],obstacles:[box(.5,-5,.6,10,.9,{noJump:true})]});
  const c=jump(counter,{vx:4});
  assert.ok(c.s.x<.5);assert.equal(c.mantle,false);
});

test('over a railing you drop to the ground below, but not off a high balcony',()=>{
  // A deck 2 m up with a 1 m railing at its edge; the ground beyond.
  const deck={points:rect(-5,-5,6,10),y:2}, rail=box(.9,-5,.06,10,3);
  const w=C.createWorld({floors:[ground(),deck],obstacles:[rail]});
  const r=jump(w,{x:0,y:2,vx:4});
  assert.equal(r.s.y,0);assert.ok(r.s.x>1,`x ${r.s.x}`);
  // 10 m up: the deck's edge stays closed in the air (nothing to land on within 6 m).
  const high=C.createWorld({floors:[ground(),{points:rect(-5,-5,6,10),y:10}]});
  const h=jump(high,{x:0,y:10,vx:4});
  assert.equal(h.s.y,10);assert.ok(h.s.x<1);
});
