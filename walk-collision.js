/* Pure first-person collision geometry. Distances are metres; y is vertical.
 * createWorld({floors:[{points:[{x,z}],ceilingHeight,y=0,slope:{x,z,origin:{x,z}}}],
 *              obstacles:[{points:[{x,z}],minY,maxY,voids:[{points,minY,maxY}]}],radius=.16,clearance=.08})
 *   An obstacle's voids are rooms hollowed out of it (a flat inside a solid building, issue #106): a person whose centre is in
 *   a void's outline, with the feet between its minY and maxY, is not stopped by that obstacle.
 *   A floor surface is flat at y, or a ramp (stairs): y + slope.x*(x-origin.x) + slope.z*(z-origin.z).
 *   Or a terrain: height(point) -> y. ceilingHeight is measured from that surface. Obstacle minY/maxY are absolute heights.
 * Every query takes the person's feet height y (default 0), so stacked storeys do not interfere.
 * supportAt(world, point, y) -> {floor, y} the walkable surface under the feet, or null
 * canStand(world, point, eyeHeight, y=0) -> boolean
 * hitsSolid(world, point, y0, y1, owner, staticOnly) -> boolean (a solid between y0 and y1; solids with o.owner === owner are skipped)
 * overlapDepth(world, point, y0, y1, n, owner) -> metres the circle round point is inside moving solids (vehicles); adds the push-out direction to n
 * move(world, point, delta, eyeHeight, y=0) -> {x,z,y} (swept/substepped, with sliding; y follows ramps)
 * findSafeSpawn(world, requested, eyeHeight, {maxDistance=20,step=.08,y=0}={}) -> {x,z,y}|null
 * ceilingAt(world, point, y=0) -> lowest clearance above the feet touched by the person's footprint
 * roofAt(world, point, y=0) -> the height of the lowest floor or room ceiling above y at the point (Infinity in the open)
 * floorAt(world, point, y=0) -> the height of the highest floor at or below y at the point (-Infinity where there is none)
 * clampEyeHeight(world, point, requested, minimum=.30, y=0) -> safe height|null
 * setDynamic(world, list): moving solids (doors, vehicles, people); a long list is put in the same CELL m grid as the static ones.
 * parkedLayer(list) -> layer {add(o), remove(o)}; setParked(world, layer): solids that seldom change (thousands of parked
 *   vehicles, issue #113), hashed by the layer for every world's margin and changed one solid at a time.
 * setMoving(world, list): a short list of solids that move every frame (trams, buses, metro trains), set every frame, not hashed.
 * canStand(world, point, eyeHeight, y, staticOnly): staticOnly leaves out the dynamic and parked solids.
 * Worlds snapshot geometry; recreate after walls or room heights change.
 * Jumping (issue #144): supportAt also gives the top of a solid you are on ({solid, top: true, y}; only from above, walking never
 *   steps up onto a solid). Solids with noJump: true (or kind 'water') are never passed over or stood on.
 * groundBelow(world, p, y) -> the highest floor or solid top at or under y; headroom(world, p, y) -> room over the feet
 * canPass(world, p, eyeHeight, y, maxDrop=MAX_DROP) / airMove(world, p, delta, eyeHeight, y, maxDrop) -> moving in the air at feet y
 * climbAt(world, p, dir, eyeHeight, from, maxTop, maxVault) -> {x, z, y, over} a ledge to pull up onto, {vault: true} a fence, or null
 * startJump(s, scale) / stepAir(world, s, dt, {eye, held, wish, maxDrop}) -> events; walk(world, p, delta, eye, y) -> move + fall
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WalkCollision = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const EPS = 1e-8;
  // Largest height change followed in one substep (a stair ramp rises ~3 cm per 4 cm substep),
  // and the tolerance for treating two touching floors as one continuous walking surface.
  const STEP = .36, JOIN = .05, CELL = 16, EMPTY = {obstacles:[],boundary:[]};
  // Jumping (issue #144): gravity; the farthest drop the air lets you go over an edge to (higher roofs and balconies stay closed).
  const G = 9.81, MAX_DROP = 6;
  const near = (world,p) => world.cells ? (world.cells.get(Math.floor(p.x/CELL)+','+Math.floor(p.z/CELL)) || EMPTY) : world;
  // Moving solids (door leaves, vehicles, people) live in world.dynamic: set it any time without rebuilding.
  const prepared = list => list.map(o=>o.bounds?o:{...o,bounds:bounds(o.points),minY:o.minY ?? -Infinity,maxY:o.maxY ?? Infinity});
  const hashed = (list,pad) => {const cells=new Map();for (const o of list) {const b=o.bounds;for(let i=Math.floor((b.minX-pad)/CELL);i<=Math.floor((b.maxX+pad)/CELL);i++)for(let j=Math.floor((b.minZ-pad)/CELL);j<=Math.floor((b.maxZ+pad)/CELL);j++){const key=i+','+j;let c=cells.get(key);if(!c){c=[];cells.set(key,c);}c.push(o);}}return cells;};
  const NONE = [];
  function solidsNear(world,p,staticOnly=false) {
    const key=Math.floor(p.x/CELL)+','+Math.floor(p.z/CELL), base=world.cells ? (world.cells.get(key) || EMPTY).obstacles : world.obstacles;
    if (staticOnly) return base;
    const dyn=!world.dynamic || !world.dynamic.length ? NONE : world.dynamicCells ? world.dynamicCells.get(key) || NONE : world.dynamicPrepared || (world.dynamicPrepared=prepared(world.dynamic));
    const park=world.parkedCells ? world.parkedCells.get(key) || NONE : NONE, mov=world.moving || NONE;
    return dyn.length || park.length || mov.length ? base.concat(dyn,park,mov) : base;
  }
  function setDynamic(world,list){world.dynamic=list;world.dynamicPrepared=prepared(list);world.dynamicCells=list.length>24 ? hashed(world.dynamicPrepared,world.radius+.8) : null;}
  // A short list of solids that move every frame (the trams, buses and metro trains near you, issue #111), not hashed.
  function setMoving(world,list){world.moving=list.length ? prepared(list) : NONE;}
  function parkedLayer(list){
    const set=new Set(prepared(list)),byPad=new Map();
    const each=(o,pad,fn)=>{const b=o.bounds;for(let i=Math.floor((b.minX-pad)/CELL);i<=Math.floor((b.maxX+pad)/CELL);i++)for(let j=Math.floor((b.minZ-pad)/CELL);j<=Math.floor((b.maxZ+pad)/CELL);j++)fn(i+','+j);};
    return {set,byPad,
      cellsFor(pad){if (!byPad.has(pad)) byPad.set(pad,hashed([...set],pad));return byPad.get(pad);},
      // o must carry its bounds (it is kept as it is, so remove() finds it again).
      add(o){if (set.has(o)) return;set.add(o);byPad.forEach((cells,pad)=>each(o,pad,key=>{let c=cells.get(key);if(!c){c=[];cells.set(key,c);}c.push(o);}));},
      remove(o){if (!set.delete(o)) return;byPad.forEach((cells,pad)=>each(o,pad,key=>{const c=cells.get(key);if(c){const k=c.indexOf(o);if(k>=0)c.splice(k,1);}}));}};
  }
  function setParked(world,layer){world.parkedCells=layer ? layer.cellsFor(Math.round((world.radius+.8)*100)/100) : null;}
  const subtract = (a, b) => ({x:a.x-b.x, z:a.z-b.z});
  const dot = (a, b) => a.x*b.x+a.z*b.z;
  const cross = (a, b) => a.x*b.z-a.z*b.x;
  const length = v => Math.hypot(v.x,v.z);
  const lerp = (a,b,t) => ({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
  const edges = points => points.map((a,i) => [a,points[(i+1)%points.length]]);
  const bounds = points => ({minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))});
  const nearBounds = (p,b,r=0) => p.x>=b.minX-r && p.x<=b.maxX+r && p.z>=b.minZ-r && p.z<=b.maxZ+r;
  function closestOnSegment(p,a,b) {
    const d=subtract(b,a), squared=dot(d,d);
    return lerp(a,b,squared ? Math.max(0,Math.min(1,dot(subtract(p,a),d)/squared)) : 0);
  }
  const distanceToSegment = (p,a,b) => length(subtract(p,closestOnSegment(p,a,b)));
  function inside(p,points) {
    let result=false;
    for (const [a,b] of edges(points)) {
      if (distanceToSegment(p,a,b)<EPS) return true;
      if ((a.z>p.z)!==(b.z>p.z) && p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x) result=!result;
    }
    return result;
  }
  function distanceToPolygon(p,polygon) {
    return inside(p,polygon) ? 0 : Math.min(...edges(polygon).map(([a,b])=>distanceToSegment(p,a,b)));
  }
  function surfaceFunction(f) {
    if (typeof f.height==='function') return f.height;
    const base=f.y ?? 0, s=f.slope;
    if (!s || (!s.x && !s.z)) return () => base;
    const o=s.origin || {x:0,z:0};
    return p => base+(s.x||0)*(p.x-o.x)+(s.z||0)*(p.z-o.z);
  }
  // Split every floor edge at other edges and keep the exposed pieces. A piece is open
  // when the floor just across it continues at the same height (touching rooms, a stair
  // meeting its landing); floors stacked on other storeys do not hide each other's edges.
  function exposedBoundary(floors) {
    const segments=floors.flatMap(f=>edges(f.points)).map(([c,e])=>[c,e,Math.min(c.x,e.x),Math.max(c.x,e.x),Math.min(c.z,e.z),Math.max(c.z,e.z)]);
    const covered=(p,height,except)=>floors.some(f=>f!==except && nearBounds(p,f.bounds,EPS) && inside(p,f.points) && Math.abs(f.surface(p)-height)<JOIN);
    const result=[];
    for (const floor of floors) for (const [a,b] of edges(floor.points)) {
      const d=subtract(b,a), dd=dot(d,d), span=length(d);
      if (span<EPS) continue;
      const cuts=[0,1],ex0=Math.min(a.x,b.x)-1e-6,ex1=Math.max(a.x,b.x)+1e-6,ez0=Math.min(a.z,b.z)-1e-6,ez1=Math.max(a.z,b.z)+1e-6;
      for (const [c,e,cx0,cx1,cz0,cz1] of segments) {
        if (cx1<ex0 || cx0>ex1 || cz1<ez0 || cz0>ez1) continue;
        const v=subtract(e,c), ac=subtract(c,a), denominator=cross(d,v);
        if (Math.abs(denominator)>EPS) {
          const t=cross(ac,v)/denominator, u=cross(ac,d)/denominator;
          if (t>EPS && t<1-EPS && u>=-EPS && u<=1+EPS) cuts.push(t);
        } else if (Math.abs(cross(ac,d))<EPS) {
          for (const p of [c,e]) {
            const t=dot(subtract(p,a),d)/dd;
            if (t>EPS && t<1-EPS) cuts.push(t);
          }
        }
      }
      cuts.sort((x,y)=>x-y);
      for (let i=1;i<cuts.length;i++) {
        if (cuts[i]-cuts[i-1]<EPS) continue;
        const start=lerp(a,b,cuts[i-1]), end=lerp(a,b,cuts[i]);
        const middle=lerp(start,end,.5), normal={x:-d.z/span*1e-6,z:d.x/span*1e-6}, height=floor.surface(middle);
        const sides=[{x:middle.x+normal.x,z:middle.z+normal.z},{x:middle.x-normal.x,z:middle.z-normal.z}];
        // Exactly one side lies inside this floor; the edge is a barrier unless the other side continues it.
        const outside=inside(sides[0],floor.points)&&!inside(sides[1],floor.points)?sides[1]:inside(sides[1],floor.points)&&!inside(sides[0],floor.points)?sides[0]:null;
        if (outside && covered(outside,height,floor)) continue;
        if (!outside && floors.some(f=>f!==floor && inside(middle,f.points) && Math.abs(f.surface(middle)-height)<JOIN && inside(sides[0],f.points) && inside(sides[1],f.points))) continue;
        result.push({a:start,b:end,floor});
      }
    }
    return result;
  }
  function createWorld({floors=[],obstacles=[],radius=.16,clearance=.08}={}) {
    const copyPoints=points=>points.map(p=>({x:p.x,z:p.z}));
    const world={
      floors:floors.map(f=>{const copy={points:copyPoints(f.points),bounds:bounds(f.points),ceilingHeight:f.ceilingHeight ?? Infinity,y:f.y ?? 0,slope:f.slope?{x:f.slope.x||0,z:f.slope.z||0,origin:{...(f.slope.origin||{x:0,z:0})}}:null,height:f.height,name:f.name,surfaceKind:f.surfaceKind};copy.surface=surfaceFunction(copy);return copy;}),
      obstacles:obstacles.map(o=>({points:copyPoints(o.points),bounds:bounds(o.points),minY:o.minY ?? -Infinity,maxY:o.maxY ?? Infinity,kind:o.kind,noJump:!!o.noJump,voids:o.voids&&o.voids.length?o.voids.map(v=>({points:copyPoints(v.points),bounds:bounds(v.points),minY:v.minY ?? -Infinity,maxY:v.maxY ?? Infinity})):null})),
      radius,clearance
    };
    world.boundary=exposedBoundary(world.floors);
    world.dynamic=[];
    // Spatial hash (CELL m) so each query only tests nearby obstacles and boundary pieces.
    world.cells=new Map();
    const pad=world.radius+.8,addTo=(item,b,kind)=>{for(let i=Math.floor((b.minX-pad)/CELL);i<=Math.floor((b.maxX+pad)/CELL);i++)for(let j=Math.floor((b.minZ-pad)/CELL);j<=Math.floor((b.maxZ+pad)/CELL);j++){const key=i+','+j;let c=world.cells.get(key);if(!c){c={obstacles:[],boundary:[]};world.cells.set(key,c);}c[kind].push(item);}};
    world.obstacles.forEach(o=>addTo(o,o.bounds,'obstacles'));
    // Floors too (issue #113: a query looked at every one of the ~1000 floors): big ones (terrain) in a short list, the rest by cell.
    world.floorCells=new Map();world.bigFloors=[];
    world.floors.forEach((f,i)=>{f.order=i;const b=f.bounds,fp=world.radius+.05;if (b.maxX-b.minX>256 || b.maxZ-b.minZ>256) {world.bigFloors.push(f);return;}
      for(let i=Math.floor((b.minX-fp)/CELL);i<=Math.floor((b.maxX+fp)/CELL);i++)for(let j=Math.floor((b.minZ-fp)/CELL);j<=Math.floor((b.maxZ+fp)/CELL);j++){const key=i+','+j;let c=world.floorCells.get(key);if(!c){c=[];world.floorCells.set(key,c);}c.push(f);}});
    world.boundary.forEach(piece=>addTo(piece,bounds([piece.a,piece.b]),'boundary'));
    return world;
  }
  // The floors that may hold or roof p, in their original order (so ties go the same way as before).
  function floorsNear(world,p) {
    if (!world.floorCells) return world.floors;
    const c=world.floorCells.get(Math.floor(p.x/CELL)+','+Math.floor(p.z/CELL)), big=world.bigFloors;
    if (!c) return big;if (!big.length) return c;
    const out=[];let i=0,j=0;while (i<big.length || j<c.length) {if (j>=c.length || (i<big.length && big[i].order<c[j].order)) out.push(big[i++]);else out.push(c[j++]);}
    return out;
  }
  function supportAt(world,p,y=0) {
    let best=null,gap=-Infinity;
    for (const f of floorsNear(world,p)) {
      if (!nearBounds(p,f.bounds,EPS) || !inside(p,f.points)) continue;
      // Highest walkable surface within a step: walking into a stair or ramp climbs onto it.
      const height=f.surface(p);
      if (Math.abs(height-y)<=STEP && height>gap) {best={floor:f,y:height};gap=height;}
    }
    if (best && best.y>=y-.06) return best;// on a floor (the usual case): no need to look at the solids' tops
    // The top of a solid you stand on (a bench, a crate, a car roof; issue #144): only from above (you jumped or climbed onto it),
    // never stepped up onto by walking, so walking into a low solid still stops you as before.
    for (const o of solidsNear(world,p)) {
      if (o.maxY>y+.05 || o.maxY<y-STEP || o.maxY<=gap || !standable(o) || !nearBounds(p,o.bounds) || !inside(p,o.points) || hollow(o,p,o.maxY)) continue;
      best={floor:null,solid:o,top:true,y:o.maxY};gap=o.maxY;
    }
    return best;
  }
  // Jumping (issue #144). A solid's top is a place to stand when it has a real height, is at least ~0.2 m thick (not a fence or
  // a railing: 2 x area / perimeter) and is not marked noJump (water, shop counters): those also stay as tall as a wall in the air.
  const noJump = o => !!o.noJump || o.kind==='water';
  const topOf = o => noJump(o) ? Infinity : o.maxY;
  function polyWidth(points) {let a=0,per=0;for (let i=0;i<points.length;i++) {const p=points[i],q=points[(i+1)%points.length];a+=p.x*q.z-q.x*p.z;per+=Math.hypot(q.x-p.x,q.z-p.z);}return per ? Math.abs(a)/per : 0;}
  const standable = o => Number.isFinite(o.maxY) && !noJump(o) && (o._w ?? (o._w=polyWidth(o.points)))>=.2;
  // The highest place to stand at the point p at or below height y (a floor or a solid's top), or null.
  function groundBelow(world,p,y) {
    let best=null;
    for (const f of floorsNear(world,p)) {
      if (!nearBounds(p,f.bounds,EPS) || !inside(p,f.points)) continue;
      const h=f.surface(p);if (h<=y+EPS && (!best || h>best.y)) best={floor:f,y:h};
    }
    for (const o of solidsNear(world,p)) {
      if (o.maxY>y+EPS || (best && o.maxY<=best.y) || !standable(o) || !nearBounds(p,o.bounds) || !inside(p,o.points) || hollow(o,p,o.maxY)) continue;
      best={floor:null,solid:o,top:true,y:o.maxY};
    }
    return best;
  }
  // Room over the feet at height y: the lowest floor above (more than a step up) or the ceiling of a room whose floor is under
  // the feet (up to 3.2 m under them: a jump or a solid's top), Infinity in the open.
  function headroom(world,p,y) {
    let lowest=Infinity;
    for (const f of floorsNear(world,p)) {
      if (!nearBounds(p,f.bounds,EPS) || !inside(p,f.points)) continue;
      const h=f.surface(p);
      if (h>y+STEP) lowest=Math.min(lowest,h);else if (y-h<=3.2) lowest=Math.min(lowest,h+f.ceilingHeight);
    }
    return lowest-y;
  }
  // In the air with the feet at height y: no solid in the body's way (solids are passed over once the feet are above their top),
  // not inside the side of a floor more than a step above the feet, room for the head, and (maxDrop) something to come down on
  // no more than maxDrop m below. Floor edges are not walls in the air: you can jump over a railing and drop to the ground below,
  // but not off a high roof or balcony (nothing within maxDrop).
  function canPass(world,p,eyeHeight,y,maxDrop=MAX_DROP) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(y)) return false;
    for (const o of solidsNear(world,p)) if (topOf(o)>y+.04 && o.minY<y+eyeHeight+.10 && nearBounds(p,o.bounds,world.radius) && !hollow(o,p,y) && distanceToPolygon(p,o.points)<world.radius-EPS) return false;
    for (const piece of near(world,p).boundary) {
      if (distanceToSegment(p,piece.a,piece.b)>=world.radius-EPS) continue;
      const s=piece.floor.surface(closestOnSegment(p,piece.a,piece.b));if (y<s-STEP && y>s-STEP*1.7) return false;
    }
    if (headroom(world,p,y)<eyeHeight+Math.max(.10,world.clearance)) return false;
    if (maxDrop!==Infinity) {const g=groundBelow(world,p,y+STEP);if (!g || g.y<y-maxDrop) return false;}
    return true;
  }
  // Swept move in the air at a fixed feet height y (like move: substeps, contact by bisection, sliding along what stops you).
  function airMove(world,position,delta,eyeHeight,y,maxDrop=MAX_DROP) {
    let p={x:position.x,z:position.z};
    const distance=length(delta);
    if (!Number.isFinite(distance) || distance<EPS) return p;
    const ok=q=>canPass(world,q,eyeHeight,y,maxDrop);
    const count=Math.max(1,Math.ceil(distance/Math.min(.04,world.radius*.25))), step={x:delta.x/count,z:delta.z/count};
    for (let i=0;i<count;i++) {
      const next={x:p.x+step.x,z:p.z+step.z};
      if (ok(next)) {p=next;continue;}
      let low=0,high=1;
      for (let j=0;j<10;j++) {const mid=(low+high)/2;if (ok(lerp(p,next,mid))) low=mid;else high=mid;}
      const contact=lerp(p,next,low), rest={x:step.x*(1-low),z:step.z*(1-low)}, cands=[{x:rest.x,z:0},{x:0,z:rest.z}], reach=world.radius+length(rest)+.001;
      const along=(a,b)=>{if (distanceToSegment(contact,a,b)>reach) return;const e=subtract(b,a),sq=dot(e,e);if (sq<EPS) return;const t=dot(rest,e)/sq;cands.push({x:e.x*t,z:e.z*t});};
      for (const o of solidsNear(world,contact)) if (topOf(o)>y+.04 && o.minY<y+eyeHeight+.10 && nearBounds(contact,o.bounds,reach)) for (const [a,b] of edges(o.points)) along(a,b);
      for (const piece of near(world,contact).boundary) along(piece.a,piece.b);
      let best=contact,score=0;
      for (const c of cands) {const q={x:contact.x+c.x,z:contact.z+c.z},progress=dot(c,rest);if (progress>score && ok(q)) {best=q;score=progress;}}
      p=best;
    }
    return p;
  }
  // Climbing what stops you in the air: going in direction dir (unit) from p, find the lowest feet height h from `from` up to
  // maxTop (ledges) / maxVault (thin things) at which you get over it, with room to rise where you are (else null: a low ceiling).
  //  - a place to stand just ahead at about that height (a ledge, a wall's top, a car roof): {x, z, y: where you stand, over: h}
  //  - else, for h <= maxVault, open ground beyond (a fence, a railing, a hedge): {x, z, y: null, over: h, vault: true}
  // Can you pass at height y everywhere on the straight line from a to b (looked at every half radius)?
  function freeWay(world,a,b,eyeHeight,y) {
    const n=Math.max(2,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/Math.max(.02,world.radius*.5)));
    for (let i=1;i<n;i++) if (!canPass(world,lerp(a,b,i/n),eyeHeight,y,Infinity)) return false;
    return true;
  }
  function climbAt(world,p,dir,eyeHeight,from,maxTop,maxVault=maxTop,maxDrop=MAX_DROP) {
    const at=d=>({x:p.x+dir.x*(world.radius+d),z:p.z+dir.z*(world.radius+d)});
    for (let h=from;h<=maxTop+.051;h+=.1) {
      if (!canPass(world,p,eyeHeight,h,Infinity)) return null;// a low ceiling over you: no higher try can work
      for (const d of [.12,.3,.5,.75]) {
        const q=at(d);
        // The whole way over must be free at this height, not only its end and its middle: a closed door or a pane of glass
        // is thinner than the gap between two looks, and you were pulled through it.
        if (!canPass(world,q,eyeHeight,h,maxDrop) || !freeWay(world,p,q,eyeHeight,h)) continue;
        const g=groundBelow(world,q,h+STEP);if (!g) continue;
        if (g.y>=h-.3) {if (canStand(world,q,eyeHeight,g.y)) return {x:q.x,z:q.z,y:g.y,over:Math.max(h,g.y)};continue;}
        if (h<=maxVault+.051 && canPass(world,q,eyeHeight,g.y+.05,Infinity)) return {x:q.x,z:q.z,y:null,over:h,vault:true};
      }
    }
    return null;
  }
  function ceilingAt(world,p,y=0) {
    let lowest=Infinity;
    for (const f of floorsNear(world,p)) {
      if (!nearBounds(p,f.bounds,world.radius+EPS) || distanceToPolygon(p,f.points)>world.radius+EPS) continue;
      const height=f.surface(closestInside(p,f));
      if (Math.abs(height-y)>STEP*1.7) continue;
      lowest=Math.min(lowest,height+f.ceilingHeight-y);
    }
    return lowest;
  }
  // The lowest thing overhead at the point p above height y: the next floor up (a storey, a bridge deck) or the ceiling of
  // the room whose floor is under y; Infinity in the open. Used by the vehicles' third-person camera (issue #129).
  function roofAt(world,p,y=0) {
    let lowest=Infinity;
    for (const f of floorsNear(world,p)) {
      if (!nearBounds(p,f.bounds,EPS) || !inside(p,f.points)) continue;
      const height=f.surface(p);
      if (height>y+EPS) lowest=Math.min(lowest,height);
      else if (height+f.ceilingHeight>y+EPS) lowest=Math.min(lowest,height+f.ceilingHeight);
    }
    return lowest;
  }
  // The highest floor at or below height y at the point p (-Infinity where there is none).
  function floorAt(world,p,y=0) {
    let highest=-Infinity;
    for (const f of floorsNear(world,p)) {
      if (!nearBounds(p,f.bounds,EPS) || !inside(p,f.points)) continue;
      const height=f.surface(p);if (height<=y+EPS && height>highest) highest=height;
    }
    return highest;
  }
  function closestInside(p,f) {
    if (inside(p,f.points)) return p;
    let best=p,distance=Infinity;
    for (const [a,b] of edges(f.points)) {const q=closestOnSegment(p,a,b),d=length(subtract(p,q));if (d<distance) {distance=d;best=q;}}
    return best;
  }
  const overhead = (o,y,eye) => o.maxY>y+.04 && o.minY<y+eye+.10;
  // Is p (feet at y) in a room hollowed out of this obstacle?
  const hollow = (o,p,y) => !!o.voids && o.voids.some(v=>y>v.minY && y<v.maxY && nearBounds(p,v.bounds) && inside(p,v.points));
  function clampEyeHeight(world,p,requested,minimum=.30,y=0) {
    let maximum=ceilingAt(world,p,y)-Math.max(.10,world.clearance);
    for (const obstacle of solidsNear(world,p)) {
      if (obstacle.minY>y+.04 && nearBounds(p,obstacle.bounds,world.radius) && distanceToPolygon(p,obstacle.points)<world.radius-EPS) maximum=Math.min(maximum,obstacle.minY-y-.10);
    }
    return maximum<minimum ? null : Math.min(maximum,Math.max(minimum,requested));
  }
  const barrierActive = (piece,p,y) => Math.abs(piece.floor.surface(closestOnSegment(p,piece.a,piece.b))-y)<STEP*1.7;
  function canStand(world,p,eyeHeight,y=0,staticOnly=false) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(eyeHeight) || eyeHeight<=0) return false;
    const support=supportAt(world,p,y);
    if (!support) return false;
    const feet=support.y;
    if (eyeHeight>ceilingAt(world,p,feet)-Math.max(.10,world.clearance)+EPS) return false;
    if (support.top && eyeHeight>headroom(world,p,feet)-Math.max(.10,world.clearance)+EPS) return false;// on a table: the room's ceiling
    const cell=near(world,p);
    if (cell.boundary.some(piece=>distanceToSegment(p,piece.a,piece.b)<world.radius-EPS && barrierActive(piece,p,feet))) return false;
    return !solidsNear(world,p,staticOnly).some(o=>overhead(o,feet,eyeHeight) && nearBounds(p,o.bounds,world.radius) && !hollow(o,p,feet) && distanceToPolygon(p,o.points)<world.radius-EPS);
  }
  // Flying objects: does any solid (building, tree, wall, vehicle) come within the world's radius of p between heights y0 and y1?
  // owner (optional): skip the solids marked with this owner (a vehicle's own parked footprint, issue #97).
  function hitsSolid(world,p,y0,y1,owner,staticOnly=false) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return true;
    return solidsNear(world,p,staticOnly).some(o=>o.maxY>y0 && o.minY<y1 && (!owner || o.owner!==owner) && nearBounds(p,o.bounds,world.radius) && !hollow(o,p,y0) && (inside(p,o.points) || distanceToPolygon(p,o.points)<world.radius-EPS));
  }
  // How deep the circle of the world's radius round p is in the solids that move (vehicles, trams: the dynamic, parked and
  // moving lists, never the static ones) between heights y0 and y1, in metres (0 = not touching). The push-out direction,
  // weighted by depth, is added to n ({x, z}). Solids with o.owner === owner are skipped. Issue #145: a car that is already
  // in another car may always drive in a direction that does not make this deeper, and is pushed out along n.
  function depthIn(list,p,y0,y1,n,owner,r) {
    let total=0;
    for (const o of list) {
      if (!(o.maxY>y0 && o.minY<y1) || (owner && o.owner===owner) || !nearBounds(p,o.bounds,r)) continue;
      const pts=o.points;let best=Infinity,qx=0,qz=0,isIn=false;
      for (let i=0,j=pts.length-1;i<pts.length;j=i++) {
        const a=pts[j],b=pts[i],dx=b.x-a.x,dz=b.z-a.z,L=dx*dx+dz*dz,t=L ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/L)) : 0;
        const cx=a.x+dx*t,cz=a.z+dz*t,d=Math.hypot(p.x-cx,p.z-cz);if (d<best) {best=d;qx=cx;qz=cz;}
        if ((a.z>p.z)!==(b.z>p.z) && p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x) isIn=!isIn;
      }
      const depth=r-(isIn ? -best : best);if (depth<=EPS) continue;
      // Out of the solid: away from its nearest edge (from its middle when p sits on the edge).
      let ux=isIn ? qx-p.x : p.x-qx,uz=isIn ? qz-p.z : p.z-qz,len=Math.hypot(ux,uz);
      if (len<1e-6) {ux=p.x-(o.bounds.minX+o.bounds.maxX)/2;uz=p.z-(o.bounds.minZ+o.bounds.maxZ)/2;len=Math.hypot(ux,uz) || 1;}
      n.x+=ux/len*depth;n.z+=uz/len*depth;total+=depth;
    }
    return total;
  }
  function overlapDepth(world,p,y0,y1,n,owner) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return 0;
    const key=Math.floor(p.x/CELL)+','+Math.floor(p.z/CELL), r=world.radius;
    const dyn=!world.dynamic || !world.dynamic.length ? NONE : world.dynamicCells ? world.dynamicCells.get(key) || NONE : world.dynamicPrepared || (world.dynamicPrepared=prepared(world.dynamic));
    const park=world.parkedCells ? world.parkedCells.get(key) || NONE : NONE, mov=world.moving || NONE;
    return depthIn(dyn,p,y0,y1,n,owner,r)+depthIn(park,p,y0,y1,n,owner,r)+depthIn(mov,p,y0,y1,n,owner,r);
  }
  function move(world,position,delta,eyeHeight,y=0) {
    const start=supportAt(world,position,y);
    if (!start || !canStand(world,position,eyeHeight,y)) return {x:position.x,z:position.z,y};
    let p={x:position.x,z:position.z},feet=start.y;
    const distance=length(delta);
    if (!Number.isFinite(distance)) return {...p,y:feet};
    // Small enough for thin obstacles: circle dilation makes each solid at least
    // 2*radius wide, so an entire collision cannot be skipped in one substep.
    const count=Math.max(1,Math.ceil(distance/Math.min(.04,world.radius*.25)));
    const step={x:delta.x/count,z:delta.z/count};
    const activeEdges=()=>near(world,p).boundary.filter(piece=>barrierActive(piece,p,feet)).map(piece=>[piece.a,piece.b]).concat(solidsNear(world,p).filter(o=>overhead(o,feet,eyeHeight) && !hollow(o,p,feet)).flatMap(o=>edges(o.points)));
    const advance=q=>{p=q;feet=supportAt(world,q,feet).y;};
    for (let i=0;i<count;i++) {
      const next={x:p.x+step.x,z:p.z+step.z};
      if (canStand(world,next,eyeHeight,feet)) {advance(next);continue;}
      // Approach contact without leaving the footprint embedded in the wall.
      let low=0,high=1;
      for (let j=0;j<12;j++) {
        const mid=(low+high)/2;
        if (canStand(world,lerp(p,next,mid),eyeHeight,feet)) low=mid; else high=mid;
      }
      const contact=lerp(p,next,low);
      const rest={x:step.x*(1-low),z:step.z*(1-low)};
      const candidates=[{x:rest.x,z:0},{x:0,z:rest.z}];
      for (const [a,b] of activeEdges()) {
        if (distanceToSegment(contact,a,b)>world.radius+length(rest)+.001) continue;
        const edge=subtract(b,a), squared=dot(edge,edge);
        if (squared<EPS) continue;
        const t=dot(rest,edge)/squared;
        candidates.push({x:edge.x*t,z:edge.z*t});
      }
      let best=contact,score=0;
      for (const candidate of candidates) {
        const q={x:contact.x+candidate.x,z:contact.z+candidate.z};
        const progress=dot(candidate,rest);
        if (progress>score && canStand(world,q,eyeHeight,feet)) {best=q;score=progress;}
      }
      advance(best);
    }
    return {...p,y:feet};
  }
  function findSafeSpawn(world,requested,eyeHeight,{maxDistance=20,step=.08,y=0}={}) {
    const ok=p=>canStand(world,p,eyeHeight,y);
    const result=p=>({x:p.x,z:p.z,y:supportAt(world,p,y).y});
    if (!world.floors.some(f=>eyeHeight<=f.ceilingHeight-Math.max(.10,world.clearance)+EPS)) return null;
    if (ok(requested)) return result(requested);
    // Expanding radial search returns a nearby safe point; angular spacing is
    // bounded by step so even a narrow doorway remains discoverable.
    for (let radius=step;radius<=maxDistance;radius+=step) {
      const count=Math.max(12,Math.ceil(2*Math.PI*radius/step));
      for (let i=0;i<count;i++) {
        const angle=2*Math.PI*i/count;
        const p={x:requested.x+radius*Math.cos(angle),z:requested.z+radius*Math.sin(angle)};
        if (ok(p)) return result(p);
      }
    }
    return null;
  }
  // ---------- The jump (issue #144) ----------
  // A tap lifts the feet TAP m; holding the button for the first HOLD s lowers gravity to HOLD_G, so a full press peaks at APEX m.
  // In the air you keep your speed and steer with AIR m/s²; running into a ledge you cannot clear but can reach (its top no more
  // than REACH m over the feet at take-off) pulls you up onto it in MANTLE s.
  const JUMP = {APEX:1.0,TAP:.5,HOLD:.2,REACH:1.6,VAULT:1.25,AIR:5,MANTLE:.5};
  JUMP.TAP_V=Math.sqrt(2*G*JUMP.TAP);
  // Height gained from v0 when gravity is g1 for the first T s, then G (g1 < G).
  const riseOf=(v0,T,g1)=>{const v=v0-g1*T;return v<=0 ? v0*v0/(2*g1) : v0*T-.5*g1*T*T+v*v/(2*G);};
  {let lo=0,hi=G;for (let i=0;i<60;i++) {const m=(lo+hi)/2;if (riseOf(JUMP.TAP_V,JUMP.HOLD,m)>JUMP.APEX) lo=m;else hi=m;}JUMP.HOLD_G=(lo+hi)/2;}
  // Start a jump from the feet at s.y; scale multiplies the heights (the stash's 3x jump boost).
  function startJump(s,scale=1) {const k=Math.sqrt(scale);s.vy=JUMP.TAP_V*k;s.hold=JUMP.HOLD*k;s.t=0;s.takeoff=s.y;s.mantle=null;return s;}
  // How much higher the feet still go on this arc (held: the button is still down).
  function riseLeft(s,held) {if (s.vy<=0) return 0;const T=held ? Math.max(0,(s.hold||0)-(s.t||0)) : 0;return T>0 ? riseOf(s.vy,T,JUMP.HOLD_G) : s.vy*s.vy/(2*G);}
  const ease=k=>k<.5 ? 2*k*k : 1-Math.pow(-2*k+2,2)/2;
  // One step in the air. s = {x, z, y (feet), vx, vz, vy, t, hold, takeoff, mantle}; o = {eye, held, wish {x, z} m/s, maxDrop}.
  // Returns {landed, impact (m/s down), mantle (started), mantled, bump (head), stuck (landed where you cannot stand)}.
  function stepAir(world,s,dt,o={}) {
    const eye=o.eye ?? 1.65, maxDrop=o.maxDrop ?? MAX_DROP, wish=o.wish || {x:0,z:0};
    if (s.mantle) {
      // Pulling up (or vaulting): up to the top first, then over the edge; a vault then drops on the far side.
      const m=s.mantle;m.t+=dt;const k=Math.min(1,m.t/m.T), up=ease(Math.min(1,k/.6)), fw=ease(Math.max(0,(k-.4)/.6));
      s.y=k<.6 ? m.y0+(m.top-m.y0)*up : m.top+(m.y1-m.top)*ease((k-.6)/.4);s.x=m.x0+(m.x1-m.x0)*fw;s.z=m.z0+(m.z1-m.z0)*fw;
      if (k<1) return {};
      s.mantle=null;s.y=m.y1;s.vy=0;
      if (m.vault) {s.vx=m.dir.x*2;s.vz=m.dir.z*2;s.t=9;return {vaulted:true};}
      s.vx=s.vz=0;return {landed:true,impact:0,mantled:true};
    }
    if (!o.held) s.hold=0;// let go: the extra lift is over for this jump
    const g=s.vy>0 && s.t<(s.hold||0) ? JUMP.HOLD_G : G;s.t=(s.t||0)+dt;s.vy-=g*dt;
    // Steer a little; with the stick let go you keep your speed.
    const wl=Math.hypot(wish.x,wish.z);
    if (wl>.05) {const dx=wish.x-s.vx,dz=wish.z-s.vz,dl=Math.hypot(dx,dz),a=Math.min(dl,JUMP.AIR*dt);if (dl>1e-9) {s.vx+=dx/dl*a;s.vz+=dz/dl*a;}}
    const out={};
    // Across: pass over what is lower than the feet.
    const want=Math.hypot(s.vx,s.vz)*dt;
    if (want>1e-9) {
      const r=airMove(world,s,{x:s.vx*dt,z:s.vz*dt},eye,s.y,maxDrop), got=Math.hypot(r.x-s.x,r.z-s.z);
      if (got<want*.6 && wl>.05) {
        // Stopped by something you will not clear on this arc: a ledge in reach is climbed, a low fence or railing vaulted.
        const base=s.takeoff ?? s.y, dir={x:wish.x/wl,z:wish.z/wl}, nc=s.noClimb;
        // (Nothing to climb here is remembered while you stay at the same spot and push the same way: the search is not cheap.)
        const same=nc && Math.hypot(s.x-nc.x,s.z-nc.z)<.25 && dir.x*nc.dx+dir.z*nc.dz>.9;
        const L=same ? null : climbAt(world,s,dir,eye,s.y+.1,Math.min(base+JUMP.REACH,s.y+JUMP.REACH),base+JUMP.VAULT,maxDrop);
        if (!L && !same) s.noClimb={x:s.x,z:s.z,dx:dir.x,dz:dir.z};
        if (L && L.over>s.y+riseLeft(s,o.held)+.04) {
          s.mantle={t:0,x0:s.x,z0:s.z,y0:s.y,x1:L.x,z1:L.z,top:L.over,y1:L.vault ? L.over : L.y,vault:!!L.vault,dir,T:L.vault ? JUMP.MANTLE*.7 : JUMP.MANTLE};
          s.vx=s.vz=s.vy=0;out.mantle=true;out.vault=!!L.vault;return out;
        }
      }
      s.vx=(r.x-s.x)/dt;s.vz=(r.z-s.z)/dt;s.x=r.x;s.z=r.z;// sliding along a wall keeps only the speed along it
    }
    // Up and down.
    const y0=s.y, y1=s.y+s.vy*dt;
    {const g0=groundBelow(world,s,y0+STEP);if (g0 && g0.y>y0) s.y=g0.y;}// the ground rose under you (a slope, a step): onto it
    if (s.vy>0) {
      if (canPass(world,s,eye,Math.max(s.y,y1),Infinity)) s.y=Math.max(s.y,y1);else {s.vy=0;out.bump=true;}
      return out;
    }
    const g1=groundBelow(world,s,s.y+.001);
    if (g1 && g1.y>=y1) {
      // Landed: on a floor or on a solid's top.
      out.landed=true;out.impact=-s.vy;s.y=g1.y;s.vy=0;
      if (!canStand(world,s,eye,g1.y)) {const sp=findSafeSpawn(world,s,eye,{maxDistance:.6,step:.05,y:g1.y});if (sp) {s.x=sp.x;s.z=sp.z;s.y=sp.y;} else out.stuck=true;}
      return out;
    }
    if (!canPass(world,s,eye,y1,Infinity)) {
      // Coming down onto a thin top (a fence, a railing, an edge): slide off it, the way you are going if you can.
      const hv=Math.hypot(s.vx,s.vz), fx=hv>.1 ? s.vx/hv : 0, fz=hv>.1 ? s.vz/hv : 0;let best=null,score=-Infinity;
      for (const d of [.06,.12,.2,.3,.42]) {for (let i=0;i<8;i++) {const a=i*Math.PI/4, q={x:s.x+Math.cos(a)*d,z:s.z+Math.sin(a)*d}, sc=Math.cos(a)*fx+Math.sin(a)*fz-d*2;if (sc>score && canPass(world,q,eye,y1,maxDrop)) {best=q;score=sc;}}if (best) break;}
      if (best) {s.x=best.x;s.z=best.z;}
    }
    s.y=y1;
    return out;
  }
  // Walking with falling: like move, but standing on a solid's top you can walk off its edge and drop (fall: true).
  function walk(world,position,delta,eyeHeight,y=0,maxDrop=MAX_DROP) {
    const r=move(world,position,delta,eyeHeight,y), want=length(delta);
    if (want<1e-6) return {...r,fall:false};
    const s=supportAt(world,position,y);
    const got=Math.hypot(r.x-position.x,r.z-position.z);
    if (!s || !s.top || got>=want*.7) return {...r,fall:false};
    const a=airMove(world,position,delta,eyeHeight,y,maxDrop);
    if (Math.hypot(a.x-position.x,a.z-position.z)<=got+1e-4) return {...r,fall:false};
    const s2=supportAt(world,a,y);
    if (s2) return canStand(world,a,eyeHeight,s2.y) ? {x:a.x,z:a.z,y:s2.y,fall:false} : {...r,fall:false};
    return {x:a.x,z:a.z,y,fall:true};
  }
  return {createWorld,supportAt,canStand,hitsSolid,overlapDepth,move,findSafeSpawn,ceilingAt,roofAt,floorAt,clampEyeHeight,setDynamic,setMoving,parkedLayer,setParked,STEP,
    groundBelow,headroom,canPass,airMove,climbAt,startJump,stepAir,riseLeft,walk,JUMP,G,MAX_DROP};
});
