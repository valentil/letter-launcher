#!/usr/bin/env python3
"""LLF-71: free-free natural frequencies of the 36 glyph solids (reference material: steel).

Why this exists: NativeCAD cad_modal needs a CalculiX/MYSTRAN binary and the shared
NativeCAD deployment has none (capability_missing 'fea'). So the same physics problem is solved
here: the exact glyph outlines of tools/cad/recipes/glyphs.json (1 m cap height, 0.4 m deep
extrusion; the 40 mm rim chamfer is left out, it moves the first modes by well under 1 %),
meshed with quadratic tetrahedra (C3D10, the element cad_modal defaults to) and solved as the
generalized eigenproblem K x = w^2 M x, free-free (6 rigid-body modes dropped).

  python3 tools/cad/glyph_modal.py --selftest
  python3 tools/cad/glyph_modal.py [--chars ABC] [--h 0.06] [--out modal_steel.json]

Needs numpy + scipy. Frequencies of a geometrically identical free body scale with
sqrt(E/rho) (see assets/cad/glyph_modes.json _comment), so only steel is solved.
"""
import json, math, os, sys, time
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as sla
from scipy.spatial import Delaunay

HERE = os.path.dirname(os.path.abspath(__file__))
E_STEEL, NU, RHO_STEEL = 200e9, 0.3, 7850.0
NMODES = 6


def load_outlines():
    rec = json.load(open(os.path.join(HERE, 'recipes', 'glyphs.json')))
    out = {}
    for op in rec['ops']:
        if op['tool'] == 'cad_extrude_profile':
            ch = op['as'][2:]
            a = op['args']
            out[ch] = ([np.array(a['outer'], float) / 1000.0], [np.array(h, float) / 1000.0 for h in a.get('holes', [])], a['depth'] / 1000.0)
    return out


def polygon_area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)


def resample(p, h):
    pts = []
    n = len(p)
    for i in range(n):
        a, b = p[i], p[(i + 1) % n]
        k = max(1, int(math.ceil(np.linalg.norm(b - a) / h)))
        for j in range(k):
            pts.append(a + (b - a) * j / k)
    return np.array(pts)


def inside(rings, pts):
    """even-odd point-in-polygon over all rings (outer + holes)."""
    res = np.zeros(len(pts), bool)
    for r in rings:
        x, y = pts[:, 0], pts[:, 1]
        c = np.zeros(len(pts), bool)
        n = len(r)
        for i in range(n):
            x1, y1 = r[i]; x2, y2 = r[(i + 1) % n]
            if y1 == y2: continue
            cond = ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / (y2 - y1) + x1)
            c ^= cond
        res ^= c
    return res


def dist_to_rings(rings, pts):
    d = np.full(len(pts), 1e9)
    for r in rings:
        n = len(r)
        for i in range(n):
            a, b = r[i], r[(i + 1) % n]
            ab = b - a; L2 = ab @ ab
            t = np.clip(((pts - a) @ ab) / L2, 0, 1)
            d = np.minimum(d, np.linalg.norm(pts - (a + t[:, None] * ab), axis=1))
    return d


def mesh_polygon(outers, holes, h):
    rings = outers + holes
    bnd = np.vstack([resample(r, h * 0.8) for r in rings])
    allp = np.vstack(rings)
    lo, hi = allp.min(0), allp.max(0)
    gx, gy = np.meshgrid(np.arange(lo[0], hi[0] + h, h), np.arange(lo[1], hi[1] + h, h))
    g = np.c_[gx.ravel(), gy.ravel()]
    g = g[inside(rings, g) & (dist_to_rings(rings, g) > 0.6 * h)]
    pts = np.vstack([bnd, g])
    tri = Delaunay(pts).simplices
    cen = pts[tri].mean(1)
    tri = tri[inside(rings, cen)]
    a, b, c = pts[tri[:, 0]], pts[tri[:, 1]], pts[tri[:, 2]]
    area = 0.5 * np.abs((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1]))
    tri = tri[area > 1e-7]
    used = np.unique(tri)
    remap = -np.ones(len(pts), int); remap[used] = np.arange(len(used))
    return pts[used], remap[tri]


def extrude_tets(p2, tri, depth, layers):
    n2 = len(p2)
    z = np.linspace(0, depth, layers + 1)
    pts = np.vstack([np.c_[p2, np.full(n2, zz)] for zz in z])
    tets = []
    t = np.sort(tri, axis=1)
    a, b, c = t[:, 0], t[:, 1], t[:, 2]
    for L in range(layers):
        o0, o1 = L * n2, (L + 1) * n2
        tets += [np.c_[a + o0, b + o0, c + o0, c + o1],
                 np.c_[a + o0, b + o0, b + o1, c + o1],
                 np.c_[a + o0, a + o1, b + o1, c + o1]]
    tets = np.vstack(tets)
    P = pts[tets]
    v = np.einsum('ij,ij->i', np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]), P[:, 3] - P[:, 0])
    flip = v < 0
    tets[flip] = tets[flip][:, [0, 2, 1, 3]]
    return pts, tets


def quadratic_nodes(pts, tets):
    pairs = [(0, 1), (1, 2), (0, 2), (0, 3), (1, 3), (2, 3)]
    ed = np.concatenate([np.sort(tets[:, [i, j]], axis=1) for i, j in pairs])
    uniq, inv = np.unique(ed, axis=0, return_inverse=True)
    inv = inv.ravel()
    nt = len(tets)
    mid = pts.shape[0] + inv.reshape(6, nt).T
    allp = np.vstack([pts, 0.5 * (pts[uniq[:, 0]] + pts[uniq[:, 1]])])
    return allp, np.hstack([tets, mid])


def gauss_tet(n=3):
    xj, wj = np.polynomial.legendre.leggauss(n); xj = 0.5 * (xj + 1); wj = 0.5 * wj
    pts, wts = [], []
    for i in range(n):
        for j in range(n):
            for k in range(n):
                u, v, t = xj[i], xj[j], xj[k]
                L1 = u; L2 = v * (1 - u); L3 = t * (1 - u) * (1 - v)
                J = (1 - u) ** 2 * (1 - v)
                pts.append((1 - L1 - L2 - L3, L1, L2, L3)); wts.append(wj[i] * wj[j] * wj[k] * J)
    return np.array(pts), np.array(wts)


def assemble(allp, t10, E, nu, rho):
    ne = len(t10)
    corner = allp[t10[:, :4]]
    M4 = np.concatenate([np.ones((ne, 4, 1)), corner], axis=2)
    inv = np.linalg.inv(M4)
    dL = inv[:, 1:, :].transpose(0, 2, 1)
    vol = np.abs(np.linalg.det(M4)) / 6.0
    lam = E * nu / ((1 + nu) * (1 - 2 * nu)); mu = E / (2 * (1 + nu))
    D = np.zeros((6, 6)); D[:3, :3] = lam
    D[0, 0] = D[1, 1] = D[2, 2] = lam + 2 * mu
    D[3, 3] = D[4, 4] = D[5, 5] = mu
    qp, qw = gauss_tet()
    pair = [(0, 1), (1, 2), (0, 2), (0, 3), (1, 3), (2, 3)]
    Ke = np.zeros((ne, 30, 30)); Me = np.zeros((ne, 30, 30))
    for L, w in zip(qp, qw):
        N = np.zeros(10); dN = np.zeros((ne, 10, 3))
        for i in range(4):
            N[i] = L[i] * (2 * L[i] - 1); dN[:, i] = (4 * L[i] - 1) * dL[:, i]
        for m, (a, b) in enumerate(pair):
            N[4 + m] = 4 * L[a] * L[b]; dN[:, 4 + m] = 4 * (L[a] * dL[:, b] + L[b] * dL[:, a])
        B = np.zeros((ne, 6, 30))
        for n in range(10):
            B[:, 0, 3 * n] = dN[:, n, 0]; B[:, 1, 3 * n + 1] = dN[:, n, 1]; B[:, 2, 3 * n + 2] = dN[:, n, 2]
            B[:, 3, 3 * n] = dN[:, n, 1]; B[:, 3, 3 * n + 1] = dN[:, n, 0]
            B[:, 4, 3 * n + 1] = dN[:, n, 2]; B[:, 4, 3 * n + 2] = dN[:, n, 1]
            B[:, 5, 3 * n] = dN[:, n, 2]; B[:, 5, 3 * n + 2] = dN[:, n, 0]
        wv = (6 * w * vol)[:, None, None]
        Ke += wv * (B.transpose(0, 2, 1) @ D @ B)
        NN = np.kron(N[:, None], np.eye(3)).T
        Me += wv * rho * (NN.T @ NN)[None]
    dofs = (3 * t10[:, :, None] + np.arange(3)).reshape(ne, 30)
    I = np.repeat(dofs, 30, axis=1).ravel(); J = np.tile(dofs, (1, 30)).ravel()
    nd = 3 * len(allp)
    K = sp.coo_matrix((Ke.ravel(), (I, J)), shape=(nd, nd)).tocsc()
    M = sp.coo_matrix((Me.ravel(), (I, J)), shape=(nd, nd)).tocsc()
    return K, M, vol.sum()


def free_free_modes(allp, t10, E, nu, rho, count=NMODES):
    K, M, vol = assemble(allp, t10, E, nu, rho)
    sigma = -2.0e5
    vals = sla.eigsh(K, k=count + 6 + 2, M=M, sigma=sigma, which='LM', return_eigenvectors=False)
    vals = np.sort(vals)
    f = np.sqrt(np.clip(vals, 0, None)) / (2 * math.pi)
    elastic = f[f > 5.0]
    return elastic[:count], vol


def solve_glyph(outers, holes, depth, h, layers=None):
    p2, tri = mesh_polygon(outers, holes, h)
    layers = layers or 4
    pts, tets = extrude_tets(p2, tri, depth, layers)
    allp, t10 = quadratic_nodes(pts, tets)
    f, vol = free_free_modes(allp, t10, E_STEEL, NU, RHO_STEEL)
    area = sum(polygon_area(o) for o in outers) - sum(abs(polygon_area(x)) for x in holes)
    return f, dict(tets=len(tets), nodes=len(allp), volErr=round(abs(vol / (abs(area) * depth) - 1), 4))


def selftest():
    # steel bar 1.0 x 0.1 x 0.05 m free-free; lowest mode = bending about the strong axis
    # (displacement along the 0.05 m thickness):
    # Euler-Bernoulli f1 = 22.373/(2 pi) sqrt(E I /(rho A L^4)); Timoshenko lowers it ~1-2 %.
    L, Wd, T = 1.0, 0.1, 0.05
    I = Wd * T ** 3 / 12; A = T * Wd
    f_eb = 22.373 / (2 * math.pi) * math.sqrt(E_STEEL * I / (RHO_STEEL * A * L ** 4))
    outer = np.array([[0, 0], [L, 0], [L, Wd], [0, Wd]], float)
    f, info = solve_glyph([outer], [], T, 0.04)
    print('bar f (Hz):', np.round(f, 1), info)
    print('Euler-Bernoulli bending f1:', round(f_eb, 1))
    err = abs(f[0] / f_eb - 1)
    print('relative error of lowest elastic mode: %.1f %%' % (100 * err))
    return err < 0.06


def main():
    a = sys.argv[1:]
    if '--selftest' in a:
        sys.exit(0 if selftest() else 1)
    h = float(a[a.index('--h') + 1]) if '--h' in a else 0.06
    chars = a[a.index('--chars') + 1] if '--chars' in a else 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    out = a[a.index('--out') + 1] if '--out' in a else os.path.join(HERE, 'modal_steel.json')
    res = json.load(open(out)) if os.path.exists(out) else {}
    G = load_outlines()
    for ch in chars:
        t0 = time.time()
        outers, holes, depth = G[ch]
        f, info = solve_glyph(outers, holes, depth, h)
        res[ch] = [round(float(x), 2) for x in f]
        print(ch, res[ch], info, '%.1fs' % (time.time() - t0), flush=True)
        json.dump(res, open(out, 'w'))


if __name__ == '__main__':
    main()
