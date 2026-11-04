"""Construction City's inside (issue #85), used by tools/make-construction-city.py.

Everything here is our design on the real outline and the measured roof steps (the sources describe the building, not its
plans): six wings round the glass hall, one core per wing (a switchback stair and a lift from the garage to the top floor), a
switchback stair in the hall with galleries along its timber wall, open office floors, the ground floor's rooms (reception,
café, canteen, restaurant, gym, bike room, auditorium), the sky bar and boardroom on the 10th floor with the roof terrace on
the north-west wing, and a two-level garage (P1, P2) under the whole building, entered by a ramp from the street at the west
wing's end.

design(...) returns plain lists in the local frame (metres east x / south s) with heights in metres above sea level:
- levels {k: height} for k = -1 (P2), 0 (P1), 1 .. 12 (floor tops; a block with F floors has its roof at level F + 1)
- floors [{k, h, p, use, b}]: flat walkable polygons (no holes; split where needed)
- slopes [{p, a, b, ha, hb, kind}]: stair flights and car ramps (height along the line a -> b)
- portal {p, a, b, hb, width}: the car ramp's top end, whose height comes from the street at runtime
- walls [{p, y0, y1, m}]: solid prisms (walls, columns, the core blocks, rails), drawn and used for collision
- facade [{i, b, open: [[t0, t1, y0, y1, kind]]}]: the outer walls, one per outline edge, with doors and the garage portal
- aprons [{p, a, n, depth, h, w}]: the ground outside each entrance, from the door's floor height out to the street
- cores [{b, c, u, top, lift: {p, door}}], hall {o, u, band, stair}, bays [{x, s, k, yaw, car}], items [[kind, x, s, k, yaw]]
"""
import math
import random

from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import split, unary_union

r2 = lambda v: round(float(v), 2)
r7 = lambda v: round(float(v), 7)               # walk floors meet along shared lines: keep them exact (the joins are tested to 1e-6 m)
P7 = lambda q: [[r7(x), r7(s)] for x, s in q]
add = lambda p, q: (p[0] + q[0], p[1] + q[1])
mul = lambda p, k: (p[0] * k, p[1] * k)
sub = lambda p, q: (p[0] - q[0], p[1] - q[1])
dot = lambda p, q: p[0] * q[0] + p[1] * q[1]
unit = lambda p: mul(p, 1 / math.hypot(*p))
perp = lambda u: (-u[1], u[0])                  # with u along a wing, perp(u) is 90 degrees clockwise on the map
mid = lambda p, q: ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)


class Frame:
    """A rectangle frame on the map: a along u, b along perp(u), from origin o."""
    def __init__(self, o, u):
        self.o, self.u, self.v = o, unit(u), perp(unit(u))

    def at(self, a, b):
        return add(self.o, add(mul(self.u, a), mul(self.v, b)))

    def rect(self, a0, a1, b0, b1):
        return [self.at(a0, b0), self.at(a1, b0), self.at(a1, b1), self.at(a0, b1)]

    def local(self, p):
        d = sub(p, self.o)
        return dot(d, self.u), dot(d, self.v)


def pts(poly):
    return P7(list(poly.exterior.coords)[:-1])


def simple(geom, u, depth=0):
    """Split polygons with holes into simple ones by cuts across u through the middle of each hole (walk floors have no holes)."""
    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom] if geom.geom_type == 'Polygon' else [g for g in getattr(geom, 'geoms', []) if g.geom_type == 'Polygon']
    out = []
    for p in polys:
        p = p.buffer(0)
        if p.is_empty or p.area < .5:
            continue
        if not p.interiors:
            out.append(p.simplify(.01))
            continue
        assert depth < 12, ('could not split a floor', p.area, [list(i.coords)[:5] for i in p.interiors][:2])
        v = perp(u)
        ring = list(p.interiors[0].coords)
        proj = [dot(q, u) for q in ring]
        c = mul(u, (min(proj) + max(proj)) / 2)          # a cut across the middle of the hole leaves two notched pieces
        line = LineString([add(c, mul(v, -1e5)), add(c, mul(v, 1e5))])
        pieces = list(split(p, line).geoms)
        for q in pieces:
            out.extend(simple(q, u, depth + 1))
    return out


def design(P, blocks, edge_ground, L1, G, U, PAR, plan=None):
    rnd = random.Random(85)
    H = {-1: L1 - 6.8, 0: L1 - 3.4, 1: L1}
    for k in range(2, 14):
        H[k] = L1 + G + (k - 2) * U
    B = {b['name']: b for b in blocks}
    poly = {n: Polygon(b['poly']) for n, b in B.items()}
    F = {n: b['floors'] for n, b in B.items()}
    F['hall'] = 9
    outline = Polygon(P)
    floors, slopes, walls, items = [], [], [], []

    def floor(k, geom, use, b, u, h=None):
        for q in simple(geom, u):
            floors.append({'k': k, 'h': r2(H[k] if h is None else h), 'p': pts(q), 'use': use, 'b': b})

    def wall(p, y0, y1, m='wall'):
        walls.append({'p': [[r2(x), r2(s)] for x, s in p], 'y0': r2(y0), 'y1': r2(y1), 'm': m})

    def slope(p, a, b, ha, hb, kind):
        slopes.append({'p': P7(p), 'a': [r7(a[0]), r7(a[1])], 'b': [r7(b[0]), r7(b[1])], 'ha': r2(ha), 'hb': r2(hb), 'kind': kind})

    def seg_wall(p, q, t, y0, y1, m='wall', side=1):
        """A wall of thickness t on one side of the line p -> q."""
        n = mul(perp(unit(sub(q, p))), t * side)
        wall([p, q, add(q, n), add(p, n)], y0, y1, m)

    # ---------- Cores: a switchback stair and a lift in each wing ----------
    # (block, outer end of the wing, unit vector toward the hub, distance from the end, sideways offset)
    CORES = [('NW', mid(P[0], P[1]), sub(P[2], P[1]), 26, 0), ('W', mid(P[4], P[5]), sub(P[3], P[4]), 40, 0),
             ('SW', mid(P[8], P[9]), sub(P[7], P[8]), 20, 0), ('S', mid(P[12], P[13]), sub(P[11], P[12]), 18, 0),
             ('S', mid(P[16], P[18]), sub(P[19], P[18]), 15, 0), ('E', mid(P[21], P[22]), sub(P[23], P[22]), 22, 0)]
    CA, CB = 7.0, 8.2                            # core size along / across the wing
    cores, core_rects = [], {}
    for n, (b, end, u, d, lat) in enumerate(CORES):
        u = unit(u)
        c = add(add(end, mul(u, d)), mul(perp(u), lat))
        # Core frame: a = 0 is the face toward the hub (the doors), a grows away from it; b across.
        f = Frame(c, mul(u, -1))
        f = Frame(f.at(-CA / 2, -CB / 2), f.u)
        top = 10 if b == 'NW' else F[b]           # the north-west core goes on up to the roof terrace
        rect = Polygon(f.rect(0, CA, 0, CB))
        assert poly[b].buffer(-1).contains(rect), f'core {n} is not inside block {b}'
        core_rects.setdefault(b, []).append(rect)
        bottom, roofk = H[-1] - .4, H[top] + 3.2
        cores.append({'b': b, 'c': [r2(c[0]), r2(c[1])], 'u': [round(f.u[0], 4), round(f.u[1], 4)], 'o': [r2(f.o[0]), r2(f.o[1])], 'top': top,
                      'lift': {'p': P7(f.rect(.25, 2.85, 5.4, 8.0)), 'door': [r2(v) for v in f.at(0, 6.7)]}})
        # Outer walls (the door face a = 0 has a stair door at b 0.5-2.0 and a lift door at b 5.9-7.5 on every level).
        for (a0, a1, b0, b1) in ((CA - .25, CA, 0, CB), (0, CA, 0, .25), (0, CA, CB - .25, CB)):
            wall(f.rect(a0, a1, b0, b1), bottom, roofk, 'core')
        for k in range(-1, top + 1):
            y0, y1 = H[k] - .4, (H[k + 1] - .4) if k < top else roofk
            for (b0, b1) in ((.25, .5), (2.0, 5.9), (7.5, CB - .25)):
                wall(f.rect(0, .25, b0, b1), y0, y1, 'core')
            for (b0, b1) in ((.5, 2.0), (5.9, 7.5)):
                wall(f.rect(0, .25, b0, b1), H[k] + 2.25, y1, 'core')
        wall(f.rect(.25, CA - .25, 5.0, 5.4), bottom, roofk, 'core')          # stair | lift
        wall(f.rect(2.85, 3.1, 5.4, CB - .25), bottom, roofk, 'core')          # lift back wall
        wall(f.rect(3.1, CA - .25, 5.4, CB - .25), bottom, roofk, 'coreBlock')  # toilets and shafts
        wall(f.rect(1.6, 5.4, 2.45, 2.55), bottom, H[top] + 1.1, 'rail')       # between the two flights
        for k in range(-1, top + 1):
            floors.append({'k': k, 'h': r2(H[k]), 'p': P7(f.rect(0, 1.6, .25, 5.0)), 'use': 'stair', 'b': b})
            floors.append({'k': k, 'h': r2(H[k]), 'p': P7(f.rect(0, 2.85, 5.4, 8.0)), 'use': 'lift', 'b': b})
            if k < top:
                h = H[k + 1] - H[k]
                floors.append({'k': k, 'h': r2(H[k] + h / 2), 'p': P7(f.rect(5.4, CA - .25, .25, 5.0)), 'use': 'stair', 'b': b})
                slope(f.rect(1.6, 5.4, .25, 2.45), f.at(1.6, 1.3), f.at(5.4, 1.3), H[k], H[k] + h / 2, 'stair')
                slope(f.rect(1.6, 5.4, 2.55, 5.0), f.at(5.4, 3.8), f.at(1.6, 3.8), H[k] + h / 2, H[k + 1], 'stair')

    # ---------- The glass hall ----------
    hf = Frame(P[25], sub(P[24], P[25]))          # a along the timber (north) wall from its west end, b south into the hall
    hall_len = math.hypot(*sub(P[24], P[25]))
    band = poly['hall'].intersection(Polygon(hf.rect(-30, hall_len + 30, 0, 4.5)))
    S0, SL, RUN = 17.0, 2.0, 6.0                  # the stair: main landing a 17-19, flights 19-25, half landing 25-27
    sb = (4.5, 6.5, 6.6, 8.6)                     # strip B (north, by the gallery) and strip A (south)
    stair_rect = Polygon(hf.rect(S0, S0 + 2 * SL + RUN, sb[0], sb[3]))
    floor(1, poly['hall'], 'hall', 'hall', hf.u)
    for k in range(2, 10):
        floor(k, band, 'gallery', 'hall', hf.u)
        floors.append({'k': k, 'h': r2(H[k]), 'p': P7(hf.rect(S0, S0 + SL, sb[0], sb[3])), 'use': 'stair', 'b': 'hall'})
    for k in range(1, 9):
        h = H[k + 1] - H[k]
        floors.append({'k': k, 'h': r2(H[k] + h / 2), 'p': P7(hf.rect(S0 + SL + RUN, S0 + 2 * SL + RUN, sb[0], sb[3])), 'use': 'stair', 'b': 'hall'})
        slope(hf.rect(S0 + SL, S0 + SL + RUN, sb[2], sb[3]), hf.at(S0 + SL, 7.6), hf.at(S0 + SL + RUN, 7.6), H[k], H[k] + h / 2, 'hallstair')
        slope(hf.rect(S0 + SL, S0 + SL + RUN, sb[0], sb[1]), hf.at(S0 + SL + RUN, 5.5), hf.at(S0 + SL, 5.5), H[k] + h / 2, H[k + 1], 'hallstair')
    wall(hf.rect(S0 + SL, S0 + SL + RUN, sb[1], sb[2]), H[1] - .1, H[9] + 1.1, 'glassRail')
    wall(hf.rect(S0 + SL + 1.5, S0 + 2 * SL + RUN, sb[0], sb[3]), H[1] - .1, H[1] + .3, 'under')   # nobody walks under the stair
    hall = {'o': [r2(v) for v in hf.o], 'u': [round(hf.u[0], 4), round(hf.u[1], 4)], 'len': r2(hall_len), 'band': 4.5, 'stair': [S0, SL, RUN, *sb],
            'south': [[r2(v) for v in P[10]], [r2(v) for v in P[11]]], 'lean': 7.0, 'roof': r2(H[10])}

    # ---------- The garage ramp (street -> P1) in the west wing, and P1 -> P2 under the hall ----------
    wf = Frame(P[4], sub(P[3], P[4]))             # a along the west wing's north face from its west end, b south
    RA0, RA1, RB = .4, 6.9, 22.0                  # lane across, and where it reaches P1
    ramp_a = Polygon(wf.rect(0, RB, RA0, RA1))
    corridor = Polygon(wf.rect(0, 15.0, RA0 - .3, RA1 + .3))
    portal = {'p': P7(wf.rect(-2.0, RB, RA0, RA1)), 'a': [r7(v) for v in wf.at(-2.0, (RA0 + RA1) / 2)],
              'b': [r7(v) for v in wf.at(RB, (RA0 + RA1) / 2)], 'hb': r2(H[0]), 'top': 1.0, 'width': RA1 - RA0}
    for side in (RA0 - .3, RA1):
        wall(wf.rect(0, RB, side, side + .3), H[0], H[2] - .4, 'concrete')
    wall(wf.rect(15.0, 15.3, RA0 - .3, RA1 + .3), H[1] - .4, H[2] - .4, 'concrete')              # over the ramp under L1
    bf = Frame(hf.at(0, 13.5), hf.u)             # under the hall: a along the hall, b across from its middle
    ramp_b = Polygon(bf.rect(6.0, 32.0, 0, 6.5))
    slope(bf.rect(8.0, 32.0, 0, 6.5), bf.at(8.0, 3.25), bf.at(32.0, 3.25), H[0], H[-1], 'car')
    floors.append({'k': 0, 'h': r2(H[0]), 'p': P7(bf.rect(6.0, 8.0, 0, 6.5)), 'use': 'garage', 'b': 'hall'})
    for side in (-.3, 6.5):
        wall(bf.rect(8.0, 30.0, side, side + .3), H[-1], H[0] - .4, 'concrete')                   # the ramp's tunnel at P2
        wall(bf.rect(10.0, 32.0, side, side + .3), H[0] - .1, H[0] + 1.1, 'rail')                # its railings at P1
    wall(bf.rect(32.0, 32.3, -.3, 6.8), H[0] - .1, H[0] + 1.1, 'rail')

    # ---------- Floors ----------
    all_cores = unary_union([r for rs in core_rects.values() for r in rs])
    floor(0, outline.difference(ramp_a).difference(ramp_b).difference(all_cores), 'garage', 'garage', hf.u)
    floor(-1, outline.difference(ramp_b.buffer(-.01)).difference(all_cores).difference(Polygon(bf.rect(6.0, 8.0, 0, 6.5))), 'garage', 'garage', hf.u)
    AUD = Polygon(wf.rect(16.0, 34.0, .4, 22.4)).intersection(poly['W'])
    axis = {'NW': unit(sub(P[2], P[1])), 'W': wf.u, 'SW': unit(sub(P[7], P[8])), 'S': unit(sub(P[11], P[12])), 'E': unit(sub(P[23], P[22]))}
    for n in ('NW', 'W', 'SW', 'S', 'E'):
        holes = unary_union(core_rects.get(n, []))
        for k in range(1, F[n] + 1):
            g = poly[n].difference(holes)
            if n == 'W' and k == 1:
                g = g.difference(corridor).difference(AUD)
            use = 'office' if k > 1 else {'NW': 'cafe', 'W': 'foyer', 'SW': 'canteen', 'S': 'restaurant', 'E': 'bikes'}[n]
            if k in (2, 3) and n in ('NW', 'W', 'SW'):
                use = 'collektivet'
            if n == 'SW' and k == 10:
                use = 'skybar'
            floor(k, g, use, n, axis[n])
    floor(10, poly['NW'].difference(unary_union(core_rects['NW'])), 'terrace', 'NW', axis['NW'])

    # The auditorium: a stage at the west end and eight tiers rising 0.3 m each toward the hall (each a step, so you walk up).
    af = Frame(wf.at(16.0, .4), wf.u)
    stage_end, tiers = 4.5, 8
    floor(1, AUD.intersection(Polygon(af.rect(-1, stage_end + 2.0, -1, 23))), 'auditorium', 'W', wf.u)
    for t in range(tiers):
        a0, a1 = stage_end + 2.0 + t * .95, stage_end + 2.0 + (t + 1) * .95
        if t == tiers - 1:
            a1 = 18.5
        floor(1, AUD.intersection(Polygon(af.rect(a0, a1, -1, 23))), 'auditorium', 'W', wf.u, H[1] + .3 * (t + 1))
        if t < tiers - 1:
            for b0, b1 in ((1.6, 9.6), (11.0, 20.4)):
                items.append(['seatrow', *[r2(v) for v in af.at((a0 + a1) / 2 + .1, (b0 + b1) / 2)], 1, round(math.atan2(af.u[1], af.u[0]), 4), r2(b1 - b0), r2(.3 * (t + 1))])
    # its walls: the hall end (doors at the ends of the two aisles), the corridor side, and the sheet piling behind the stage
    for (b0, b1) in ((-.1, .9), (2.2, 9.9), (10.9, 20.1), (21.4, 22.1)):
        wall(af.rect(18.0, 18.3, b0, b1), H[1] - .1, H[2] - .4, 'auditoriumWall')
    wall(af.rect(-.3, 0, -.1, 22.1), H[1] - .1, H[2] - .4, 'piling')
    items.append(['stage', *[r2(v) for v in af.at(stage_end / 2, 11.0)], 1, round(math.atan2(af.u[1], af.u[0]), 4), r2(stage_end), .6])

    # ---------- The outer walls, doors and the garage portal ----------
    ENTR = {10: (.5, 6.0, 1, 'main'), 24: (.5, 4.0, 1, 'north'), 0: (.5, 3.0, 1, 'door'), 8: (.5, 3.0, 1, 'door'), 12: (.5, 3.0, 1, 'door'), 21: (.5, 3.0, 2, 'door')}
    facade, aprons = [], []
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        m = mid(a, b)
        n = unit(perp(sub(b, a)))
        if outline.contains(Point(add(m, mul(n, .5)))):
            n = mul(n, -1)
        blk = next(k for k, p in poly.items() if p.buffer(.05).contains(Point(add(m, mul(n, -.3)))))
        L = math.hypot(*sub(b, a))
        opens = []
        if i in ENTR:
            t, w, k, kind = ENTR[i]
            t0, t1 = t - w / 2 / L, t + w / 2 / L
            opens.append([round(t0, 4), round(t1, 4), r2(H[k]), r2(H[k] + 2.6), kind])
            depth = 6.0 if kind == 'main' or k == 2 else 4.0
            c = add(a, mul(sub(b, a), t))
            ap = [add(add(c, mul(unit(sub(b, a)), -(w / 2 + .5))), mul(n, -.05)), add(add(c, mul(unit(sub(b, a)), w / 2 + .5)), mul(n, -.05)),
                  add(add(c, mul(unit(sub(b, a)), w / 2 + .5)), mul(n, depth)), add(add(c, mul(unit(sub(b, a)), -(w / 2 + .5))), mul(n, depth))]
            aprons.append({'p': P7(ap), 'a': [r7(c[0]), r7(c[1])], 'n': [round(n[0], 4), round(n[1], 4)], 'depth': depth, 'h': r2(H[k]), 'w': w + 1, 'kind': kind})
        if i == 4:                                  # the garage portal at the west wing's end, on the north side
            t0, t1 = (RA0 - .3) / L, (RA1 + .3) / L
            opens.append([round(t0, 4), round(t1, 4), r2(H[1] - .9), r2(H[1] + 3.0), 'portal'])
        facade.append({'i': i, 'b': blk, 'n': [round(n[0], 4), round(n[1], 4)], 'open': opens})
        # collision: 0.3 m inside the line, from under the garage to the parapet, with the openings left out
        top = H[F[blk] + 1] + PAR if blk != 'hall' else H[10] + PAR
        cuts = sorted(opens)
        t = 0.0
        for o in cuts + [[1.0, 1.0, 0, 0, '']]:
            if o[0] > t:
                wall([add(a, mul(sub(b, a), t)), add(a, mul(sub(b, a), o[0])), add(add(a, mul(sub(b, a), o[0])), mul(n, -.3)), add(add(a, mul(sub(b, a), t)), mul(n, -.3))], H[-1] - .4, top, 'facadeHit')
            if o[0] < 1:
                p0, p1 = add(a, mul(sub(b, a), o[0])), add(a, mul(sub(b, a), o[1]))
                q = [p0, p1, add(p1, mul(n, -.3)), add(p0, mul(n, -.3))]
                wall(q, H[-1] - .4, o[2] - .05, 'facadeHit')
                wall(q, o[3], top, 'facadeHit')
            t = max(t, o[1])

    # Walls between blocks above the lower one's roof (the sky bar's glass door onto the roof terrace in the SW wing's wall).
    for n1 in poly:
        for n2 in poly:
            if n1 >= n2:
                continue
            line = poly[n1].boundary.intersection(poly[n2].boundary)
            segs = [g for g in (getattr(line, 'geoms', [line])) if g.geom_type == 'LineString' and g.length > .5]
            t1, t2 = F[n1] + 1, F[n2] + 1
            if t1 == t2:
                continue
            tall, low = (n1, n2) if t1 > t2 else (n2, n1)
            for g in segs:
                c = list(g.coords)
                for p, q in zip(c, c[1:]):
                    nrm = unit(perp(sub(q, p)))
                    if not poly[tall].contains(Point(add(mid(p, q), mul(nrm, .5)))):
                        nrm = mul(nrm, -1)
                    y0, y1 = H[min(t1, t2)], H[max(t1, t2)] + PAR
                    L = math.hypot(*sub(q, p))
                    if {tall, low} == {'SW', 'NW'} and L > 6:
                        d0, d1 = .5 - 1.5 / L, .5 + 1.5 / L
                        pa, pb = add(p, mul(sub(q, p), d0)), add(p, mul(sub(q, p), d1))
                        for (u0, u1) in ((p, pa), (pb, q)):
                            wall([u0, u1, add(u1, mul(nrm, .3)), add(u0, mul(nrm, .3))], y0 - .1, y1, 'glassWall')
                        wall([pa, pb, add(pb, mul(nrm, .3)), add(pa, mul(nrm, .3))], y0 + 2.6, y1, 'glassWall')
                    else:
                        wall([p, q, add(q, mul(nrm, .3)), add(p, mul(nrm, .3))], y0 - .1, y1, 'innerFacade' if low != 'hall' else 'glassWall')
    # The roof terrace's railing toward the hall's glass roof.
    seg_wall(tuple(P[25]), tuple(B['NW']['poly'][4]), .15, H[10] - .1, H[10] + 1.2, 'glassRail', side=-1)

    # ---------- Garage: an aisle down each wing with bays on both sides, columns, cars ----------
    bays = []
    garage_free = {0: unary_union([Polygon(f['p']) for f in floors if f['k'] == 0 and f['use'] == 'garage']).buffer(-.3),
                   -1: unary_union([Polygon(f['p']) for f in floors if f['k'] == -1 and f['use'] == 'garage']).buffer(-.3)}
    keep_clear = unary_union([all_cores.buffer(1.5), ramp_a.buffer(1.0), ramp_b.buffer(1.0), Polygon(wf.rect(RB, RB + 8, RA0 - 2, RA1 + 2))])
    WINGS = [(mid(P[0], P[1]), unit(sub(P[2], P[1])), 70), (mid(P[4], P[5]), wf.u, 50), (mid(P[8], P[9]), unit(sub(P[7], P[8])), 60),
             (mid(P[12], P[13]), unit(sub(P[11], P[12])), 42), (mid(P[16], P[18]), unit(sub(P[19], P[18])), 40), (mid(P[21], P[22]), unit(sub(P[23], P[22])), 55)]
    columns = []
    for end, u, length in WINGS:
        g = Frame(end, u)
        for k in (0, -1):
            for side in (-1, 1):
                for j in range(int(length / 2.5)):
                    a0 = 1.0 + j * 2.5
                    b0, b1 = (3.0, 8.0) if side > 0 else (-8.0, -3.0)
                    r = Polygon(g.rect(a0, a0 + 2.5, b0, b1))
                    if not garage_free[k].contains(r) or r.intersects(keep_clear):
                        continue
                    c = g.at(a0 + 1.25, (b0 + b1) / 2)
                    yaw = math.atan2(g.v[1] * side, g.v[0] * side)       # nose toward the wing's side wall
                    bays.append({'x': r2(c[0]), 's': r2(c[1]), 'k': k, 'yaw': round(yaw, 4), 'car': rnd.random() < .68, 'colour': rnd.randrange(8)})
                for j in range(0, int(length / 7.5) + 1):
                    for bb in (8.25, -8.25, 3.0 - .25 if side > 0 else -3.0 + .25):
                        c = g.at(1.0 + j * 7.5, bb if abs(bb) > 4 else bb)
                        q = Polygon(Frame(c, u).rect(-.25, .25, -.25, .25))
                        if garage_free[k].buffer(-.2).contains(q) and not q.intersects(keep_clear) and not any(abs(c[0] - x) < .6 and abs(c[1] - s) < .6 and kk == k for x, s, kk in columns):
                            columns.append((c[0], c[1], k))
                            wall(Frame(c, u).rect(-.25, .25, -.25, .25), H[k] - .05, H[k + 1] - .4, 'column')
    # Drivable cars: four on each level, nearest the ramps (they replace the parked shells there).
    for k in (0, -1):
        lv = sorted([b for b in bays if b['k'] == k], key=lambda b: Point(b['x'], b['s']).distance(ramp_b))
        for b in lv[:4]:
            b['car'] = 'drive'

    # ---------- Furniture ----------
    def grid(geom, u, da, db, inset, kind, k, extra=0.0, keep=None):
        f = Frame((0, 0), u)
        inner = geom.buffer(-inset)
        if inner.is_empty:
            return
        coords = [f.local(q) for q in geom.exterior.coords] if geom.geom_type == 'Polygon' else [f.local(q) for g in geom.geoms for q in g.exterior.coords]
        a_min, a_max = min(c[0] for c in coords), max(c[0] for c in coords)
        b_min, b_max = min(c[1] for c in coords), max(c[1] for c in coords)
        a = a_min + inset
        while a < a_max:
            b = b_min + inset
            while b < b_max:
                c = f.at(a, b)
                if inner.contains(Point(c)) and (keep is None or not keep.contains(Point(c))):
                    items.append([kind, r2(c[0]), r2(c[1]), k, round(math.atan2(u[1], u[0]) + extra, 4)])
                b += db
            a += da

    blocked = all_cores.buffer(2.2)
    for n in ('NW', 'W', 'SW', 'S', 'E'):
        for k in range(1, F[n] + 1):
            g = poly[n].difference(blocked)
            if k == 1:
                kind = {'NW': ('table', 3.2, 3.2), 'W': None, 'SW': ('table', 3.0, 3.4), 'S': ('table', 3.2, 3.2), 'E': ('bike', 4.4, 2.8)}[n]
                if kind:
                    grid(g, axis[n], kind[1], kind[2], 2.4, kind[0], k)
                continue
            if n == 'SW' and k == 10:
                grid(g, axis[n], 3.6, 3.6, 2.6, 'sofa', k)
                continue
            grid(g, axis[n], 4.4 if k > 3 or n not in ('NW', 'W', 'SW') else 5.0, 3.8, 2.3, 'desk', k)
    grid(poly['NW'].difference(all_cores.buffer(2)), axis['NW'], 7.0, 6.0, 2.5, 'planter', 10)
    # The hall's ground floor: reception by the main door, the café along the timber wall, trees, timber benches.
    items.append(['reception', *[r2(v) for v in hf.at(hall_len * .5, 19.5)], 1, round(math.atan2(hf.u[1], hf.u[0]), 4)])
    items.append(['cafe', *[r2(v) for v in hf.at(8.5, 2.2)], 1, round(math.atan2(hf.u[1], hf.u[0]), 4)])
    for a, b in ((6, 10), (11, 15), (33, 11), (37, 16), (29, 20), (10, 20)):
        items.append(['tree', *[r2(v) for v in hf.at(a, b)], 1, 0])
    for a, b in ((5, 6.5), (9, 6.5), (13, 6.5)):
        items.append(['table', *[r2(v) for v in hf.at(a, b)], 1, 0])
    for a in (31, 35, 39):
        items.append(['bench', *[r2(v) for v in hf.at(a, 5.6)], 1, round(math.atan2(hf.u[1], hf.u[0]), 4)])
    bar = Frame(add(core_rects['SW'][0].centroid.coords[0], (0, 0)), axis['SW'])
    items.append(['bar', *[r2(v) for v in bar.at(-9.0, 0)], 10, round(math.atan2(axis['SW'][1], axis['SW'][0]) + math.pi / 2, 4)])
    items.append(['board', *[r2(v) for v in bar.at(10.0, 0)], 10, round(math.atan2(axis['SW'][1], axis['SW'][0]), 4)])
    items.append(['counter', *[r2(v) for v in Frame(mid(P[8], P[9]), axis['SW']).at(6.0, 0)], 1, round(math.atan2(axis['SW'][1], axis['SW'][0]) + math.pi / 2, 4)])
    items = [it for it in items if not (it[0] in ('table', 'desk', 'sofa') and any(Point(it[1], it[2]).distance(Point(*bar.at(dx, 0))) < 4.2 for dx in (-9.0, 10.0)) and it[3] == 10)]

    if plan:
        draw_plan(plan, P, floors, slopes, walls, bays, items, H)
    print(f'floors {len(floors)}, slopes {len(slopes)}, walls {len(walls)}, bays {len(bays)} ({sum(1 for b in bays if b["car"])} with a car), items {len(items)}, columns {len(columns)}')
    return {'H': {str(k): r2(v) for k, v in H.items()}, 'floors': floors, 'slopes': slopes, 'portal': portal, 'walls': walls, 'facade': facade, 'aprons': aprons,
            'cores': cores, 'hall': hall, 'bays': bays, 'items': items}


def draw_plan(path, P, floors, slopes, walls, bays, items, H):
    from PIL import Image, ImageDraw
    S, ox, oy = 6, 1755, 1325
    for k in (-1, 0, 1, 2, 10):
        im = Image.new('RGB', (225 * S, 150 * S), 'white')
        d = ImageDraw.Draw(im)
        T = lambda p: ((p[0] - ox) * S, (p[1] - oy) * S)
        d.polygon([T(p) for p in P], outline='black')
        for f in floors:
            if f['k'] == k:
                col = {'garage': (220, 220, 220), 'stair': (250, 200, 120), 'lift': (120, 200, 250), 'gallery': (255, 230, 180), 'hall': (255, 245, 210), 'auditorium': (230, 190, 230), 'terrace': (190, 230, 190)}.get(f['use'], (235, 235, 250))
                d.polygon([T(p) for p in f['p']], fill=col, outline=(160, 160, 160))
        for s in slopes:
            if abs(s['ha'] - H[k]) < 2.6 or abs(s['hb'] - H[k]) < 2.6:
                d.polygon([T(p) for p in s['p']], fill=(255, 160, 160), outline='red')
        for w in walls:
            if w['y0'] <= H[k] + 1 <= w['y1']:
                d.polygon([T(p) for p in w['p']], fill='black' if w['m'] not in ('rail', 'glassRail', 'glassWall') else 'blue')
        for b in bays:
            if b['k'] == k:
                d.ellipse([T((b['x'] - .8, b['s'] - .8)), T((b['x'] + .8, b['s'] + .8))], fill=(200, 40, 40) if b['car'] == 'drive' else (90, 90, 160) if b['car'] else (200, 200, 200))
        for it in items:
            if it[3] == k:
                d.rectangle([T((it[1] - .6, it[2] - .6)), T((it[1] + .6, it[2] + .6))], fill=(40, 140, 40))
        im.save(f'{path}-{k}.png')
