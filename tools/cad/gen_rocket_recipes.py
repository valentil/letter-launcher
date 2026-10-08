#!/usr/bin/env python3
"""LLF-82: generate the three MOON ROCKET recipes (moon_rocket, launch_tower, lunar_lander) and the
'effective' stocks they use in tools/cad/materials.d/.

Why a generator: every part carries a PUBLIC mass (Apollo-era references) and is modelled as a
simple solid, so its stock density = public mass / modelled volume. The volume is analytic here
(prisms, frusta, revolves) and is cross-checked against cad_mass_properties by build_manifest.js.
Run:  python3 tools/cad/gen_rocket_recipes.py            (writes recipes + stocks)
      python3 tools/cad/gen_rocket_recipes.py --ops NAME (prints the cad_batch ops incl. cad_set_part)
"""
import json, math, os, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
PI = math.pi

def poly_vol(pts):  # revolve of closed [r,z] polygon about Z (Pappus)
    a = 0.0; cr = 0.0
    n = len(pts)
    for i in range(n):
        r0, z0 = pts[i]; r1, z1 = pts[(i + 1) % n]
        c = r0 * z1 - r1 * z0
        a += c; cr += (r0 + r1) * c
    a /= 2.0
    cr /= (6.0 * a)
    return abs(a) * 2 * PI * abs(cr)

def poly_cz(pts):  # z of the revolved solid's centroid: int(r z dA) / int(r dA) over the r-z polygon (exact)
    num = 0.0; den = 0.0; n = len(pts)
    for i in range(n):
        r0, z0 = pts[i]; r1, z1 = pts[(i + 1) % n]
        c = r0 * z1 - r1 * z0
        num += c * (r0 * z1 + 2 * r0 * z0 + 2 * r1 * z1 + r1 * z0) / 24.0
        den += c * (r0 + r1) / 6.0
    return num / den

def octagon(across_flats):
    f = across_flats / 2.0; s = across_flats * math.tan(math.radians(22.5)) / 2.0
    return [[f, -s], [f, s], [s, f], [-s, f], [-f, s], [-f, -s], [-s, -f], [s, -f]]

def poly_area(pts):
    return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2.0

WHITE = [0.92, 0.93, 0.94, 1]; BLACK = [0.05, 0.05, 0.06, 1]; GREY = [0.45, 0.46, 0.48, 1]
BELL = [0.30, 0.28, 0.27, 1]; GOLD = [0.78, 0.62, 0.30, 1]; RED = [0.75, 0.15, 0.10, 1]; STEEL = [0.55, 0.57, 0.60, 1]
ORANGE = [0.85, 0.40, 0.10, 1]; YELLOW = [0.85, 0.72, 0.15, 1]

class Asset:
    def __init__(self, name): self.name = name; self.ops = []; self.parts = []; self.stocks = {}
    def add(self, node, tool, args, vol, mass, color, metal=0.4, rough=0.5, note='', cen=None):
        ref = '$' + node
        self.mp = getattr(self, 'mp', {}); self.mp[node] = {'volumeMm3': round(vol, 3), 'centroidMm': [round(c, 4) for c in cen]}
        self.ops.append({'tool': tool, 'args': args, 'as': ref})
        stock = 'eff-%s-%s' % (self.name, node)
        dens = mass / (vol * 1e-9)
        self.parts.append({'of': ref + '.handle', 'material': stock, 'nodeName': node})
        self.stocks[stock] = {'densityKgM3': round(dens, 4),
            'pbr': {'baseColorFactor': color, 'metallicFactor': metal, 'roughnessFactor': rough},
            'source': 'effective stock for %s/%s: public mass %.0f kg / modelled volume %.4f m^3 (see recipe sources)%s' % (self.name, node, mass, vol * 1e-9, note)}
    def cyl(self, node, r, z0, z1, mass, color, **k):
        self.add(node, 'cad_cylinder', {'r': r, 'h': z1 - z0, 'origin': [0, 0, z0]}, PI * r * r * (z1 - z0), mass, color, cen=[0, 0, (z0 + z1) / 2.0], **k)
    def tube(self, node, ro, ri, z0, z1, mass, color, **k):
        self.add(node, 'cad_revolve_profile', {'profile': [[ri, z0], [ro, z0], [ro, z1], [ri, z1]]}, PI * (ro * ro - ri * ri) * (z1 - z0), mass, color, cen=[0, 0, (z0 + z1) / 2.0], **k)
    def revolve(self, node, prof, mass, color, **k):
        self.add(node, 'cad_revolve_profile', {'profile': prof}, poly_vol(prof), mass, color, cen=[0, 0, poly_cz(prof)], **k)
    def frust(self, node, x, y, r0, r1, z0, h, mass, color, **k):
        cz = z0 + h * (r0 * r0 + 2 * r0 * r1 + 3 * r1 * r1) / (4.0 * (r0 * r0 + r0 * r1 + r1 * r1))
        self.add(node, 'cad_frustum', {'r0': r0, 'r1': r1, 'h': h, 'origin': [x, y, z0]}, PI * h / 3 * (r0 * r0 + r0 * r1 + r1 * r1), mass, color, cen=[x, y, cz], **k)
    def box(self, node, x, y, z, dx, dy, dz, mass, color, **k):
        self.add(node, 'cad_box', {'dx': dx, 'dy': dy, 'dz': dz, 'origin': [x, y, z]}, dx * dy * dz, mass, color, cen=[x + dx / 2.0, y + dy / 2.0, z + dz / 2.0], **k)
    def ext(self, node, outer, depth, plane, vol, cen, mass, color, **k):
        self.add(node, 'cad_extrude_profile', {'outer': outer, 'depth': depth, 'plane': plane}, vol, mass, color, cen=cen, **k)
    def batch_ops(self):
        return self.ops + [{'tool': 'cad_set_part', 'args': {'of': p['of'], 'part': p['nodeName'], 'material': p['material']}} for p in self.parts]

EXPORT = {'lods': [{'tolerance': 1.0}, {'tolerance': 8}, {'tolerance': 40}], 'compression': {'quantize': True, 'instance': True},
          'creaseAngleDeg': 30, 'upAxis': 'Y', 'units': 'm', 'bakeTransforms': False}

# ---------------------------------------------------------------- the rocket (kernel mm, +Z up, base on z=0)
def rocket():
    A = Asset('moon_rocket')
    F1, J2 = 8391, 1788
    # S-IC: stage first (so cad_export_body's body order = parts order), five F-1 bells (centre one shorter), four fins
    A.cyl('s1_stage', 5050, 5000, 42100, 137000 - 5 * F1 - 4 * 1000, WHITE)
    A.frust('s1_f1_c', 0, 0, 1500, 600, 1500, 3500, F1, BELL, metal=0.8, rough=0.45)
    for i, (sx, sy) in enumerate([(1, 1), (-1, 1), (-1, -1), (1, -1)]):
        A.frust('s1_f1_%d' % (i + 1), sx * 2192, sy * 2192, 1850, 600, 0, 5000, F1, BELL, metal=0.8, rough=0.45)
    for i, (ox, oy, dx, dy) in enumerate([(5050, -150, 2400, 300), (-150, 5050, 300, 2400), (-7450, -150, 2400, 300), (-150, -7450, 300, 2400)]):
        A.box('s1_fin_%d' % (i + 1), ox, oy, 5000, dx, dy, 6000, 1000, BLACK)
    # S-II: hollow interstage skirt (S-II bells sit inside it), body, hollow S-II/S-IVB cone
    A.tube('s2_skirt', 5050, 4950, 42100, 46000, 5000, BLACK)
    A.frust('s2_j2_c', 0, 0, 1000, 400, 42600, 3400, J2, BELL, metal=0.8, rough=0.45)
    for i, (sx, sy) in enumerate([(1, 1), (-1, 1), (-1, -1), (1, -1)]):
        A.frust('s2_j2_%d' % (i + 1), sx * 1980, sy * 1980, 1000, 400, 42600, 3400, J2, BELL, metal=0.8, rough=0.45)
    A.cyl('s2_stage', 5050, 46000, 63970, 43000 - 5000 - 2000 - 5 * J2, WHITE)
    A.revolve('s2_cone', [[4950, 63970], [5050, 63970], [3400, 66970], [3300, 66970]], 2000, WHITE)
    # S-IVB: tank + the single J-2 hidden inside the cone
    A.frust('s3_j2', 0, 0, 1000, 400, 64070, 2900, J2, BELL, metal=0.8, rough=0.45)
    A.cyl('s3_stage', 3300, 66970, 84830, 15200 - J2, WHITE)
    A.cyl('iu', 3300, 84830, 85740, 2000, GREY)
    A.frust('sla', 0, 0, 3300, 1950, 85740, 8500, 1800, WHITE)
    A.cyl('csm_sm', 1950, 94240, 100500, 4100, GREY, metal=0.6)
    A.frust('csm_cm', 0, 0, 1950, 450, 100500, 3400, 5560, GOLD, metal=0.7, rough=0.35)
    A.cyl('les', 330, 103900, 110600, 4200, RED, rough=0.55)
    return A

def tower():
    A = Asset('launch_tower')
    A.box('crawlerway_pad', -35000, -30000, 0, 70000, 60000, 1000, 70 * 60 * 1 * 2400, GREY, metal=0.0, rough=0.9)
    A.box('crawler_transporter', -20000, -17500, 1000, 40000, 35000, 6100, 2721000, YELLOW, metal=0.2, rough=0.6)
    A.box('launch_platform', -24500, -20500, 7100, 49000, 41000, 7600, 3730000, GREY, metal=0.5, rough=0.6)
    top = 14700
    cx, cy, half = 16000, 0, 6000
    legs = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for i, (sx, sy) in enumerate(legs):
        x0 = cx + (4800 if sx > 0 else -half); y0 = cy + (4800 if sy > 0 else -half)
        A.box('tower_leg_%d' % (i + 1), x0, y0, top, 1200, 1200, 112000, 1500000 / 4, RED, metal=0.4, rough=0.6)
    decks = [20000, 45000, 70000, 95000]
    for i, dz in enumerate(decks):
        A.box('tower_deck_%d' % (i + 1), cx - half, cy - 4800, top + dz, 12000, 9600, 400, 150000, STEEL, metal=0.7)
    # swing arms: touch the +/-X face of the tower decks on the rocket side (x = cx-half = 10000)
    arm_z = [30000, 52000, 78000, 100000]
    for i, dz in enumerate(decks):
        zb = top + dz + 400 - 3000
        A.box('swing_arm_%d' % (i + 1), 5300, -1200, zb, 4700, 2400, 3000, 62500, WHITE, metal=0.3, rough=0.5)
    A.box('hammerhead_crane', cx - half, cy - half, top + 112000, 12000, 12000, 3000, 50000, STEEL, metal=0.6)
    return A

LEG_POLY = [[2100, 1700], [2100, 1300], [4400, 250], [4400, 0], [4700, 0], [4700, 300], [4650, 330]]

def lander():
    A = Asset('lunar_lander')
    ds = octagon(4200); asc = octagon(3600)
    A.ext('descent_stage', ds, 2100, {'origin': [0, 0, 600]}, poly_area(ds) * 2100, [0, 0, 1650], 1664, GOLD, metal=0.7, rough=0.35)
    A.frust('descent_engine', 0, 0, 750, 300, 100, 500, 180, BELL, metal=0.8)
    A.ext('ascent_stage', asc, 2832, {'origin': [0, 0, 2700]}, poly_area(asc) * 2832, [0, 0, 2700 + 1416], 1950, GREY, metal=0.5)
    A.cyl('docking_tunnel', 500, 5532, 5932, 150, STEEL, metal=0.7)
    A.cyl('antenna_mast', 60, 5932, 7040, 50, STEEL, metal=0.7)
    # four legs (strut + footpad as one part each), hinged where they meet the descent stage flats
    area = poly_area(LEG_POLY); vol = area * 300
    # centroid of the leg polygon in (x, z)
    cx = cz = 0.0; n = len(LEG_POLY)
    for i in range(n):
        x0, z0 = LEG_POLY[i]; x1, z1 = LEG_POLY[(i + 1) % n]
        c = x0 * z1 - x1 * z0
        cx += (x0 + x1) * c; cz += (z0 + z1) * c
    sa = sum(LEG_POLY[i][0] * LEG_POLY[(i + 1) % n][1] - LEG_POLY[(i + 1) % n][0] * LEG_POLY[i][1] for i in range(n)) / 2.0
    cx /= 6 * sa; cz /= 6 * sa
    dirs = [((1, 0), {'origin': [0, 150, 0], 'xAxis': [1, 0, 0], 'yAxis': [0, 0, 1]}),
            ((0, 1), {'origin': [-150, 0, 0], 'xAxis': [0, 1, 0], 'yAxis': [0, 0, 1]}),
            ((-1, 0), {'origin': [0, -150, 0], 'xAxis': [-1, 0, 0], 'yAxis': [0, 0, 1]}),
            ((0, -1), {'origin': [150, 0, 0], 'xAxis': [0, -1, 0], 'yAxis': [0, 0, 1]})]
    for i, (d, plane) in enumerate(dirs):
        A.ext('leg_%d' % (i + 1), LEG_POLY, 300, plane, vol, [cx * d[0], cx * d[1], cz], 47.5, STEEL, metal=0.7)
    return A

SRC_SAT = 'https://en.wikipedia.org/wiki/Saturn_V'
SRC_LM = 'https://en.wikipedia.org/wiki/Apollo_Lunar_Module'
SRC_MLP = 'https://en.wikipedia.org/wiki/Mobile_Launcher_Platform'
SRC_CT = 'https://en.wikipedia.org/wiki/Crawler-transporter'

META = {
    'moon_rocket': {
        'prompt': 'Three-stage heavy-lift moon rocket in the proportions of the Apollo-era Saturn V: 10.1 m S-IC (5 F-1 bells, 4 fins), S-II with its interstage skirt, five J-2 bells and conical interstage, 6.6 m S-IVB with its single J-2, instrument unit, spacecraft adaptor, service module, command module and launch-escape tower. 110.6 m tall, standing on its engine bells. Each stage is its own set of nodes so the game can separate them.',
        'kind': 'hero',
        'sources': [SRC_SAT, 'https://en.wikipedia.org/wiki/F-1_(rocket_engine)', 'https://en.wikipedia.org/wiki/Rocketdyne_J-2'],
        'dimensions': {
            'S-IC length / dia': '42.1 m incl. five F-1 bells / 10.1 m, source 1 (bells 5.0 m, centre bell 3.5 m shorter, assumed from photographs)',
            'S-II length / dia': '24.87 m incl. 3.9 m interstage skirt (assumed split) / 10.1 m, source 1',
            'S-IVB length / dia': '17.86 m / 6.6 m, source 1',
            'instrument unit': '0.91 m x 6.6 m, 2000 kg, source 1',
            'SLA / CSM / CM / LES': '8.5 m cone 6.6 -> 3.9 m, SM 3.9 m dia x 6.26 m visible, CM 3.4 m cone, LES 6.7 m tower (all assumed from Apollo drawings; total height set to 110.6 m)',
            'S-IC fins': '4 x 2.4 m span x 6 m chord x 0.3 m (assumed)',
            'total height': '110.6 m (Saturn V with spacecraft and LES), source 1',
            'dry masses': 'S-IC 137,000 kg (5 F-1 at 8,391 kg + 4 fins at 1,000 kg assumed), S-II 43,000 kg (5 J-2 at 1,788 kg, skirt 5,000 kg and cone 2,000 kg assumed), S-IVB 15,200 kg incl. J-2, IU 2,000, SLA 1,800 (assumed), SM 4,100, CM 5,560, LES 4,200 (assumed); sources 1-3',
        },
        'joints': [],
    },
    'launch_tower': {
        'prompt': 'Apollo-era launch complex for the moon rocket: crawlerway pad, crawler-transporter, 49 x 41 x 7.6 m mobile launch platform, four-leg umbilical tower with four service decks, four swing arms that reach the rocket and swing away at liftoff, and a hammerhead crane. Rocket axis is the origin; the platform top is 14.7 m above the ground.',
        'kind': 'prop',
        'budget': {'lod0Tris': 3000},
        'sources': [SRC_MLP, SRC_CT, SRC_SAT],
        'dimensions': {
            'platform': '49 x 41 x 7.6 m, 3,730 t, source 1',
            'crawler-transporter': '40 x 35 m, 6.1 m shown, 2,721 t unladen, source 2',
            'umbilical tower': 'about 120 m tall with nine swing arms on the real tower (source 1); modelled with four legs 1.2 m square, 12 x 12 m footprint (assumed), four of the nine arms',
            'swing arms': '4.7 m x 2.4 m x 3 m beams at deck heights 20/45/70/95 m above the platform (assumed), 62.5 t each (assumed)',
            'tower mass': 'legs 1,500 t, decks 4 x 150 t, crane 50 t (assumed, truss modelled as solid legs so the stock is an effective density)',
        },
        'joints': [{'node': 'swing_arm_%d' % i, 'type': 'revolute', 'axis': [0, 1, 0], 'min': -1.5707963, 'max': 0, 'note': 'hinge on the tower deck edge at kernel (10000, 1200) mm; 0 = engaged, -pi/2 = folded back along the tower face'} for i in range(1, 5)],
    },
    'lunar_lander': {
        'prompt': 'Apollo Lunar Module in the proportions of the public fact sheets: octagonal descent stage with a descent engine bell, octagonal ascent stage with docking tunnel and antenna mast, and four landing legs (strut plus footpad) that fold up on revolute hinges. 7.04 m tall, 9.4 m across the deployed footpads.',
        'kind': 'prop',
        'budget': {'lod0Tris': 3000},
        'sources': [SRC_LM],
        'dimensions': {
            'overall': '7.04 m tall, 4.22 m dia body, 9.4 m wide with gear deployed, source 1',
            'descent stage': '4.2 m across flats octagon, 2.1 m tall slab (assumed; stage is 3.231 m with gear fittings), dry mass 2,034 kg (engine 180, legs 4 x 47.5 assumed), source 1',
            'ascent stage': '2.832 m tall, 3.6 m across flats (source gives 4.29 x 4.04 m envelope), dry 2,150 kg, source 1',
            'footpads': 'about 0.94 m span (assumed)',
        },
        'joints': [{'node': 'leg_%d' % (i + 1), 'type': 'revolute', 'axis': ax, 'min': 0, 'max': 2.0, 'note': 'hinge at the descent-stage flat, GLB (2.1 m radius, 1.5 m up); 0 = deployed, +2.0 rad folds the leg up against the stage'} for i, ax in enumerate([[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]])],
    },
}

def write_recipe(A):
    m = META[A.name]
    r = {'name': A.name, 'prompt': m['prompt'], 'kind': m['kind']}
    if 'budget' in m: r['budget'] = m['budget']
    r['sources'] = m['sources']; r['dimensions'] = m['dimensions']; r['units'] = 'mm'
    r['ops'] = A.ops; r['parts'] = A.parts
    r['export'] = EXPORT_FOR[A.name]; r['joints'] = m['joints']
    json.dump(r, open(os.path.join(ROOT, 'tools', 'cad', 'recipes', A.name + '.json'), 'w'), indent=2); open(os.path.join(ROOT, 'tools', 'cad', 'recipes', A.name + '.json'), 'a').write('\n')
    mp = {'_frame': 'volume and centroid per part, kernel frame (mm, +Z up), unit density. Analytic (prisms, frusta, revolves); 13 rocket parts were spot-checked against cad_mass_properties (identical to <1e-9) and build_manifest.js cross-checks every part against the exported GLB mesh.'}
    mp.update(A.mp)
    json.dump(mp, open(os.path.join(ROOT, 'tools', 'cad', 'massprops', A.name + '.json'), 'w'), indent=2); open(os.path.join(ROOT, 'tools', 'cad', 'massprops', A.name + '.json'), 'a').write('\n')

EXPORT_FOR = {
    'moon_rocket': {'lods': [{'tolerance': 8}, {'tolerance': 100}, {'tolerance': 500}], 'compression': {'quantize': True, 'instance': True}, 'creaseAngleDeg': 30, 'upAxis': 'Y', 'units': 'm', 'bakeTransforms': False},
    'launch_tower': {'lods': [{'tolerance': 30}, {'tolerance': 150}, {'tolerance': 700}], 'compression': {'quantize': True, 'instance': True}, 'creaseAngleDeg': 30, 'upAxis': 'Y', 'units': 'm', 'bakeTransforms': False},
    'lunar_lander': {'lods': [{'tolerance': 2}, {'tolerance': 12}, {'tolerance': 60}], 'compression': {'quantize': True, 'instance': True}, 'creaseAngleDeg': 30, 'upAxis': 'Y', 'units': 'm', 'bakeTransforms': False},
}

def main():
    mat_dir = os.path.join(ROOT, 'tools', 'cad', 'materials.d')
    mats = {f[:-5]: json.load(open(os.path.join(mat_dir, f), encoding='utf8')) for f in sorted(os.listdir(mat_dir)) if f.endswith('.json')}
    for build in (rocket, tower, lander):
        A = build()
        for k, v in A.stocks.items(): mats[k] = v
        if len(sys.argv) > 2 and sys.argv[1] == '--ops' and sys.argv[2] == A.name:
            print(json.dumps(A.batch_ops(), separators=(',', ':'))); return
        json.dump({'ops': A.ops, 'parts': A.parts, 'n': len(A.ops) + len(A.parts)}, open('/tmp/_' + A.name + '.json', 'w'))
        write_recipe(A)
    for k, v in mats.items(): json.dump(v, open(os.path.join(mat_dir, k + '.json'), 'w', encoding='utf8'), indent=2, ensure_ascii=False)

if __name__ == '__main__': main()
