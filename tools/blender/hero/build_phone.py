"""H3 - the smartphone for the home-page hero (brand-less, script-built).

Object tree (all names [A-Za-z0-9_]):

    Phone               empty. Origin = centre of the body. Rest pose: the screen faces -Y (the
    |                   front camera), the phone stands upright along +Z, +X = right seen from
    |                   the front (the side buttons are on +X).
    |- Phone_Body       mesh: metal frame, black front glass (the bezel ring around the display),
    |                   matte back glass, side buttons, camera module, flash, USB-C port.
    |                   UVMap (copy of UV_AO, nothing textured uses it) + UV_AO (lightmap, texCoord
    |                   1): every body material reads images/phone_ao.png as occlusion.
    |- Phone_Screen     mesh: the display, exactly 390:844, rounded corners, material M_Screen.
    |                   UVMap: planar, u = (x - x0) / w, v = (z - z0) / h over the full 390 x 844
    |                   rectangle (the rounded corners cut the image like a real display). In
    |                   Blender v = 1 is the top of the phone. The glTF exporter flips V, so in the
    |                   GLB / three.js TEXCOORD_0 has v = 0 at the top: load the screen captures
    |                   with texture.flipY = false (the GLTFLoader convention) or sample (u, 1 - v).
    |- Phone_PunchHole  mesh: the front camera, a dark ring + glossy lens dome, 0.05 mm in front
    |                   of the screen.
    '- Phone_ScreenDock empty: where the gift lands. Location = centre of the Valentinstag DE
                        sceneRect on the screen + an offset along the screen normal. Uniform
                        scale = scene-area height (m) / 2.1497 (visible height of the billet
                        camera, 2 * 2.8 * tan(21 deg)), so a gift fitted in billet units sits as
                        large in the scene area as in the real billet. Offset = 0.55 * 1.6 * scale.
                        Frame: "local +Z = screen normal, +Y = screen up" is the three.js / billet
                        frame (the billet camera looks down -Z with +Y up). The dock therefore has
                        the IDENTITY rotation under Phone: in Blender its local -Y is the screen
                        normal and +Z the screen up (a Z-up Blender gift stands upright), and after
                        the glTF Z-up -> Y-up conversion its three.js local +Z is the screen normal
                        and +Y the screen up (a Y-up billet gift needs no extra rotation).

Construction: every part is a profile swept along a rounded rectangle (constant corner centres,
so all offset curves are concentric): vertex(i, j) = corner_centre_i + (r - inset_j) * dir_i +
height_j * plane_normal. The normals are the analytic normals of that surface (exact on the long
straight sides, split at the creases), so the glossy frame shows no shading gradients.

Dimensions: the display must be exactly 390:844 with even ~1.4 mm black bezels, so the body is
derived from the display: 67.0 x 145.0 mm display + 2.0 mm per side (1.38 mm black glass + 0.62
mm metal rim) = 71.0 x 149.0 x 7.9 mm body, corner radius 9.5 mm (display corners 7.5 mm).
"""

from __future__ import annotations

import glob
import json
import math
import os
import struct

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import common
from common import Ctx, log, rnd

MM = 1e-3

# ---------------------------------------------------------------------------------------------
# Dimensions (metres)
# ---------------------------------------------------------------------------------------------
CSS_W, CSS_H = 390, 844            # capture window (hero-captures.json, kind "screen")
DISPLAY_W = 0.0670
DISPLAY_H = DISPLAY_W * CSS_H / CSS_W   # 144.995 mm
SIDE = 0.0020                      # display edge -> body silhouette (black glass + metal rim)
BODY_W = DISPLAY_W + 2 * SIDE      # 71.0 mm
BODY_H = DISPLAY_H + 2 * SIDE      # 149.0 mm
DEPTH = 0.0079
HD = DEPTH / 2
R_BODY = 0.0095                    # body corner radius (display corners R_BODY - SIDE)
R_DISPLAY = R_BODY - SIDE

PUNCH_R = 0.0015                   # front camera: 3.0 mm disc
PUNCH_FROM_TOP = 0.0042            # centre below the display's top edge
PUNCH_GAP = 0.00005                # 50 um in front of the screen (no z-fighting)
PUNCH_SEG = 12                     # samples per quarter circle (48 round the rim)

# rear camera module (seen from the back: top left = +X, +Z): a horizontal rounded rectangle,
# corner radius well below its half height (not a pill / capsule), two lenses side by side
# towards the outer edge, flash + a small sensor dot stacked at the inner end
CAM_HW, CAM_HH, CAM_R = 0.0140, 0.0065, 0.0040
CAM_MX = BODY_W / 2 - 0.0045 - CAM_HW
CAM_MZ = BODY_H / 2 - 0.0045 - CAM_HH
CAM_H = 0.0009                     # plate height above the back glass
CAM_LENS_R = 0.0043
CAM_LENS_DX = (0.0075, -0.0030)    # lens centres relative to CAM_MX
CAM_FLASH_DX, CAM_FLASH_DZ, CAM_FLASH_R = -0.0105, 0.0026, 0.0013
CAM_SENSOR_R = 0.0008

BILLET_VISIBLE_H = 2 * 2.8 * math.tan(math.radians(21.0))   # 2.1497
GIFT_FIT = 1.6                     # gift fitSize in billet units
DOCK_OFFSET_FACTOR = 0.55 * GIFT_FIT

PHONE_LOCATION = (0.19, 0.0, BODY_H / 2)   # stands on the ground next to the card
AO_RES = 1024
AO_DISTANCE = 0.003
AO_SAMPLES = 256
TRI_BUDGET = 40000
BODY_SEG = 16                      # segments per body corner (the screen uses the same samples)

CAPTURES_JSON = os.path.normpath(os.path.join(common.HERO_DIR, "..", "..", "asset-pipeline",
                                              "hero", "hero-captures.json"))
CAPTURES_DIR = os.path.join(os.path.dirname(CAPTURES_JSON), ".captures")
CHECK_SCREEN_PNG = os.path.join(CAPTURES_DIR, "screen-valentinstag-de-light.png")

# face "part" attribute codes (Phone_Body)
P_SHELL, P_BUTTON, P_CAMERA, P_FLASH, P_PORT = range(1, 6)

MATS = {
    # name: (hex, metallic, roughness)
    "M_Phone_Frame": ("#74777e", 0.85, 0.35),       # graphite satin metal (a touch cooler and
                                                    # lighter than the back: tonal separation)
    "M_Phone_GlassFront": ("#030304", 0.0, 0.04),   # black front glass (bezel), camera plate
    "M_Phone_GlassBack": ("#303236", 0.0, 0.40),    # matte (frosted) graphite glass: broad sheen
    "M_Phone_Lens": ("#0a0b14", 0.0, 0.03),         # lens glass, faint blue-violet coating tint
    "M_Phone_LensInner": ("#020203", 0.0, 0.08),    # the dark pupil at the top of the lens dome
    "M_Phone_Aperture": ("#2b2c30", 0.8, 0.30),     # dark metallic ring inside the lens ring
    "M_Phone_Flash": ("#dcd6c4", 0.0, 0.35),
    "M_Phone_Port": ("#0a0a0a", 0.0, 0.7),
}
BODY_MATS = tuple(MATS)
SCREEN_MAT = "M_Screen"
PUNCH_MAT = "M_Phone_PunchHole"      # the dark ring of the front camera
PUNCH_LENS_MAT = "M_Phone_PunchLens"  # its glossy lens dome
PHONE_MATS = BODY_MATS + (SCREEN_MAT, PUNCH_MAT, PUNCH_LENS_MAT)
OBJECTS = ("Phone_Body", "Phone_Screen", "Phone_PunchHole")


# ---------------------------------------------------------------------------------------------
# Profiles (2D, millimetres): O = -inset (outward in the outline plane), N = height along the
# sweep's plane normal. Each point carries its arrival / departure tangent; they differ at a
# crease. The solid lies to the left of the direction of travel, so the outward normal of a
# tangent (tO, tN) is (tN, -tO).
# ---------------------------------------------------------------------------------------------

class Profile:
    def __init__(self, O: float, N: float, tangent: tuple[float, float]):
        t = _n2(tangent)
        self.pts = [[O, N, t, t]]
        self.mats: list[str] = []

    @property
    def last(self):
        return self.pts[-1]

    def line_to(self, O: float, N: float, mat: str, n: int = 1) -> "Profile":
        O0, N0 = self.last[0], self.last[1]
        t = _n2((O - O0, N - N0))
        self.last[3] = t
        for k in range(1, n + 1):
            f = k / n
            self.pts.append([O0 + (O - O0) * f, N0 + (N - N0) * f, t, t])
            self.mats.append(mat)
        return self

    def arc(self, cO: float, cN: float, aO: float, aN: float, th0: float, th1: float,
            mat: str, n: int) -> "Profile":
        """Elliptic arc: point(th) = (cO + aO cos th, cN + aN sin th), th in degrees."""
        sgn = 1.0 if th1 > th0 else -1.0

        def p(th):
            r = math.radians(th)
            return cO + aO * math.cos(r), cN + aN * math.sin(r)

        def t(th):
            r = math.radians(th)
            return _n2((-aO * math.sin(r) * sgn, aN * math.cos(r) * sgn))

        s = p(th0)
        assert abs(s[0] - self.last[0]) < 1e-9 and abs(s[1] - self.last[1]) < 1e-9, \
            f"arc does not start at the profile end: {s} vs {self.last[:2]}"
        self.last[3] = t(th0)
        for k in range(1, n + 1):
            th = th0 + (th1 - th0) * k / n
            q = p(th)
            self.pts.append([q[0], q[1], t(th), t(th)])
            self.mats.append(mat)
        return self


def _dome(p: Profile, axis_O: float, height: float, pupil: float, mat: str, pupil_mat: str,
          n: int) -> None:
    """Continue a flat, inward-running profile (at O = axis_O + a) with a shallow spherical
    lens dome of the given height, up to the pupil radius, then a tiny flat step so the pupil
    cap ends flat (mm; axis_O = the O of the sweep axis, i.e. -radius)."""
    a = p.last[0] - axis_O
    Rs = (a * a + height * height) / (2 * height)
    cN = p.last[1] + height - Rs
    th0 = math.degrees(math.acos(a / Rs))
    th1 = math.degrees(math.acos(pupil / Rs))
    p.arc(axis_O, cN, Rs, Rs, th0, th1, mat, n)
    p.line_to(p.last[0] - 0.05, p.last[1], pupil_mat)


def _n2(v) -> tuple[float, float]:
    ln = math.hypot(v[0], v[1])
    return (v[0] / ln, v[1] / ln)


def _outline(hw: float, hh: float, r: float, seg: int, with_cuts: bool = False):
    """Rounded rectangle (half sizes hw, hh, corner radius r), CCW in (u, v): corner centres C
    and unit directions D per sample. A circle (r = hw = hh) drops the duplicate points.
    with_cuts also returns the sample indices at the corner midpoints (45 deg; lightmap seams)."""
    cx, cy = hw - r, hh - r
    assert cx >= -1e-12 and cy >= -1e-12 and seg % 2 == 0
    C, D, cuts = [], [], []
    centres = ((cx, cy), (-cx, cy), (-cx, -cy), (cx, -cy))
    for k, (ccx, ccy) in enumerate(centres):
        straight_after = 2 * cx if k in (0, 2) else 2 * cy
        n = seg + 1 if straight_after > 1e-9 else seg
        for s in range(n):
            if s == seg // 2:
                cuts.append(len(C))
            a = math.pi / 2 * (k + s / seg)
            C.append((ccx, ccy))
            D.append((math.cos(a), math.sin(a)))
    if with_cuts:
        return np.array(C), np.array(D), cuts
    return np.array(C), np.array(D)


class MeshBuilder:
    """Collects vertices, faces (with per-corner normals), material names and part codes."""

    def __init__(self):
        self.verts: list = []
        self.faces: list = []
        self.normals: list = []
        self.mats: list = []
        self.parts: list = []
        self.seams: set = set()

    def sweep(self, origin, U, V, Nax, hw, hh, r, prof: Profile, part: int, seg: int = 12,
              cap_mat: str | None = None) -> list[list[int]]:
        """Sweep prof (mm) along the rounded rectangle (m) in the plane (U, V) at origin, heights
        along Nax. Optionally closes the last ring with an n-gon. Returns the ring vertex ids."""
        origin, U, V, Nax = (np.asarray(a, dtype=np.float64) for a in (origin, U, V, Nax))
        C, D, cuts = _outline(hw, hh, r, seg, with_cuts=True)
        n = len(C)
        rings = []
        for (O, N, _ti, _to) in prof.pts:
            rr = r + O * MM
            assert rr > 0, "profile goes past the corner centres"
            xy = C + rr * D
            P = origin + np.outer(xy[:, 0], U) + np.outer(xy[:, 1], V) + N * MM * Nax
            base = len(self.verts)
            self.verts.extend(P.tolist())
            rings.append(list(range(base, base + n)))
        outward = np.outer(D[:, 0], U) + np.outer(D[:, 1], V)

        def normal(t, i):
            n2 = (t[1], -t[0])
            v = n2[0] * outward[i] + n2[1] * Nax
            return v / np.linalg.norm(v)

        for b in range(len(prof.pts) - 1):
            t0, t1 = prof.pts[b][3], prof.pts[b + 1][2]
            for i in range(n):
                i1 = (i + 1) % n
                self._face([rings[b][i], rings[b][i1], rings[b + 1][i1], rings[b + 1][i]],
                           [normal(t0, i), normal(t0, i1), normal(t1, i1), normal(t1, i)],
                           prof.mats[b], part)
        # lightmap seams: across the strip at the four corner midpoints, round the cap
        for i in cuts:
            for b in range(len(rings) - 1):
                self.seams.add(tuple(sorted((rings[b][i], rings[b + 1][i]))))
        if cap_mat is not None:
            for i in range(n):
                self.seams.add(tuple(sorted((rings[-1][i], rings[-1][(i + 1) % n]))))
            t = prof.pts[-1][2]
            n2 = (t[1], -t[0])
            assert abs(n2[0]) < 1e-9, "cap needs a profile that ends flat"
            cn = Nax * math.copysign(1.0, n2[1])
            self._face(list(rings[-1]), [cn] * n, cap_mat, part)
        return rings

    def disc(self, centre, U, V, Nax, radius, seg, mat, part):
        C, D = _outline(radius, radius, radius, seg)
        xy = C + radius * D
        P = np.asarray(centre) + np.outer(xy[:, 0], U) + np.outer(xy[:, 1], V)
        base = len(self.verts)
        self.verts.extend(P.tolist())
        self._face(list(range(base, base + len(P))), [np.asarray(Nax, dtype=float)] * len(P),
                   mat, part)

    def _face(self, idx, nrm, mat, part):
        """Add a face; flip its winding if the geometric normal disagrees with the analytic one."""
        P = np.array([self.verts[i] for i in idx])
        geo = np.zeros(3)
        for k in range(len(P)):  # Newell
            a, b = P[k], P[(k + 1) % len(P)]
            geo += np.array([(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]),
                             (a[0] - b[0]) * (a[1] + b[1])])
        want = np.sum(nrm, axis=0)
        nrm = [np.asarray(v, dtype=float) for v in nrm]
        if geo.dot(want) < 0:
            idx, nrm = idx[::-1], nrm[::-1]
        self.faces.append(list(idx))
        self.normals.append(nrm)
        self.mats.append(mat)
        self.parts.append(part)

    def to_object(self, name: str, coll, parent, materials: dict) -> bpy.types.Object:
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        assert len(me.polygons) == len(self.faces), f"{name}: faces lost"
        names = list(dict.fromkeys(self.mats))
        for mn in names:
            me.materials.append(materials[mn])
        me.polygons.foreach_set("material_index",
                                np.array([names.index(m) for m in self.mats], dtype=np.int32))
        pa = me.attributes.new("part", "INT", "FACE")
        pa.data.foreach_set("value", np.array(self.parts, dtype=np.int32))
        me.shade_smooth()
        loop_normals = [tuple(v) for f in self.normals for v in f]
        assert len(loop_normals) == len(me.loops)
        me.normals_split_custom_set(loop_normals)
        if self.seams:
            ek = np.zeros(len(me.edges) * 2, dtype=np.int64)
            me.edges.foreach_get("vertices", ek)
            ek = np.sort(ek.reshape(-1, 2), axis=1)
            seam = np.array([tuple(e) in self.seams for e in ek.tolist()], dtype=bool)
            me.edges.foreach_set("use_seam", seam)
        me.update()
        return common.new_mesh_object(name, me, coll, parent=parent)


# ---------------------------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------------------------

def read_scene_rects() -> dict:
    with open(CAPTURES_JSON, encoding="utf-8") as fh:
        data = json.load(fh)
    out = {}
    for e in data["entries"]:
        if e["kind"] == "screen" and e["template"] == "valentinstag" and e["mode"] == "light":
            if (e["cssWidth"], e["cssHeight"]) != (CSS_W, CSS_H):
                raise ValueError(f"screen capture is {e['cssWidth']}x{e['cssHeight']}, "
                                 f"expected {CSS_W}x{CSS_H}")
            out[e["lang"]] = {k: float(e["sceneRect"][k]) for k in ("x", "y", "w", "h")}
    if set(out) != {"de", "en"}:
        raise ValueError(f"valentinstag light screen entries missing: {sorted(out)}")
    return out


def build_phone(ctx: Ctx) -> None:
    coll = common.collection("HeroPhone")
    mats = _materials(ctx)

    phone = common.new_empty("Phone", coll, "PLAIN_AXES", 0.03)
    phone.location = PHONE_LOCATION

    body = _body(coll, phone, mats)
    screen = _screen(coll, phone, mats)
    punch = _punch_hole(coll, phone, mats)
    dock = _dock(ctx, coll, phone)
    ctx.objects.update(Phone=phone, Phone_Body=body, Phone_Screen=screen,
                       Phone_PunchHole=punch, Phone_ScreenDock=dock)

    _uv_body(body)
    ctx.info["ao"] = _bake_ao(ctx, body)
    _wire_occlusion(ctx, body)

    phone["heroPhone"] = {
        "bodyWidthM": BODY_W, "bodyHeightM": BODY_H, "bodyDepthM": DEPTH,
        "cornerRadiusM": R_BODY, "screenWidthM": DISPLAY_W, "screenHeightM": DISPLAY_H,
        "screenCornerRadiusM": R_DISPLAY, "screenCss": [CSS_W, CSS_H],
        "screenPlaneZGltf": HD,
        "screenUv": ("glTF TEXCOORD_0 of Phone_Screen: u = 0..1 left to right, v = 0 at the top "
                     "of the phone, 1 at the bottom, linear over the full 390 x 844 rectangle; load "
                     "the screen captures with texture.flipY = false (GLTFLoader convention) or "
                     "sample (u, 1 - v)"),
        "restPose": ("glTF / three.js: screen faces +Z, upright along +Y, side buttons on +X "
                     "(Blender: screen faces -Y, upright along +Z)"),
        "screenShader": ("output the capture colours 1:1 (toneMapped = false or equivalent), the "
                         "display is not lit and must not be tone-mapped"),
    }
    bpy.context.view_layer.update()
    tris = sum(common.triangle_count(o) for o in (body, screen, punch))
    log(f"phone built: {tris} triangles")


# ---------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------

def _pmat(name, hexc, metallic, roughness):
    mat, _tree, bsdf = common.new_material(name)
    common.socket(bsdf.inputs, "Base Color").default_value = common.hex_to_linear(hexc)
    common.socket(bsdf.inputs, "Metallic").default_value = metallic
    common.socket(bsdf.inputs, "Roughness").default_value = roughness
    mat.diffuse_color = common.hex_to_linear(hexc)  # viewport only
    mat.use_backface_culling = True  # closed body / front-only screen: glTF doubleSided false
    return mat


def _materials(ctx: Ctx) -> dict:
    mats = {name: _pmat(name, *spec) for name, spec in MATS.items()}
    mats[PUNCH_MAT] = _pmat(PUNCH_MAT, "#18181c", 0.0, 0.35)
    mats[PUNCH_LENS_MAT] = _pmat(PUNCH_LENS_MAT, "#06070c", 0.0, 0.05)
    # the screen: black glass; the placeholder image drives the emission (three.js replaces the
    # whole material with a ShaderMaterial on the captured textures)
    mat, tree, bsdf = common.new_material(SCREEN_MAT)
    common.socket(bsdf.inputs, "Base Color").default_value = (0.0, 0.0, 0.0, 1.0)
    common.socket(bsdf.inputs, "Metallic").default_value = 0.0
    common.socket(bsdf.inputs, "Roughness").default_value = 0.05
    mat.use_backface_culling = True
    ph = bpy.data.images.get("screen_placeholder") or bpy.data.images.new(
        "screen_placeholder", CSS_W // 2, CSS_H // 2, alpha=False)
    ph.generated_color = (0.0, 0.0, 0.0, 1.0)
    uv = tree.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    uv.location = (-600, 0)
    tex = tree.nodes.new("ShaderNodeTexImage")
    tex.name = "ScreenImage"
    tex.image = ph
    tex.extension = "EXTEND"
    tex.location = (-300, -150)
    tree.links.new(common.socket(uv.outputs, "UV"), common.socket(tex.inputs, "Vector"))
    tree.links.new(common.socket(tex.outputs, "Color"), common.socket(bsdf.inputs, "Emission Color"))
    common.socket(bsdf.inputs, "Emission Strength").default_value = 1.0
    mats[SCREEN_MAT] = mat
    ctx.materials.update(mats)
    return mats


# ---------------------------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------------------------

def _body_profile() -> Profile:
    """Cross-section from the display edge (front) round the side to the back glass (mm).
    Heights along +Y (front at -3.95). Front: 1.0 mm flat black glass + a 0.38 mm roll-off,
    a 0.14 mm groove where it meets the frame; frame: elliptic 0.62 x 1.46 mm edges and a flat
    4.7 mm side band; back: the mirrored frame edge and the matte glass rising 0.14 mm."""
    h = HD / MM
    s = SIDE / MM
    g, m, b = "M_Phone_GlassFront", "M_Phone_Frame", "M_Phone_GlassBack"
    p = Profile(-s, -h, (1.0, 0.0))
    p.line_to(-1.0, -h, g)
    p.arc(-1.0, -h + 0.14, 0.38, 0.14, -90, 0, g, 4)          # glass roll-off
    p.arc(-0.62, -h + 1.6, 0.62, 1.46, -90, 0, m, 6)          # front frame edge
    p.line_to(0.0, h - 1.6, m)                                # flat side band
    p.arc(-0.62, h - 1.6, 0.62, 1.46, 0, 90, m, 6)            # back frame edge
    p.arc(-1.0, h - 0.14, 0.38, 0.14, 0, 90, b, 4)            # back glass roll
    return p


def _body(coll, parent, mats) -> bpy.types.Object:
    mb = MeshBuilder()
    X, Y, Z = np.eye(3)
    # shell: outline in XZ (u = X, v = Z), heights along +Y
    mb.sweep((0, 0, 0), X, Z, Y, BODY_W / 2, BODY_H / 2, R_BODY, _body_profile(), P_SHELL,
             seg=BODY_SEG, cap_mat="M_Phone_GlassBack")

    # side buttons on +X: outline in (u = Z, v = Y), heights along +X from the side band
    def button(zc, length):
        p = Profile(0.0, -0.35, (0.0, 1.0))
        p.line_to(0.0, 0.20, "M_Phone_Frame")
        p.arc(-0.25, 0.20, 0.25, 0.25, 0, 90, "M_Phone_Frame", 4)
        mb.sweep((BODY_W / 2, 0, zc), Z, Y, X, length / 2, 0.00095, 0.00095, p, P_BUTTON,
                 seg=6, cap_mat="M_Phone_Frame")
    button(0.030, 0.024)   # volume rocker
    button(0.004, 0.012)   # power

    # camera module (back, top left seen from the back = +X, +Z): a horizontal rounded
    # rectangle (corner radius 4 mm, well below its 6.5 mm half height), black glass plate,
    # two lenses side by side in low metal rings, flash + sensor dot at the inner end
    mx, mz = CAM_MX, CAM_MZ
    top = HD + CAM_H
    h_mm = CAM_H / MM
    p = Profile(0.0, -0.2, (0.0, 1.0))
    p.line_to(0.0, h_mm - 0.35, "M_Phone_Frame")
    p.arc(-0.35, h_mm - 0.35, 0.35, 0.35, 0, 90, "M_Phone_Frame", 4)
    mb.sweep((mx, HD, mz), X, Z, Y, CAM_HW, CAM_HH, CAM_R, p, P_CAMERA, seg=8,
             cap_mat="M_Phone_GlassFront")
    lr = CAM_LENS_R / MM
    for dx in CAM_LENS_DX:
        # ring: 0.35 mm proud of the plate, 0.7 mm wide; inside it a dark metallic aperture
        # ring and the lens glass: a shallow dome (0.30 mm, below the ring top) with a dark pupil on top
        p = Profile(0.0, -0.1, (0.0, 1.0))
        p.line_to(0.0, 0.20, "M_Phone_Frame")
        p.arc(-0.15, 0.20, 0.15, 0.15, 0, 90, "M_Phone_Frame", 3)
        p.line_to(-0.55, 0.35, "M_Phone_Frame")
        p.arc(-0.55, 0.20, 0.15, 0.15, 90, 180, "M_Phone_Frame", 3)
        p.line_to(-0.70, 0.02, "M_Phone_Frame")
        p.line_to(-1.25, 0.02, "M_Phone_Aperture")
        _dome(p, -lr, 0.30, 1.1, "M_Phone_Lens", "M_Phone_LensInner", 8)
        mb.sweep((mx + dx, top, mz), X, Z, Y, CAM_LENS_R, CAM_LENS_R, CAM_LENS_R, p, P_CAMERA,
                 seg=8, cap_mat="M_Phone_LensInner")
    # flash (upper) and a small sensor dot (lower), flush in the plate at its inner end
    p = Profile(0.0, -0.1, (0.0, 1.0))
    p.line_to(0.0, 0.05, "M_Phone_Flash")
    p.line_to(-0.2, 0.05, "M_Phone_Flash")
    mb.sweep((mx + CAM_FLASH_DX, top, mz + CAM_FLASH_DZ), X, Z, Y, CAM_FLASH_R, CAM_FLASH_R,
             CAM_FLASH_R, p, P_FLASH, seg=6, cap_mat="M_Phone_Flash")
    p = Profile(0.0, -0.1, (0.0, 1.0))
    p.line_to(0.0, 0.05, "M_Phone_Aperture")
    p.line_to(-0.25, 0.05, "M_Phone_Aperture")
    p.line_to(-0.30, 0.05, "M_Phone_LensInner")
    mb.sweep((mx + CAM_FLASH_DX, top, mz - CAM_FLASH_DZ), X, Z, Y, CAM_SENSOR_R, CAM_SENSOR_R,
             CAM_SENSOR_R, p, P_CAMERA, seg=4, cap_mat="M_Phone_LensInner")
    # USB-C port on the bottom (flat part of the side band)
    p = Profile(0.0, -0.3, (0.0, 1.0))
    p.line_to(0.0, 0.02, "M_Phone_Port")
    p.line_to(-0.2, 0.02, "M_Phone_Port")
    mb.sweep((0, 0, -BODY_H / 2), X, Y, -Z, 0.0043, 0.00125, 0.00125, p, P_PORT, seg=6,
             cap_mat="M_Phone_Port")
    return mb.to_object("Phone_Body", coll, parent, mats)


def _screen(coll, parent, mats) -> bpy.types.Object:
    """The display: the same outline samples as the body's front ring (shared boundary, no
    overlap), triangulated; planar UVs over the full 390 x 844 rectangle."""
    C, D = _outline(BODY_W / 2, BODY_H / 2, R_BODY, BODY_SEG)
    xy = C + (R_BODY - SIDE) * D
    verts = [(x, -HD, z) for x, z in xy.tolist()]
    me = bpy.data.meshes.new("Phone_Screen")
    me.from_pydata(verts, [], [list(range(len(verts)))])
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
    for f in bm.faces:
        if f.normal.y > 0:
            f.normal_flip()
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mats[SCREEN_MAT])
    uvl = me.uv_layers.new(name="UVMap")
    lv = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    co = np.array(verts)[lv]
    uv = np.stack([(co[:, 0] + DISPLAY_W / 2) / DISPLAY_W, (co[:, 2] + DISPLAY_H / 2) / DISPLAY_H], 1)
    uvl.data.foreach_set("uv", uv.astype(np.float32).ravel())
    me.shade_flat()
    return common.new_mesh_object("Phone_Screen", me, coll, parent=parent)


def _punch_hole(coll, parent, mats) -> bpy.types.Object:
    """Front camera: a flat dark ring (3.0 -> 2.1 mm) and a glossy lens dome (40 um) inside it,
    48 samples round the rim, the whole part at least PUNCH_GAP in front of the screen."""
    mb = MeshBuilder()
    X, Y, Z = np.eye(3)
    zc = DISPLAY_H / 2 - PUNCH_FROM_TOP
    r = PUNCH_R / MM
    p = Profile(0.0, 0.0, (-1.0, 0.0))
    p.line_to(-0.45, 0.0, PUNCH_MAT)
    _dome(p, -r, 0.04, 0.35, PUNCH_LENS_MAT, PUNCH_LENS_MAT, 5)
    mb.sweep((0.0, -HD - PUNCH_GAP, zc), X, Z, -Y, PUNCH_R, PUNCH_R, PUNCH_R, p, 1,
             seg=PUNCH_SEG, cap_mat=PUNCH_LENS_MAT)
    mb.seams.clear()  # no UVs on the punch-hole
    return mb.to_object("Phone_PunchHole", coll, parent, mats)


def _dock(ctx: Ctx, coll, parent) -> bpy.types.Object:
    rects = read_scene_rects()
    de = rects["de"]
    cx_n = de["x"] + de["w"] / 2           # from the left
    cy_n = de["y"] + de["h"] / 2           # from the TOP
    scene_h_m = de["h"] * DISPLAY_H
    scale = scene_h_m / BILLET_VISIBLE_H
    offset = DOCK_OFFSET_FACTOR * scale
    x = -DISPLAY_W / 2 + cx_n * DISPLAY_W
    z = DISPLAY_H / 2 - cy_n * DISPLAY_H
    dock = common.new_empty("Phone_ScreenDock", coll, "ARROWS", 1.0, parent=parent)
    dock.location = (x, -HD - offset, z)
    dock.rotation_mode = "XYZ"
    dock.rotation_euler = (0.0, 0.0, 0.0)   # three.js frame after export: +Z normal, +Y up
    dock.scale = (scale, scale, scale)
    dock["sceneRectDe"] = de
    dock["sceneRectEn"] = rects["en"]
    dock["screenWidthM"] = DISPLAY_W
    dock["screenHeightM"] = DISPLAY_H
    dock["dockScale"] = scale
    dock["dockOffsetM"] = offset
    dock["billetVisibleHeight"] = BILLET_VISIBLE_H
    dock["frame"] = ("glTF / three.js: local +Z = screen normal (out of the glass), +Y = screen up "
                     "(the billet camera frame; a Y-up gift fitted in billet units goes in as is). "
                     "Blender: local -Y = screen normal, +Z = screen up (identity rotation)")
    ctx.info["dock"] = {"scene_rect_de": de, "scene_rect_en": rects["en"],
                        "scene_area_height_m": scene_h_m, "scale": scale, "offset_m": offset}
    return dock


# ---------------------------------------------------------------------------------------------
# UVs + ambient occlusion
# ---------------------------------------------------------------------------------------------

def _uv_body(body: bpy.types.Object) -> None:
    """UV_AO: isotropic non-overlapping lightmap (builder seams -> conformal unwrap per island
    -> one texel density -> pack). UVMap = the same layout (layer 0, unused by the
    materials; it keeps UV_AO on texCoord 1 in glTF)."""
    me = body.data
    uv0 = me.uv_layers.new(name="UVMap")
    ao = me.uv_layers.new(name="UV_AO")
    me.uv_layers.active = ao
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    body.select_set(True)
    vl.objects.active = body
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    # seams from the builder: every swept strip is cut at its four corner midpoints and round
    # its cap, so the islands are open strips and flat caps (no rings enclosing empty space)
    bpy.ops.uv.unwrap(method="CONFORMAL", fill_holes=True, correct_aspect=False, margin=0.0)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=0.008, shape_method="CONCAVE")  # ~8 px at 1024
    bpy.ops.object.mode_set(mode="OBJECT")
    body.select_set(False)
    me = body.data  # layer references do not survive the edit-mode round trip
    ao, uv0 = me.uv_layers["UV_AO"], me.uv_layers["UVMap"]
    data = np.zeros(len(me.loops) * 2, dtype=np.float32)
    ao.data.foreach_get("uv", data)
    uv0.data.foreach_set("uv", data)
    me.uv_layers.active = uv0
    uv0.active_render = True


def _bake_ao(ctx: Ctx, body: bpy.types.Object) -> dict:
    """Cycles (GPU: OPTIX -> CUDA -> CPU) ambient-occlusion bake of Phone_Body into
    images/phone_ao.png on UV_AO. Everything but the phone is hidden from the bake."""
    scene = ctx.scene
    engine_before = scene.render.engine
    device = common.setup_cycles(scene, AO_SAMPLES)
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.light_settings.distance = AO_DISTANCE
    scene.render.bake.margin = 8
    try:
        scene.render.bake.margin_type = "EXTEND"
    except TypeError:
        pass
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.target = "IMAGE_TEXTURES"

    img = bpy.data.images.new("phone_ao", AO_RES, AO_RES, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    for m in body.data.materials:
        tree = m.node_tree
        tex = tree.nodes.new("ShaderNodeTexImage")
        tex.name = "AO_Texture"
        tex.image = img
        tex.interpolation = "Linear"
        tex.location = (-600, -500)
        for n in tree.nodes:
            n.select = False
        tex.select = True
        tree.nodes.active = tex

    phone_objs = {ctx.objects[n] for n in ("Phone_Body", "Phone_Screen", "Phone_PunchHole")}
    hidden = []
    for o in scene.objects:
        if o.type == "MESH" and o not in phone_objs and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    body.select_set(True)
    vl.objects.active = body
    bpy.ops.object.bake(type="AO", uv_layer="UV_AO", margin=8)
    for o in hidden:
        o.hide_render = False
    body.select_set(False)

    path = common.generated_image_path("phone_ao.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.filepath = path
    img.reload()
    px = common.image_to_numpy(img)[:, :, 0]
    try:
        scene.render.engine = engine_before
    except TypeError:
        pass
    log(f"AO baked on {device} -> {path}")
    return {"device": device, "resolution": AO_RES, "samples": AO_SAMPLES,
            "distance_m": AO_DISTANCE, "path": path, **_ao_surface_stats(body, px)}


def _ao_surface_stats(body, px: np.ndarray) -> dict:
    """AO sampled at the lightmap texels of the surface, not over the empty parts of the image:
    ~200k uniform random surface points (per-triangle counts proportional to the area, so the
    few huge triangles of the flat back / side bands are sampled as densely as the small ones).
    Hidden faces (the back glass under the camera plate, the plate under the lens rings, the
    button / port bases) bake black and are included: ~2 % of the area."""
    import build_card
    P, U = build_card._loop_tris(body, "UV_AO")
    st = build_card._uv_stats(P, U)
    res = px.shape[0]
    rng = np.random.default_rng(1)
    area = st["a3"]
    counts = np.maximum(1, np.round(area / area.sum() * 200000)).astype(np.int64)
    idx = np.repeat(np.arange(len(U)), counts)
    wts = area[idx] / counts[idx]
    a, b = rng.random(len(idx)), rng.random(len(idx))
    flip = a + b > 1
    a[flip], b[flip] = 1 - a[flip], 1 - b[flip]
    T = U[idx]
    uv = T[:, 0] + a[:, None] * (T[:, 1] - T[:, 0]) + b[:, None] * (T[:, 2] - T[:, 0])
    ij = np.clip((uv * res).astype(int), 0, res - 1)
    v = px[ij[:, 1], ij[:, 0]]
    order = np.argsort(v)
    cw = np.cumsum(wts[order]) / wts.sum()
    return {"surface_mean": float((v * wts).sum() / wts.sum()),
            "surface_p05": float(v[order][np.searchsorted(cw, 0.05)]),
            "surface_fraction_below_0_9": float(wts[v < 0.9].sum() / wts.sum()),
            "surface_fraction_below_0_1 (hidden faces)": float(wts[v < 0.1].sum() / wts.sum()),
            "stat_points": int(len(idx)), "image_mean": float(px.mean())}


def _gltf_output_group() -> bpy.types.NodeTree:
    """The 'glTF Material Output' node group the glTF exporter reads occlusion from."""
    name = "glTF Material Output"
    grp = bpy.data.node_groups.get(name)
    if grp is None:
        grp = bpy.data.node_groups.new(name, "ShaderNodeTree")
        grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        grp.nodes.new("NodeGroupInput")
    return grp


def _wire_occlusion(ctx: Ctx, body: bpy.types.Object) -> None:
    grp = _gltf_output_group()
    for m in body.data.materials:
        tree = m.node_tree
        tex = next(n for n in tree.nodes if n.type == "TEX_IMAGE" and n.image is not None
                   and n.image.name == "phone_ao")
        uv = tree.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UV_AO"
        uv.location = (-850, -500)
        sep = tree.nodes.new("ShaderNodeSeparateColor")
        sep.location = (-300, -500)
        out = tree.nodes.new("ShaderNodeGroup")
        out.node_tree = grp
        out.location = (-50, -500)
        tree.links.new(common.socket(uv.outputs, "UV"), common.socket(tex.inputs, "Vector"))
        tree.links.new(common.socket(tex.outputs, "Color"), sep.inputs[0])
        tree.links.new(sep.outputs[0], common.socket(out.inputs, "Occlusion"))
        tex.select = False
        tree.nodes.active = common.find_node(tree, "BSDF_PRINCIPLED")


# ---------------------------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------------------------

ALLOWED_NODES = {"BSDF_PRINCIPLED", "OUTPUT_MATERIAL", "TEX_IMAGE", "UVMAP", "SEPARATE_COLOR",
                 "SEPCOLOR", "GROUP"}


def _local_verts(obj) -> np.ndarray:
    """Vertices in Phone space (the meshes sit at identity under Phone)."""
    return common.mesh_vertices(obj, world=False)


def _face_arrays(obj):
    me = obj.data
    n = len(me.polygons)
    fn = np.zeros(n * 3)
    fc = np.zeros(n * 3)
    me.polygons.foreach_get("normal", fn)
    me.polygons.foreach_get("center", fc)
    return fn.reshape(-1, 3), fc.reshape(-1, 3)


def _inside_rounded_rect(x, z, hw, hh, r):
    dx = np.maximum(np.abs(x) - (hw - r), 0.0)
    dz = np.maximum(np.abs(z) - (hh - r), 0.0)
    return (np.abs(x) <= hw) & (np.abs(z) <= hh) & (np.hypot(dx, dz) <= r)


def _export_check(ctx: Ctx) -> dict:
    """Export the phone hierarchy to .work/phone_check.glb and read back what three.js gets."""
    path = os.path.join(ctx.work_dir, "phone_check.glb")
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    names = ("Phone", "Phone_Body", "Phone_Screen", "Phone_PunchHole", "Phone_ScreenDock")
    for n in names:
        ctx.objects[n].select_set(True)
    vl.objects.active = ctx.objects["Phone"]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_extras=True, export_yup=True)
    for n in names:
        ctx.objects[n].select_set(False)
    with open(path, "rb") as fh:
        data = fh.read()
    clen = struct.unpack("<I", data[12:16])[0]
    js = json.loads(data[20:20 + clen])
    bin_chunk = data[20 + clen + 8:]
    res = {"file": path, "bytes": len(data), "materials": {}, "meshes": {}, "nodes": {}}
    for m in js.get("materials", []):
        occ = m.get("occlusionTexture")
        emi = m.get("emissiveTexture")
        res["materials"][m["name"]] = {
            "occlusion_texCoord": None if occ is None else occ.get("texCoord", 0),
            "emissive_texCoord": None if emi is None else emi.get("texCoord", 0),
            "metallic": m.get("pbrMetallicRoughness", {}).get("metallicFactor", 1.0),
            "roughness": m.get("pbrMetallicRoughness", {}).get("roughnessFactor", 1.0),
            "doubleSided": bool(m.get("doubleSided", False)),
        }
    acc = js.get("accessors", [])
    for mesh in js.get("meshes", []):
        tris = 0
        attrs = set()
        for prim in mesh["primitives"]:
            tris += acc[prim["indices"]]["count"] // 3
            attrs |= set(prim["attributes"])
        res["meshes"][mesh["name"]] = {"triangles": tris, "attributes": sorted(attrs)}
        if mesh["name"] == "Phone_Screen":
            pos = np.concatenate([_accessor(js, bin_chunk, pr["attributes"]["POSITION"])
                                  for pr in mesh["primitives"]])
            uv = np.concatenate([_accessor(js, bin_chunk, pr["attributes"]["TEXCOORD_0"])
                                 for pr in mesh["primitives"]])
            nrm = np.concatenate([_accessor(js, bin_chunk, pr["attributes"]["NORMAL"])
                                  for pr in mesh["primitives"]])
            top, bot = int(np.argmax(pos[:, 1])), int(np.argmin(pos[:, 1]))
            lft, rgt = int(np.argmin(pos[:, 0])), int(np.argmax(pos[:, 0]))
            # affine fit uv = A [x, y, 1] in glTF node space
            Xm = np.stack([pos[:, 0], pos[:, 1], np.ones(len(pos))], 1)
            A, *_ = np.linalg.lstsq(Xm, uv, rcond=None)
            res["screen_uv_gltf"] = {
                "top_vertex": {"pos": pos[top], "uv": uv[top]},
                "bottom_vertex": {"pos": pos[bot], "uv": uv[bot]},
                "left_vertex_u": float(uv[lft, 0]), "right_vertex_u": float(uv[rgt, 0]),
                "v_at_display_top": float(np.array([0.0, DISPLAY_H / 2, 1.0]) @ A[:, 1]),
                "v_at_display_bottom": float(np.array([0.0, -DISPLAY_H / 2, 1.0]) @ A[:, 1]),
                "u_at_display_left": float(np.array([-DISPLAY_W / 2, 0.0, 1.0]) @ A[:, 0]),
                "u_at_display_right": float(np.array([DISPLAY_W / 2, 0.0, 1.0]) @ A[:, 0]),
                "normal_mean": nrm.mean(0),
                "contract": "v = 0 at the top: flipY = false"}
    for node in js.get("nodes", []):
        entry = {k: node[k] for k in ("translation", "rotation", "scale") if k in node}
        if "extras" in node:
            entry["extras_keys"] = sorted(node["extras"])
        if node["name"] == "Phone_ScreenDock":
            x, y, z, w = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
            q = np.array([w, x, y, z])
            R = _quat_to_mat(q)
            entry["local_axes_in_parent_gltf"] = {"+X": R[:, 0], "+Y": R[:, 1], "+Z": R[:, 2]}
        res["nodes"][node["name"]] = entry
    return res


def _accessor(js: dict, bin_chunk: bytes, idx: int) -> np.ndarray:
    """A float VEC2 / VEC3 accessor of the GLB's binary chunk as an (n, k) array."""
    a = js["accessors"][idx]
    assert a["componentType"] == 5126, "expected FLOAT"
    k = {"VEC2": 2, "VEC3": 3, "VEC4": 4, "SCALAR": 1}[a["type"]]
    bv = js["bufferViews"][a["bufferView"]]
    stride = bv.get("byteStride", 4 * k)
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = a["count"]
    raw = np.frombuffer(bin_chunk, dtype=np.uint8, count=stride * (n - 1) + 4 * k, offset=off)
    return np.lib.stride_tricks.as_strided(raw.view(np.uint8), shape=(n, 4 * k),
                                           strides=(stride, 1)).copy().view("<f4").reshape(n, k)         .astype(np.float64)


def _quat_to_mat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def check_phone(ctx: Ctx) -> tuple[bool, dict]:
    body, screen, punch = (ctx.objects[n] for n in OBJECTS)
    dock, phone = ctx.objects["Phone_ScreenDock"], ctx.objects["Phone"]
    mm = 1000.0
    res: dict = {}
    fails: list[str] = []

    def expect(cond, msg):
        if not cond:
            fails.append(msg)

    # --- dimensions ---------------------------------------------------------------------------
    co = _local_verts(body)
    part = np.zeros(len(body.data.polygons), dtype=np.int32)
    body.data.attributes["part"].data.foreach_get("value", part)
    shell_v = sorted({v for p in body.data.polygons if part[p.index] == P_SHELL for v in p.vertices})
    sh = co[shell_v]
    ext = sh.max(0) - sh.min(0)
    dims = {"body_width_mm": ext[0] * mm, "body_depth_mm": ext[1] * mm, "body_height_mm": ext[2] * mm,
            "body_centre_offset_mm": ((sh.max(0) + sh.min(0)) / 2 * mm).tolist(),
            "overall_with_buttons_and_camera_mm": ((co.max(0) - co.min(0)) * mm).tolist(),
            "camera_bump_mm": (co[:, 1].max() - HD) * mm,
            "button_protrusion_mm": (co[:, 0].max() - BODY_W / 2) * mm,
            "corner_radius_mm": R_BODY * mm, "display_corner_radius_mm": R_DISPLAY * mm,
            "requested_mm": [71.5, 147.5, 7.9]}
    expect(abs(ext[0] - BODY_W) < 1e-6 and abs(ext[2] - BODY_H) < 1e-6 and abs(ext[1] - DEPTH) < 1e-6,
           "body dimensions")
    expect(np.abs((sh.max(0) + sh.min(0)) / 2).max() < 1e-6, "Phone origin not at the body centre")
    res["dimensions"] = dims

    # --- screen: aspect, plane, bezels, UVs ------------------------------------------------------
    sc = _local_verts(screen)
    sw, shh = sc[:, 0].max() - sc[:, 0].min(), sc[:, 2].max() - sc[:, 2].min()
    aspect = sw / shh
    want = CSS_W / CSS_H
    fn, _fc = _face_arrays(screen)
    bez = {
        "left_mm": (sc[:, 0].min() - sh[:, 0].min()) * mm, "right_mm": (sh[:, 0].max() - sc[:, 0].max()) * mm,
        "top_mm": (sh[:, 2].max() - sc[:, 2].max()) * mm, "bottom_mm": (sc[:, 2].min() - sh[:, 2].min()) * mm,
    }
    scr = {"width_mm": sw * mm, "height_mm": shh * mm, "aspect": aspect, "aspect_wanted": want,
           "aspect_error_percent": abs(aspect / want - 1) * 100,
           "plane_y_mm": [sc[:, 1].min() * mm, sc[:, 1].max() * mm],
           "faces_facing_minus_y": int((fn[:, 1] < -0.9999).sum()), "faces": len(fn),
           "silhouette_to_display_mm (metal rim 0.62 + black glass 1.38)": bez}
    expect(scr["aspect_error_percent"] < 0.1, "screen aspect off by >= 0.1 %")
    expect(abs(sc[:, 1].max() + HD) < 1e-9 and abs(sc[:, 1].min() + HD) < 1e-9, "screen not planar at -HD")
    expect(scr["faces_facing_minus_y"] == scr["faces"], "screen faces not all facing -Y")
    expect(max(bez.values()) - min(bez.values()) < 1e-3, "bezels not even")  # mm, float32
    # UV: least-squares affine fit uv = A [x, z, 1] and its values at the rectangle corners
    me = screen.data
    lv = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    uv = np.zeros(len(me.loops) * 2)
    me.uv_layers["UVMap"].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    Xm = np.stack([sc[lv, 0], sc[lv, 2], np.ones(len(lv))], 1)
    A, *_ = np.linalg.lstsq(Xm, uv, rcond=None)
    resid = float(np.abs(Xm @ A - uv).max())
    x0, x1, z0, z1 = -DISPLAY_W / 2, DISPLAY_W / 2, -DISPLAY_H / 2, DISPLAY_H / 2
    corners = {"top_left": (x0, z1, (0, 1)), "top_right": (x1, z1, (1, 1)),
               "bottom_left": (x0, z0, (0, 0)), "bottom_right": (x1, z0, (1, 0))}
    uvc = {}
    for k, (x, z, w_uv) in corners.items():
        got = np.array([x, z, 1.0]) @ A
        uvc[k] = {"uv": got.tolist(), "expected": list(w_uv)}
        expect(np.abs(got - np.array(w_uv)).max() < 1e-5, f"screen UV corner {k}")
    # u grows to the viewer's right (+X seen from -Y), v grows upward, no mirroring
    uvs = {"affine_fit_max_residual": resid, "corners": uvc,
           "u_follows_screen_right": bool(A[0, 0] > 0 and abs(A[1, 0]) < 1e-5 * A[0, 0]),
           "v_follows_screen_up": bool(A[1, 1] > 0 and abs(A[0, 1]) < 1e-5 * A[1, 1]),
           "bounds": [uv.min(0).tolist(), uv.max(0).tolist()],
           "layers": [lay.name for lay in me.uv_layers]}
    expect(resid < 1e-5 and uvs["u_follows_screen_right"] and uvs["v_follows_screen_up"],
           "screen UV not planar / mirrored")
    scr["uv"] = uvs
    # shared boundary with the bezel, no coplanar overlap
    fnb, fcb = _face_arrays(body)
    front = np.abs(fcb[:, 1] + HD) < 1e-7
    over = front & _inside_rounded_rect(fcb[:, 0], fcb[:, 2], DISPLAY_W / 2 - 1e-6,
                                        DISPLAY_H / 2 - 1e-6, R_DISPLAY)
    ring0 = co[np.abs(co[:, 1] + HD) < 1e-9]
    from mathutils.kdtree import KDTree
    kd = KDTree(len(ring0))
    for i, c in enumerate(ring0):
        kd.insert(c, i)
    kd.balance()
    gap = max(kd.find(c)[2] for c in sc)
    scr["bezel_faces_overlapping_display"] = int(over.sum())
    scr["screen_boundary_to_bezel_edge_max_mm"] = gap * mm
    expect(int(over.sum()) == 0, "bezel overlaps the display (z-fighting)")
    expect(gap < 1e-9, "screen boundary does not meet the bezel")
    res["screen"] = scr

    # --- punch-hole ----------------------------------------------------------------------------------
    pc = _local_verts(punch)
    pfn, _ = _face_arrays(punch)
    ph = {"diameter_mm": (pc[:, 0].max() - pc[:, 0].min()) * mm,
          "centre_mm": (((pc.max(0) + pc.min(0)) / 2) * mm).tolist(),
          "in_front_of_screen_mm": (-HD - pc[:, 1].max()) * mm,
          "centre_below_display_top_mm": (DISPLAY_H / 2 - (pc[:, 2].max() + pc[:, 2].min()) / 2) * mm,
          "rim_samples": PUNCH_SEG * 4, "triangles": common.triangle_count(punch),
          "materials": [m.name for m in punch.data.materials],
          "faces_facing_front_min_minus_ny": float((-pfn[:, 1]).min()),
          "lens_dome_height_mm": (pc[:, 1].max() - pc[:, 1].min()) * mm}
    expect(ph["in_front_of_screen_mm"] >= 0.04 and ph["faces_facing_front_min_minus_ny"] > 0.9,
           "punch-hole placement")
    expect(abs((pc[:, 0].max() + pc[:, 0].min()) / 2) < 1e-9, "punch-hole not centred")
    res["punch_hole"] = ph

    # --- dock --------------------------------------------------------------------------------------
    info = ctx.info["dock"]
    de = info["scene_rect_de"]
    ml = dock.matrix_local
    loc = ml.translation
    Rm = ml.to_3x3().normalized()
    u_n = (loc.x - x0) / DISPLAY_W
    t_n = (z1 - loc.z) / DISPLAY_H
    sc_d = dock.scale
    d = {"location_phone_space_mm": [loc.x * mm, loc.y * mm, loc.z * mm],
         "on_screen_normalised_from_top_left": [u_n, t_n],
         "scene_rect_de": de, "scene_rect_centre": [de["x"] + de["w"] / 2, de["y"] + de["h"] / 2],
         "inside_scene_rect": bool(de["x"] <= u_n <= de["x"] + de["w"] and de["y"] <= t_n <= de["y"] + de["h"]),
         "distance_in_front_of_glass_mm": (-HD - loc.y) * mm,
         "blender_local_minus_y_in_phone_space (screen normal)": list(-Rm.col[1]),
         "blender_local_z_in_phone_space (screen up)": list(Rm.col[2]),
         "scale": list(sc_d), "scene_area_height_mm": info["scene_area_height_m"] * mm,
         "scale_times_billet_visible_height_mm": sc_d.x * BILLET_VISIBLE_H * mm,
         "gift_radius_at_fit_1_6_mm": 0.8 * sc_d.x * mm,
         "gift_clearance_to_glass_mm": ((-HD - loc.y) - 0.8 * sc_d.x) * mm,
         "custom_properties": sorted(k for k in dock.keys())}
    expect(d["inside_scene_rect"], "dock outside the scene rect")
    expect(abs(u_n - d["scene_rect_centre"][0]) < 1e-5 and abs(t_n - d["scene_rect_centre"][1]) < 1e-5,
           "dock not at the scene-rect centre")
    # identity under Phone: Blender local -Y = screen normal, +Z = screen up, which the glTF
    # conversion turns into three.js local +Z = screen normal, +Y = screen up (checked below)
    expect((-Vector(Rm.col[1]) - Vector((0, -1, 0))).length < 1e-6, "dock -Y is not the screen normal")
    expect((Vector(Rm.col[2]) - Vector((0, 0, 1))).length < 1e-6, "dock +Z is not screen up")
    expect(abs(sc_d.x - sc_d.y) < 1e-9 and abs(sc_d.x - sc_d.z) < 1e-9, "dock scale not uniform")
    expect(abs(sc_d.x * BILLET_VISIBLE_H - info["scene_area_height_m"]) < 1e-7, "dock scale")
    expect(abs((-HD - loc.y) - DOCK_OFFSET_FACTOR * sc_d.x) < 1e-7, "dock offset")
    expect(d["gift_clearance_to_glass_mm"] > 0, "gift would cut the glass")
    for k in ("sceneRectDe", "sceneRectEn", "screenWidthM", "screenHeightM", "dockScale"):
        expect(k in dock.keys(), f"dock custom property {k}")
    expect(dock.parent is phone, "dock parent")
    res["dock"] = d

    # --- triangles ----------------------------------------------------------------------------------
    tris = {o.name: common.triangle_count(o) for o in (body, screen, punch)}
    tris["total"] = sum(tris.values())
    tris["budget"] = TRI_BUDGET
    res["triangles"] = tris
    expect(tris["total"] <= TRI_BUDGET, "triangle budget")

    # --- normals: faces agree with the analytic normals, bmesh sanity --------------------------------
    cn = np.zeros(len(body.data.loops) * 3)
    body.data.corner_normals.foreach_get("vector", cn)
    cn = cn.reshape(-1, 3)
    lf = np.repeat(np.arange(len(body.data.polygons)),
                   [p.loop_total for p in body.data.polygons])
    agree = (cn * fnb[lf]).sum(1)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    inconsistent = sum(1 for e in bm.edges if e.is_manifold and not e.is_contiguous)
    degenerate = sum(1 for f in bm.faces if f.calc_area() < 1e-14)
    bm.free()
    res["body_normals"] = {"corner_vs_face_normal_min_dot": float(agree.min()),
                           "inconsistent_winding_edges": inconsistent,
                           "degenerate_faces": degenerate}
    expect(agree.min() > 0.3 and inconsistent == 0 and degenerate == 0, "body normals / winding")

    # --- UV_AO ------------------------------------------------------------------------------------------
    import build_card  # the lightmap helpers are shared with the card
    ov, cov = build_card._uv_overlap_pixels([body], "UV_AO")
    P, U = build_card._loop_tris(body, "UV_AO")
    st = build_card._uv_stats(P, U)
    big = st["a3"] > 1e-6
    ratios = (st["s1"] / np.maximum(st["s2"], 1e-30))[big]
    dens = (st["auv"] / np.maximum(st["a3"], 1e-30))[big]
    areas = st["a3"][big]
    res["uv_ao"] = {"layers": [lay.name for lay in body.data.uv_layers],
                    "overlap_pixels_1024": ov, "coverage": cov,
                    "isotropy_sv_ratio_area_weighted": float((ratios * areas).sum() / areas.sum()),
                    "texel_density_max_over_min_big_triangles": float(dens.max() / dens.min()),
                    "texels_per_mm": float(math.sqrt(np.median(dens)) * AO_RES * 1e-3)}
    expect(res["uv_ao"]["layers"][:2] == ["UVMap", "UV_AO"], "body uv layer order")
    expect(ov == 0, "UV_AO overlap")

    # --- materials + AO wiring ------------------------------------------------------------------------
    mres = {}
    ao_ok = True
    for m in list(body.data.materials) + list(screen.data.materials) + list(punch.data.materials):
        tree = m.node_tree
        bsdf = common.find_node(tree, "BSDF_PRINCIPLED")
        vals = {k: common.socket(bsdf.inputs, k).default_value for k in
                ("Metallic", "Roughness", "Coat Weight", "Transmission Weight", "Sheen Weight")}
        vals["Base Color"] = list(common.socket(bsdf.inputs, "Base Color").default_value)
        extra = sorted({n.type for n in tree.nodes} - ALLOWED_NODES)
        entry = {"inputs": vals, "unsupported_nodes": extra}
        expect(not extra and vals["Coat Weight"] == 0 and vals["Transmission Weight"] == 0
               and vals["Sheen Weight"] == 0, f"material {m.name}")
        if m in body.data.materials[:]:
            grp = next((n for n in tree.nodes if n.type == "GROUP" and n.node_tree
                        and n.node_tree.name == "glTF Material Output"), None)
            wired = False
            if grp is not None:
                s = common.socket(grp.inputs, "Occlusion")
                if s.is_linked:
                    sep = s.links[0].from_node
                    tex = sep.inputs[0].links[0].from_node if sep.inputs[0].is_linked else None
                    uvn = (tex.inputs[0].links[0].from_node
                           if tex is not None and tex.inputs[0].is_linked else None)
                    wired = (tex is not None and tex.type == "TEX_IMAGE" and tex.image is not None
                             and os.path.normcase(bpy.path.abspath(tex.image.filepath))
                             == os.path.normcase(ctx.info["ao"]["path"])
                             and uvn is not None and uvn.type == "UVMAP" and uvn.uv_map == "UV_AO")
            entry["ao_occlusion_wired"] = wired
            ao_ok &= wired
        mres[m.name] = entry
    fr = mres["M_Phone_Frame"]["inputs"]
    expect(abs(fr["Metallic"] - 0.85) < 1e-6 and abs(fr["Roughness"] - 0.35) < 1e-6, "frame material")
    expect(ao_ok, "AO not wired as occlusion on every body material")
    res["materials"] = mres
    ao = dict(ctx.info["ao"])
    ao["file_exists"] = os.path.isfile(ao["path"])
    ao["in_images_dir"] = os.path.dirname(ao["path"]) == common.IMAGES_DIR
    expect(ao["file_exists"] and ao["in_images_dir"], "AO image file")
    expect(0.6 < ao["surface_mean"] < 0.995 and ao["surface_fraction_below_0_9"] > 0.005,
           "AO bake looks empty or broken")
    res["ao"] = ao

    # --- glTF export read-back -------------------------------------------------------------------------
    try:
        ex = _export_check(ctx)
        for name in BODY_MATS:
            if name in ex["materials"]:
                expect(ex["materials"][name]["occlusion_texCoord"] == 1,
                       f"glTF {name} occlusionTexture not on texCoord 1")
        expect(all(n in ex["materials"] for n in BODY_MATS), "glTF body materials missing")
        expect(ex["materials"].get(SCREEN_MAT, {}).get("emissive_texCoord") == 0,
               "glTF M_Screen emissive slot not on texCoord 0")
        expect("TEXCOORD_1" in ex["meshes"].get("Phone_Body", {}).get("attributes", []),
               "glTF Phone_Body without TEXCOORD_1")
        expect(set(("sceneRectDe", "sceneRectEn", "dockScale")) <=
               set(ex["nodes"].get("Phone_ScreenDock", {}).get("extras_keys", [])),
               "glTF dock extras")
        for name in PHONE_MATS:
            expect(ex["materials"].get(name, {}).get("doubleSided") is False,
                   f"glTF {name} doubleSided")
        ax = ex["nodes"].get("Phone_ScreenDock", {}).get("local_axes_in_parent_gltf", {})
        expect(np.allclose(ax.get("+Z", [0, 0, 0]), [0, 0, 1], atol=1e-6)
               and np.allclose(ax.get("+Y", [0, 0, 0]), [0, 1, 0], atol=1e-6),
               "glTF dock frame is not +Z = screen normal, +Y = screen up")
        su = ex.get("screen_uv_gltf", {})
        expect(abs(su.get("v_at_display_top", 9)) < 1e-4
               and abs(su.get("v_at_display_bottom", 9) - 1) < 1e-4
               and abs(su.get("u_at_display_left", 9)) < 1e-4
               and abs(su.get("u_at_display_right", 9) - 1) < 1e-4,
               "glTF screen UV contract (v = 0 at the top, u left to right)")
        expect(su.get("normal_mean", np.zeros(3))[2] > 0.9999, "glTF screen normal is not +Z")
        res["gltf_export"] = ex
    except Exception as e:  # noqa: BLE001 - reported as a failed check
        fails.append(f"glTF export check: {e!r}")

    res["passed"] = not fails
    res["failures"] = fails
    return not fails, res


def write_checks(ctx: Ctx, res: dict) -> None:
    common.write_json(os.path.join(ctx.stage_renders("phone"), "checks.json"), rnd(res, 6))
    for f in res["failures"]:
        log(f"CHECK FAILED: {f}")
    log(f"phone checks {'passed' if res['passed'] else 'FAILED'}")


# ---------------------------------------------------------------------------------------------
# Check renders
# ---------------------------------------------------------------------------------------------

def _pbr_neutral(c: np.ndarray) -> np.ndarray:
    """Khronos PBR Neutral tone mapper (linear Rec.709 in, linear out), as in the Blender view."""
    start, desat = 0.8 - 0.04, 0.15
    x = c.min(-1, keepdims=True)
    offset = np.where(x < 0.08, x - 6.25 * x * x, 0.04)
    c = c - offset
    peak = c.max(-1, keepdims=True)
    d = 1.0 - start
    new_peak = 1.0 - d * d / (peak + d - start)
    comp = c * (new_peak / np.maximum(peak, 1e-9))
    g = 1.0 - 1.0 / (desat * (peak - new_peak) + 1.0)
    comp = comp * (1 - g) + new_peak * g
    return np.where(peak < start, c, comp)


def _srgb_to_lin(v):
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def _display_compensate(rgb_srgb: np.ndarray, view_transform: str) -> tuple[np.ndarray, dict]:
    """Emission values (linear) that the view transform shows as the capture's own colours, so
    the check renders show the display 1:1 like the runtime shader (toneMapped = false). Under
    PBR Neutral: a damped per-channel Newton inversion; display white is capped at 0.985
    (sRGB 253), which the curve reaches at emission ~3.9."""
    lin = _srgb_to_lin(rgb_srgb.astype(np.float64))
    if view_transform != "Khronos PBR Neutral":
        return lin, {"view_transform": view_transform, "compensated": False}
    y = np.minimum(lin, 0.985)
    x = y.copy()
    eps = 1e-4
    for _ in range(40):
        fx = _pbr_neutral(x)
        slope = np.zeros_like(x)
        for ch in range(3):
            xe = x.copy()
            xe[..., ch] += eps
            slope[..., ch] = (_pbr_neutral(xe)[..., ch] - fx[..., ch]) / eps
        x = np.clip(x + (y - fx) / np.maximum(slope, 0.02), 0.0, 50.0)
    err = np.abs(_pbr_neutral(x) - y)
    return x, {"view_transform": view_transform, "compensated": True,
               "max_abs_error_linear": float(err.max()), "max_emission": float(x.max())}


def _capture_image(path: str, view_transform: str, name: str = "check_screen_capture",
                   crop_css: bool = True) -> tuple[bpy.types.Image, dict]:
    """The top 390 x 844 CSS px window of a screen capture (the PNG runs past it), as a linear
    float image compensated for the view transform (check renders only)."""
    src = bpy.data.images.load(path, check_existing=False)
    try:
        src.colorspace_settings.name = "sRGB"
    except TypeError:
        pass
    w, h = src.size
    # stored values: the sRGB-encoded bytes / 255 for an 8-bit PNG
    px = common.image_to_numpy(src)          # bottom-up rows
    bpy.data.images.remove(src)
    keep = int(round(CSS_H * w / CSS_W)) if crop_css else h
    crop = np.ascontiguousarray(px[h - keep:])
    lin, info = _display_compensate(crop[..., :3], view_transform)
    out = np.concatenate([lin, np.ones(lin.shape[:2] + (1,))], axis=2).astype(np.float32)
    img = bpy.data.images.new(name, w, keep, alpha=True, float_buffer=True)
    for cs in ("Linear Rec.709", "Linear"):
        try:
            img.colorspace_settings.name = cs
            break
        except TypeError:
            continue
    img.pixels.foreach_set(out.ravel())
    info["size"] = [w, keep]
    return img, info


def _points(ctx, names) -> np.ndarray:
    return np.concatenate([common.evaluated_vertices(ctx.objects[n]) for n in names])


def render_phone(ctx: Ctx) -> None:
    out = ctx.stage_renders("phone")
    for old in glob.glob(os.path.join(out, "*.png")):
        os.remove(old)  # only this stage's own previous check renders
    scene = ctx.scene
    common.setup_eevee(scene, 1024, 64)
    phone = ctx.objects["Phone"]
    pw = phone.matrix_world
    target = pw.translation.copy()
    common.build_studio(ctx, target)
    coll = common.collection("CheckStudio")
    lights = [o for o in coll.objects if o.type == "LIGHT"]
    light_off = {o.name: o.location - target for o in lights}

    def orbit(az):
        common.face_studio(az)
        rot = Matrix.Rotation(math.radians(az), 3, "Z")
        for o in lights:
            o.location = target + rot @ light_off[o.name]
            common.look_at(o, target)
        refl = bpy.data.objects.get("Check_Reflector")
        if refl is not None:  # high up behind the camera, 1.4 m out: outside the mirror
            # angle of the glossy plate / lenses, inside the broad lobe of the matte back glass
            refl.location = target + common.view_direction(az - 20, 36) * 1.4
            common.look_at(refl, target)
            refl.hide_render = not (110 <= az % 360 <= 250)

    card_objs = [o for o in scene.objects if o.name.startswith("Card")]

    def show_card(on):
        for o in card_objs:
            o.hide_render = not on

    # screen textures for the check only
    tex = common.find_node(ctx.materials[SCREEN_MAT].node_tree, "TEX_IMAGE")
    placeholder = tex.image
    vt = scene.view_settings.view_transform
    capture, cap_info = _capture_image(CHECK_SCREEN_PNG, vt)
    orient, _ = _capture_image(os.path.join(common.TESTDATA_DIR, "print_front_test.png"), vt,
                               "check_screen_orient", crop_css=False)
    ctx.info["check_screen"] = cap_info
    log(f"check screen compensation: {cap_info}")

    # a soft rectangular reflector near the camera for the back views: its broad reflection on
    # the matte back glass and the frame shows the material separation (three.js will have an
    # environment with soft key reflections, not only the uniform studio)
    rd = bpy.data.lights.new("Check_Reflector", "AREA")
    rd.shape = "RECTANGLE"
    rd.size, rd.size_y = 0.7, 0.25
    rd.energy = 20.0
    reflector = bpy.data.objects.new("Check_Reflector", rd)
    coll.objects.link(reflector)

    # debug gift: a sphere of the size of a gift fitted to 1.6 billet units, at the dock
    dock = ctx.objects["Phone_ScreenDock"]
    s = dock.matrix_world.to_scale().x
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=0.8 * s,
                                         location=dock.matrix_world.translation)
    gift = bpy.context.active_object
    gift.name = "Check_GiftSphere"
    gift.data.materials.append(common.principled_material(
        "M_Check_Gift", base_color=common.hex_to_linear("#d6336c"), roughness=0.35))
    gift.data.shade_smooth()
    for c in list(gift.users_collection):
        c.objects.unlink(gift)
    coll.objects.link(gift)
    gift.hide_render = True

    def pw_box(center_local, half):
        c = pw @ Vector(center_local)
        return np.array([np.array(c) + np.array([sx, sy, sz]) * half
                         for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])

    ph_names = list(OBJECTS)
    zc_punch = DISPLAY_H / 2 - PUNCH_FROM_TOP
    mx, mz = CAM_MX, CAM_MZ
    shots = [
        # name, az, el, lens, points, margin, screen image, card, gift
        ("front", 0, 0, 50, None, 0.9, capture, False, False),
        ("three_quarter", 32, 12, 50, None, 0.88, capture, False, False),
        ("back", 180, 6, 50, None, 0.9, None, False, False),
        ("back_three_quarter", 215, 18, 50, None, 0.88, None, False, False),
        ("side_profile", 90, 0, 85, None, 0.9, None, False, False),
        ("screen_orientation", 0, 0, 50, None, 0.9, orient, False, False),
        ("macro_punch_hole", -18, 14, 100, pw_box((0, -HD, zc_punch), 0.0035), 1.0, capture, False, False),
        ("macro_bezel_corner", -38, 24, 100, pw_box((-BODY_W / 2 + 0.006, -HD + 0.002, BODY_H / 2 - 0.006), 0.0065),
         1.0, capture, False, False),
        ("macro_side_buttons", 68, 10, 100, pw_box((BODY_W / 2, 0, 0.020), 0.0175), 1.0, None, False, False),
        ("macro_camera", 205, 32, 100, pw_box((mx, HD + 0.001, mz), 0.0165), 1.0, None, False, False),
        ("dock_front", 0, 0, 50, None, 0.9, capture, False, True),
        ("dock_side", 70, 8, 50, None, 0.9, capture, False, True),
        ("scale", 14, 10, 50, "scale", 0.9, capture, True, False),
    ]
    items = []
    for name, az, el, lens, pts, margin, img, card_on, gift_on in shots:
        show_card(card_on)
        gift.hide_render = not gift_on
        tex.image = img if img is not None else placeholder
        orbit(az)
        cam = common.new_camera(f"Cam_{name}", coll, lens)
        if pts is None:
            p = _points(ctx, ph_names)
            if gift_on:
                p = np.concatenate([p, common.evaluated_vertices(gift)])
        elif isinstance(pts, str):
            p = np.concatenate([_points(ctx, ph_names),
                                _points(ctx, ("Card_Back", "Card_Front", "Card_Spine"))])
        else:
            p = pts
        common.fit_camera(cam, p, az, el, margin)
        path = os.path.join(out, f"{name}.png")
        common.render_still(scene, cam, path)
        items.append((name, path))
    show_card(True)
    tex.image = placeholder
    orbit(0)
    bpy.data.objects.remove(gift, do_unlink=True)
    bpy.data.objects.remove(reflector, do_unlink=True)
    common.contact_sheet(items, os.path.join(out, "contact.png"), cols=4, tile=512,
                         legend_path=os.path.join(out, "contact.json"))
