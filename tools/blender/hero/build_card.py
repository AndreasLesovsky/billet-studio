"""H2 - the folded greeting card ("billet", A6 portrait) for the home-page hero.

Object tree (all names [A-Za-z0-9_]):

    Card              empty. Origin = bottom end of the fold line, on the ground (z = 0).
    |- Card_Back      mesh, the back panel (rigid, never moves relative to Card).
    |- Card_Hinge     empty. Its local Z axis IS the fold line (the axis of the round spine).
    |  '- Card_Front  mesh, the cover (rigid, moves only through Card_Hinge).
    '- Card_Rig       armature, bones Spine_00 .. Spine_16 (all on the fold line), driven by
       '- Card_Spine  Card_Hinge. Skinned mesh: the bent strip of card between the panels.

Coordinates (Card space, metres, Z-up). The front camera looks along +Y from -Y:
    +X = right, +Z = up, -Y = towards the viewer.
    Closed card: the cover is in front (y < 0), the back panel behind it (y > 0); both panels
    span x = 0 .. 105 mm from the fold line, z = 0 .. 148 mm. The fold (spine) is the LEFT
    edge seen from the front; the card opens like a book.

Sign convention of the opening:
    open angle phi (degrees, >= 0) -> Card_Hinge.rotation_euler.z = -radians(phi)
    phi =   0  -> rotation  0 deg   closed, cover lying on the back panel
    phi =  90  -> rotation -90 deg  cover points straight at the front camera (-Y)
    phi = 180  -> rotation -180 deg fully open, cover to the LEFT (x = -105 .. 0)
    Use set_open_angle(ctx, phi); never write a positive rotation (that would swing the
    cover backwards through the back panel).
    Spine bones follow automatically through drivers:
        Card_Rig.pose.bones["Spine_kk"].rotation_euler.y = (kk / 16) * Card_Hinge.rotation_euler.z
    (each bone points along +Z, so its local Y rotation is a rotation about the fold line).
    three.js / glTF: set bone kk's rotation about the fold line to (kk/16) * hinge angle, or
    play a clip that samples both (H4 bakes the drivers into the clip).

Fold construction (rigid panels + skinned spine strip):
    Seen from above, the card at open angle phi is split into three disjoint angular sectors
    around the fold line:  back [0, 90] deg, spine [90, 270 - phi] deg, cover
    [270 - phi, 360 - phi] deg. The spine strip is a round bend, inner radius R_IN 0.5 mm,
    outer radius R_OUT 0.9 mm (0.4 mm card), rest shape = closed (180 deg of arc). Ring k of the
    strip rotates by (k/16) * hinge angle, so the bend always spans exactly the sector between
    the two panels: no overlapping surfaces (no z-fighting), no gap, no interpenetration at
    any angle, and at 180 deg it collapses to zero width. Every ring is weighted 1.0 to one
    bone, so the skinning is exact (no linear-blend shrinkage).
    The panels leave the spine R_IN off the centre plane and ease onto it within 6 mm
    (EASE, (1-t)^2 profile), so the closed card has the lens-shaped gap of a real scored card
    at the spine and touches along a line 6 mm in; opened flat, the same ease is a V-shaped
    crease valley on the printed inside, 0.5 mm deep with 9.5 deg walls at the fold line (a
    shading cue at 150-180 deg). Beyond the ease both panels bow away from
    each other (BOW 0.6 mm at the free edge, mirror-symmetric about the fold), so the closed
    card springs open by 1.2 mm at the free edge and the open sheet curls the same way on
    both sides of the fold.

Printing: the prints run over the rounded cut edges up to 45 deg (the half of each bevel next
to a printed face carries the print), the front artwork wraps round the spine to the fold
apex, and the inside spread's centre line sits on the inner fold apex. UVMap scale: the front
print spans the cover from the fold apex to the free edge (L + quarter spine), the inside
spread spans 2 x (L + quarter inner spine); the flat faces therefore map 0.7-1.3 % narrower
than the image, which is invisible.
"""

from __future__ import annotations

import glob
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

import common
from common import Ctx, log, rnd

# ---------------------------------------------------------------------------------------------
# Dimensions (metres)
# ---------------------------------------------------------------------------------------------
L = 0.105          # panel width, fold line -> free edge (A6 105 mm; flat sheet = A5 210 mm)
H = 0.148          # panel height
T = 0.0004         # card stock thickness (0.4 mm)
R_IN = 0.0005      # inner radius of the bent spine
R_OUT = R_IN + T   # outer radius of the spine (0.9 mm)
EASE = 0.006       # panels ease from R_IN onto the centre plane within 6 mm of the fold
BOW = 0.0006       # natural curl of each panel at the free edge (away from the other panel)
BEVEL = 0.00012    # cut-edge rounding (flat cut face of 0.16 mm remains)
BEVEL_SEGMENTS = 2

NZ = 10            # grid rows up a panel
NARC = 16          # segments (and bones - 1) of the spine strip
X_COLS = np.concatenate([np.array([0.0, 0.4, 0.9, 1.5, 2.2, 3.0, 3.9, 4.9, 6.0]) * 1e-3,
                         np.linspace(EASE, L, 13)[1:]])

S_OUT = math.pi * R_OUT / 2      # outer arc, fold apex -> panel
S_IN = math.pi * R_IN / 2        # inner arc, fold apex -> panel
U_FRONT = L + S_OUT              # metres of card per u of print_front
U_INSIDE = 2 * (L + S_IN)        # metres of card per u of the inside spread

(PART_INNER, PART_OUTER, PART_END, PART_FREE, PART_CAP, PART_ARC_OUT, PART_ARC_IN,
 PART_BEVEL) = range(1, 9)
SLOT_PAPER, SLOT_FRONT, SLOT_INSIDE, SLOT_BEVEL = range(4)
MAT_NAMES = ("M_Paper", "M_Print_Front", "M_Print_Inside")
KEEP_SLOTS = {"back": (SLOT_PAPER, SLOT_INSIDE),
              "front": (SLOT_PAPER, SLOT_FRONT, SLOT_INSIDE),
              "spine": (SLOT_PAPER, SLOT_FRONT, SLOT_INSIDE)}

PAPER_HEX = "#f6f2ea"
PAPER_TILE_M = 0.06             # one paper-normal tile covers 60 x 60 mm
NORMAL_STRENGTH = 0.3

CHECK_ANGLES = (0, 30, 90, 150, 180)
MESHES = ("Card_Back", "Card_Front", "Card_Spine")


# ---------------------------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------------------------

def set_open_angle(ctx: Ctx, phi_deg: float) -> None:
    """Open the card by phi degrees (0 = closed, 180 = flat). See the sign convention above."""
    hinge = ctx.objects["Card_Hinge"]
    hinge.rotation_euler = (0.0, 0.0, -math.radians(phi_deg))
    bpy.context.view_layer.update()


def build_card(ctx: Ctx) -> None:
    coll = common.collection("HeroCard")
    mats = _materials(ctx)

    card = common.new_empty("Card", coll, "PLAIN_AXES", 0.03)
    hinge = common.new_empty("Card_Hinge", coll, "SINGLE_ARROW", H, parent=card)
    hinge.rotation_mode = "XYZ"
    back = common.new_mesh_object("Card_Back", _panel_mesh("Card_Back", side=+1), coll, parent=card)
    front = common.new_mesh_object("Card_Front", _panel_mesh("Card_Front", side=-1), coll,
                                   parent=hinge)
    rig = _rig(coll, card, hinge)
    spine = common.new_mesh_object("Card_Spine", _spine_mesh("Card_Spine"), coll, parent=rig)
    ctx.objects.update(Card=card, Card_Hinge=hinge, Card_Back=back, Card_Front=front,
                       Card_Rig=rig, Card_Spine=spine)

    for obj, kind in ((back, "back"), (front, "front"), (spine, "spine")):
        _finish(obj, mats, kind)
    _uv_ao([back, front, spine])
    ctx.info["skin_ring_error_segments"] = _skin(spine, rig)

    card["heroCard"] = {
        "panelWidthM": L, "panelHeightM": H, "thicknessM": T,
        "spineInnerRadiusM": R_IN, "spineOuterRadiusM": R_OUT,
        "openAngle": "Card_Hinge.rotation_euler.z = -radians(phi); 0 closed, 180 flat",
        "spineBones": f"Spine_kk rotation about the fold line = kk/{NARC} * hinge rotation",
    }
    set_open_angle(ctx, 0.0)
    log(f"card built: {sum(common.triangle_count(o) for o in (back, front, spine))} triangles")


# ---------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------

def _materials(ctx: Ctx) -> dict:
    normal_path = os.path.join(ctx.images_dir, "paper_normal.png")
    ctx.info["paper_normal"] = common.paper_fibre_normal_map(normal_path,
                                                             tile_mm=PAPER_TILE_M * 1000)
    nimg = common.load_image(normal_path, "Non-Color", "paper_normal")
    front_path, inside_path = common.print_texture_paths(ctx)
    fimg = common.load_image(front_path, "sRGB", "print_front")
    iimg = common.load_image(inside_path, "sRGB", "print_inside")

    # UVMap units per material (see _uv0), so these tilings give the same 60 mm tile everywhere
    paper = common.hex_to_linear(PAPER_HEX)
    mats = {
        "M_Paper": common.principled_material(
            "M_Paper", base_color=paper, roughness=0.85, normal_image=nimg,
            normal_strength=NORMAL_STRENGTH, normal_tiling=(L / PAPER_TILE_M, H / PAPER_TILE_M)),
        "M_Print_Front": common.principled_material(
            "M_Print_Front", base_image=fimg, roughness=0.8, normal_image=nimg,
            normal_strength=NORMAL_STRENGTH,
            normal_tiling=(U_FRONT / PAPER_TILE_M, H / PAPER_TILE_M)),
        "M_Print_Inside": common.principled_material(
            "M_Print_Inside", base_image=iimg, roughness=0.8, normal_image=nimg,
            normal_strength=NORMAL_STRENGTH,
            normal_tiling=(U_INSIDE / PAPER_TILE_M, H / PAPER_TILE_M)),
    }
    ctx.materials.update(mats)
    return mats


# ---------------------------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------------------------

def _y_in(x: np.ndarray, z: float) -> np.ndarray:
    """Inner-face offset of the back panel from the centre plane (closed hinge frame)."""
    t = np.clip(x / EASE, 0.0, 1.0)
    ease = (1.0 - t) ** 2  # 9.5 deg wall at the fold (crease), flat where it meets the bow
    b = np.clip((x - EASE) / (L - EASE), 0.0, None)
    zf = 0.8 + 0.2 * math.sin(math.pi * z / H)
    return R_IN * ease + BOW * b ** 2 * zf


def _dy_in(x: np.ndarray, z: float) -> np.ndarray:
    t = np.clip(x / EASE, 0.0, 1.0)
    d_ease = -2.0 * (1.0 - t) / EASE
    b = np.clip((x - EASE) / (L - EASE), 0.0, None)
    zf = 0.8 + 0.2 * math.sin(math.pi * z / H)
    return R_IN * d_ease + 2 * BOW * b / (L - EASE) * zf


def _bevel_weights(me: bpy.types.Mesh, keys: set) -> None:
    bw = me.attributes.new("bevel_weight_edge", "FLOAT", "EDGE")
    ev = np.zeros(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ev)
    ev = ev.reshape(-1, 2)
    weights = np.array([1.0 if tuple(sorted(e)) in keys else 0.0 for e in ev.tolist()],
                       dtype=np.float32)
    bw.data.foreach_set("value", weights)
    assert int(weights.sum()) == len(keys), "bevel edge lookup failed"


def _make_mesh(name, verts, faces, parts, slots, bevel_keys) -> bpy.types.Mesh:
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.asarray(verts).tolist(), [], faces)
    me.validate(clean_customdata=False)
    assert len(me.polygons) == len(faces), f"{name}: faces lost in validate"
    me.polygons.foreach_set("material_index", np.array(slots, dtype=np.int32))
    part_attr = me.attributes.new("part", "INT", "FACE")
    part_attr.data.foreach_set("value", np.array(parts, dtype=np.int32))
    _bevel_weights(me, bevel_keys)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return me


def _panel_mesh(name: str, side: int) -> bpy.types.Mesh:
    """Panel in the closed hinge frame. side=+1 back panel (y > 0), side=-1 cover (mirror).

    Cross-section loop per row: inner face (free edge -> fold), end face at x = 0 (hidden,
    joins the spine strip), outer face (fold -> free edge), free edge."""
    xs = X_COLS
    n = len(xs) - 1
    m = 2 * n + 2
    zs = np.linspace(0.0, H, NZ + 1)
    verts = []
    for z in zs:
        yi = _y_in(xs, z)
        s = _dy_in(xs, z)
        k = 1.0 / np.sqrt(1.0 + s ** 2)
        # offset along the face normal (true 0.4 mm), faded to a pure y offset over the first
        # millimetre so the end face stays in the x = 0 plane where the spine strip joins
        fade = np.clip(xs / 0.001, 0.0, 1.0)
        ox, oy = xs - T * s * k * fade, yi + T * (k * fade + (1.0 - fade))
        loop = [(xs[i], yi[i]) for i in range(n, -1, -1)] + [(ox[i], oy[i]) for i in range(n + 1)]
        verts += [(px, side * py, z) for (px, py) in loop]
    tags = [PART_INNER] * n + [PART_END] + [PART_OUTER] * n + [PART_FREE]

    def v(j, i):
        return j * m + (i % m)

    def I(k):  # noqa: E743 - inner-face vertex of column k
        return n - k

    def O(k):  # noqa: E743 - outer-face vertex of column k
        return n + 1 + k

    faces, parts = [], []
    for j in range(NZ):
        for i in range(m):
            faces.append((v(j, i), v(j, i + 1), v(j + 1, i + 1), v(j + 1, i)))
            parts.append(tags[i])
    for j in (0, NZ):
        for k in range(n):
            faces.append((v(j, I(k)), v(j, I(k + 1)), v(j, O(k + 1)), v(j, O(k))))
            parts.append(PART_CAP)
    slots = [SLOT_INSIDE if p == PART_INNER else
             (SLOT_FRONT if side < 0 else SLOT_PAPER) if p == PART_OUTER else SLOT_PAPER
             for p in parts]
    keys = set()
    for j in (0, NZ):  # top/bottom cut edges, except the hidden end face
        for i in range(m):
            if tags[i] != PART_END:
                keys.add(tuple(sorted((v(j, i), v(j, i + 1)))))
    for i in (I(n), O(n)):  # free-edge corners
        for j in range(NZ):
            keys.add(tuple(sorted((v(j, i), v(j + 1, i)))))
    return _make_mesh(name, verts, faces, parts, slots, keys)


def _spine_mesh(name: str) -> bpy.types.Mesh:
    """Spine strip at rest (closed): half annulus 90..270 deg about the fold line, radii
    R_IN..R_OUT, one row from z = 0 to H. Ring i (angle 90 + 180 i / NARC) is skinned to bone
    Spine_ii. Its end faces coincide with the panels' hidden end faces."""
    th = np.radians(90.0 + 180.0 * np.arange(NARC + 1) / NARC)
    c, s = np.cos(th), np.sin(th)
    c[np.abs(c) < 1e-12] = 0.0
    loop = [(R_OUT * c[i], R_OUT * s[i]) for i in range(NARC + 1)] + \
           [(R_IN * c[i], R_IN * s[i]) for i in range(NARC, -1, -1)]
    m = len(loop)
    tags = [PART_ARC_OUT] * NARC + [PART_END] + [PART_ARC_IN] * NARC + [PART_END]
    verts = [(px, py, z) for z in (0.0, H) for (px, py) in loop]

    def v(j, i):
        return j * m + (i % m)

    faces, parts, slots = [], [], []
    for i in range(m):
        faces.append((v(0, i), v(0, i + 1), v(1, i + 1), v(1, i)))
        parts.append(tags[i])
        if tags[i] == PART_ARC_OUT:  # back half plain, cover half carries the front print
            slots.append(SLOT_FRONT if (i + 0.5) / NARC > 0.5 else SLOT_PAPER)
        elif tags[i] == PART_ARC_IN:
            slots.append(SLOT_INSIDE)
        else:
            slots.append(SLOT_PAPER)
    for j in (0, 1):
        for i in range(NARC):
            faces.append((v(j, i), v(j, i + 1), v(j, m - 2 - i), v(j, m - 1 - i)))
            parts.append(PART_CAP)
            slots.append(SLOT_PAPER)
    keys = {tuple(sorted((v(j, i), v(j, i + 1)))) for j in (0, 1) for i in range(m)
            if tags[i] != PART_END}
    return _make_mesh(name, verts, faces, parts, slots, keys)


def _rig(coll, card, hinge) -> bpy.types.Object:
    """Armature with NARC+1 bones on the fold line, bone k driven to k/NARC of the hinge."""
    arm = bpy.data.armatures.new("Card_Rig")
    rig = bpy.data.objects.new("Card_Rig", arm)
    coll.objects.link(rig)
    rig.parent = card
    rig.matrix_parent_inverse = Matrix.Identity(4)
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    rig.select_set(True)
    vl.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for k in range(NARC + 1):
        eb = arm.edit_bones.new(f"Spine_{k:02d}")
        eb.head = (0.0, 0.0, 0.0)
        eb.tail = (0.0, 0.0, H * 0.25)  # bone Y = card +Z = fold line
        eb.roll = 0.0
        eb.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.select_set(False)
    for k in range(NARC + 1):
        pb = rig.pose.bones[f"Spine_{k:02d}"]
        pb.rotation_mode = "XYZ"
        if k == 0:
            continue
        fc = pb.driver_add("rotation_euler", 1)
        for mod in list(fc.modifiers):
            fc.modifiers.remove(mod)
        drv = fc.driver
        drv.type = "SCRIPTED"
        var = drv.variables.new()
        var.name = "phi"
        var.type = "SINGLE_PROP"
        var.targets[0].id_type = "OBJECT"
        var.targets[0].id = hinge
        var.targets[0].data_path = "rotation_euler[2]"
        drv.expression = f"phi*{k}/{NARC}"  # simple expression: no Python auto-run needed
    return rig


def _skin(spine: bpy.types.Object, rig: bpy.types.Object) -> float:
    """Weight every strip vertex 1.0 to the bone of its ring (found from its rest angle)."""
    co = common.mesh_vertices(spine, world=False)
    th = np.degrees(np.arctan2(co[:, 1], co[:, 0]))
    th = np.where(th < 0, th + 360.0, th)
    f = (th - 90.0) / 180.0 * NARC
    k = np.clip(np.round(f), 0, NARC).astype(int)
    err = float(np.abs(f - k).max())
    assert err < 1e-3, f"spine vertex between rings ({err:.2e} segments)"
    for ring in range(NARC + 1):
        vg = spine.vertex_groups.new(name=f"Spine_{ring:02d}")
        vg.add(np.nonzero(k == ring)[0].tolist(), 1.0, "REPLACE")
    mod = spine.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    mod.use_vertex_groups = True
    mod.use_deform_preserve_volume = False
    return err


def _mesh_arrays(me: bpy.types.Mesh) -> dict:
    npoly = len(me.polygons)
    a = {"ls": np.zeros(npoly, dtype=np.int64), "lt": np.zeros(npoly, dtype=np.int64),
         "lv": np.zeros(len(me.loops), dtype=np.int64), "fn": np.zeros(npoly * 3),
         "fc": np.zeros(npoly * 3), "mi": np.zeros(npoly, dtype=np.int32),
         "part": np.zeros(npoly, dtype=np.int32), "area": np.zeros(npoly)}
    me.polygons.foreach_get("loop_start", a["ls"])
    me.polygons.foreach_get("loop_total", a["lt"])
    me.loops.foreach_get("vertex_index", a["lv"])
    me.polygons.foreach_get("normal", a["fn"])
    me.polygons.foreach_get("center", a["fc"])
    me.polygons.foreach_get("material_index", a["mi"])
    me.polygons.foreach_get("area", a["area"])
    me.attributes["part"].data.foreach_get("value", a["part"])
    a["fn"] = a["fn"].reshape(-1, 3)
    a["fc"] = a["fc"].reshape(-1, 3)
    a["loop_face"] = np.repeat(np.arange(npoly), a["lt"])
    return a


def _angle(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Angle about the fold line in [0, 2 pi)."""
    th = np.arctan2(y, x)
    return np.where(th < 0, th + 2 * math.pi, th)


def _finish(obj: bpy.types.Object, mats: dict, kind: str) -> None:
    me = obj.data
    for name in ("M_Paper", "M_Print_Front", "M_Print_Inside", "M_Paper"):
        me.materials.append(mats[name])

    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.affect = "EDGES"
    mod.limit_method = "WEIGHT"
    mod.edge_weight = "bevel_weight_edge"
    mod.width = BEVEL
    mod.segments = BEVEL_SEGMENTS
    mod.profile = 0.5
    mod.use_clamp_overlap = False
    mod.loop_slide = False
    mod.harden_normals = False
    mod.material = SLOT_BEVEL
    common.apply_modifiers(obj)
    me = obj.data

    # Bevel faces: the half next to a printed face gets that print (ink runs over the rounded
    # edge up to the cut), the half next to a cut face (cap / free edge) stays paper.
    a = _mesh_arrays(me)
    mi, part, fn, fc = a["mi"], a["part"], a["fn"], a["fc"]
    bev = mi == SLOT_BEVEL
    part[bev] = PART_BEVEL
    nz = np.abs(fn[:, 2])
    nh = np.hypot(fn[:, 0], fn[:, 1])
    to_cap = nz >= nh
    if kind == "spine":
        rad = fc[:, :2] / np.maximum(np.hypot(fc[:, 0], fc[:, 1]), 1e-12)[:, None]
        outward = (fn[:, :2] * rad).sum(1) > 0
        t = (_angle(fc[:, 0], fc[:, 1]) - math.pi / 2) / math.pi
        side_slot = np.where(outward, np.where(t > 0.5, SLOT_FRONT, SLOT_PAPER), SLOT_INSIDE)
    else:
        sgn = 1.0 if kind == "back" else -1.0
        inner = fn[:, 1] * sgn < 0
        free = np.abs(fn[:, 0]) > np.abs(fn[:, 1])
        outer_slot = SLOT_FRONT if kind == "front" else SLOT_PAPER
        side_slot = np.where(free, SLOT_PAPER, np.where(inner, SLOT_INSIDE, outer_slot))
    mi[bev] = np.where(to_cap[bev], SLOT_PAPER, side_slot[bev])
    me.attributes["part"].data.foreach_set("value", part)

    keep = KEEP_SLOTS[kind]
    remap = np.full(4, -1, dtype=np.int32)
    for new, old in enumerate(keep):
        remap[old] = new
    mi = remap[mi]
    assert (mi >= 0).all(), f"{obj.name}: face with an unexpected material"
    while len(me.materials) > 0:
        me.materials.pop(index=len(me.materials) - 1)
    for old in keep:
        me.materials.append(mats[MAT_NAMES[old]])
    me.polygons.foreach_set("material_index", mi)
    if "bevel_weight_edge" in me.attributes:
        me.attributes.remove(me.attributes["bevel_weight_edge"])
    me.update()

    _uv0(obj, kind)
    me.shade_smooth()
    _custom_normals(obj, kind)


def _uv0(obj: bpy.types.Object, kind: str) -> None:
    """UVMap. Units per material (all continuous across edges, none degenerate):
      M_Print_Front   u = arc/straight distance from the outer fold apex / U_FRONT, v = z/H
      M_Print_Inside  u = 0.5 +- distance from the inner fold apex / U_INSIDE (cover = left
                      half, back = right half, reading correctly when open), v = z/H
      M_Paper         panel units (u = 1 per 105 mm, v = 1 per 148 mm): planar per dominant
                      axis; on the spine the u runs along the arc (continues the back face)."""
    me = obj.data
    a = _mesh_arrays(me)
    co = common.mesh_vertices(obj, world=False)
    lf = a["loop_face"]
    p = co[a["lv"]]
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    n = a["fn"][lf]
    ax = np.argmax(np.abs(n), axis=1)
    names = np.array([m.name for m in me.materials])[a["mi"][lf]]
    part = a["part"][lf]
    th = _angle(x, y)

    uv = np.zeros((len(p), 2))
    uv[:, 0] = np.where(ax == 0, y / L, x / L)
    uv[:, 1] = np.where(ax == 2, y / H, z / H)
    front = names == "M_Print_Front"
    inside = names == "M_Print_Inside"
    if kind == "spine":
        arc_paper = (names == "M_Paper") & (ax != 2) & (part != PART_END)
        uv[arc_paper, 0] = -R_OUT * (th[arc_paper] - math.pi / 2) / L
        uv[arc_paper, 1] = z[arc_paper] / H
        uf = R_OUT * (th - math.pi) / U_FRONT
        ui = 0.5 - R_IN * (th - math.pi) / U_INSIDE
    else:
        uf = (x + S_OUT) / U_FRONT
        ui = (0.5 + (x + S_IN) / U_INSIDE) if kind == "back" else (0.5 - (x + S_IN) / U_INSIDE)
    uv[front, 0] = uf[front]
    uv[inside, 0] = ui[inside]
    uv[front | inside, 1] = z[front | inside] / H
    printed = front | inside
    uv[printed] = np.clip(uv[printed], 0.0, 1.0)  # guards float noise only
    layer = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    layer.data.foreach_set("uv", uv.astype(np.float32).ravel())


def _uv_ao(objs: list) -> None:
    """UV_AO: ONE non-overlapping lightmap shared by all card meshes (the materials are shared,
    so a material's occlusion texture must hold every mesh without overlap). Unwrapped in a
    single multi-object edit session, isotropic (no image aspect correction), packed with one
    uniform scale."""
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    # UV operators (pack, average scale) correct for the aspect of the material's active
    # texture image (print_inside is 2100 x 1480) whatever correct_aspect says. Detach the
    # images while unwrapping so the lightmap is isotropic for any print texture.
    detached = []
    for m in {m for o in objs for m in o.data.materials}:
        for node in m.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image is not None:
                detached.append((node, node.image))
                node.image = None
    # The bevel round a 0.5 mm-radius spine rim is a torus patch (not developable); keep it out
    # of the arc islands, or the flattening pushes its distortion into the thin arc faces.
    for o in objs:
        part = np.zeros(len(o.data.polygons), dtype=np.int32)
        o.data.attributes["part"].data.foreach_get("value", part)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        for e in bm.edges:
            ps = {int(part[f.index]) for f in e.link_faces}
            if PART_BEVEL in ps and ps & {PART_ARC_OUT, PART_ARC_IN}:
                e.seam = True
        bm.to_mesh(o.data)
        bm.free()
    for o in objs:
        me = o.data
        ao = me.uv_layers.get("UV_AO") or me.uv_layers.new(name="UV_AO")
        me.uv_layers.active = ao
        o.select_set(True)
    vl.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0,
                             area_weight=0.0, correct_aspect=False, scale_to_bounds=False)
    # smart_project projects each island onto one plane, which foreshortens faces tilted
    # against it (curved spine, bevels) by up to 1/cos(66 deg). Keep its islands as seams and
    # flatten each island properly (all islands here are developable up to tiny bevel corners).
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.seams_from_islands(mark_seams=True, mark_sharp=False)
    # LSCM: exact on these developable islands, also on the 0.1 x 148 mm spine slivers
    # (ABF leaves them 1.5:1 stretched, SLIM does not converge on them)
    bpy.ops.uv.unwrap(method="CONFORMAL", fill_holes=True, correct_aspect=False, margin=0.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    _rectify_arc_islands(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004, shape_method="CONVEX")
    bpy.ops.object.mode_set(mode="OBJECT")
    for node, img in detached:
        node.image = img
    for o in objs:
        uv0 = o.data.uv_layers["UVMap"]
        o.data.uv_layers.active = uv0
        uv0.active_render = True
        o.select_set(False)


def _rectify_arc_islands(objs: list) -> None:
    """Blender's unwrappers are ill-conditioned on the spine's 0.1 x 148 mm arc slivers (LSCM
    leaves the inner arc 1.5:1 stretched). The arcs are cylinders, so their exact development
    is known: (radius * angle, z). Replace each arc island's UV_AO by that development, scaled
    to the median texel density and fitted onto the unwrapped island by orthogonal Procrustes;
    average_islands_scale + pack_islands run afterwards."""
    dens = []
    for o in objs:
        P, U = _loop_tris(o, "UV_AO")
        st = _uv_stats(P, U)
        big = st["a3"] > 1e-6
        dens.append(np.sqrt(st["auv"][big] / st["a3"][big]))
    d = float(np.median(np.concatenate(dens)))
    for o in objs:
        me = o.data
        a = _mesh_arrays(me)
        arc = np.isin(a["part"], (PART_ARC_OUT, PART_ARC_IN))
        if not arc.any():
            continue
        co = common.mesh_vertices(o, world=False)
        # islands: arc faces connected through non-seam edges
        parent = list(range(len(me.polygons)))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        edge_faces: dict = {}
        for p in me.polygons:
            if arc[p.index]:
                for ek in p.edge_keys:
                    edge_faces.setdefault(ek, []).append(p.index)
        seam = {e.key: e.use_seam for e in me.edges}
        for ek, fs in edge_faces.items():
            if len(fs) == 2 and not seam[ek]:
                parent[find(fs[0])] = find(fs[1])
        uv = _uv_array(o, "UV_AO")
        roots = {find(f) for f in np.nonzero(arc)[0]}
        for r0 in roots:
            faces = [f for f in np.nonzero(arc)[0] if find(f) == r0]
            loops = np.concatenate([np.arange(a["ls"][f], a["ls"][f] + a["lt"][f]) for f in faces])
            fpart = np.repeat([a["part"][f] for f in faces], [a["lt"][f] for f in faces])
            p = co[a["lv"][loops]]
            rad = np.where(fpart == PART_ARC_OUT, R_OUT, R_IN)
            X = np.stack([rad * _angle(p[:, 0], p[:, 1]), p[:, 2]], 1)
            Uo = uv[loops]
            Xc, Uc = X - X.mean(0), Uo - Uo.mean(0)
            A, _s, Bt = np.linalg.svd(Uc.T @ Xc)
            Q = A @ Bt
            uv[loops] = Uo.mean(0) + d * Xc @ Q.T
        me.uv_layers["UV_AO"].data.foreach_set("uv", uv.astype(np.float32).ravel())


def _unit(a: np.ndarray) -> np.ndarray:
    ln = np.linalg.norm(a, axis=-1, keepdims=True)
    return np.where(ln > 1e-20, a / np.maximum(ln, 1e-30), 0.0)


def _custom_normals(obj: bpy.types.Object, kind: str) -> None:
    """Each face group (inner, outer, arc, cap, ...) is smooth on its own; bevel strips blend
    from their neighbour's normal to the cap/free-edge normal. Spine arcs get exact radial
    normals, and every normal at the panel/spine junction is made exactly radial in the
    horizontal plane, so the two meshes shade seamlessly."""
    me = obj.data
    a = _mesh_arrays(me)
    co = common.mesh_vertices(obj, world=False)
    ls, lt, lv, fn, part, lf = a["ls"], a["lt"], a["lv"], a["fn"], a["part"], a["loop_face"]
    nl = len(lv)
    pos = np.arange(nl) - ls[lf]
    prev = ls[lf] + (pos - 1) % lt[lf]
    nxt = ls[lf] + (pos + 1) % lt[lf]
    e1 = co[lv[prev]] - co[lv]
    e2 = co[lv[nxt]] - co[lv]
    cosang = (e1 * e2).sum(1) / (np.linalg.norm(e1, axis=1) * np.linalg.norm(e2, axis=1) + 1e-30)
    w = fn[lf] * np.arccos(np.clip(cosang, -1.0, 1.0))[:, None]
    lpart = part[lf]
    nv = len(co)

    radial = co.copy()
    radial[:, 2] = 0.0
    radial = _unit(radial)
    gn, has = {}, {}
    for g in np.unique(part):
        acc = np.zeros((nv, 3))
        sel = lpart == g
        np.add.at(acc, lv[sel], w[sel])
        has[g] = np.linalg.norm(acc, axis=1) > 1e-20
        gn[g] = _unit(acc)
        if g == PART_ARC_OUT:
            gn[g] = radial.copy()
        elif g == PART_ARC_IN:
            gn[g] = -radial
    out = np.zeros((nl, 3))
    nb = lpart != PART_BEVEL
    for g in gn:
        sel = lpart == g
        out[sel] = gn[g][lv[sel]]
    # bevel corners: the neighbour normal closest to the bevel face, else the bevel's own
    bsel = np.nonzero(~nb)[0]
    if len(bsel):
        cands = [g for g in gn if g != PART_BEVEL]
        best = np.full(len(bsel), -np.inf)
        chosen = gn[PART_BEVEL][lv[bsel]].copy()
        fnb = fn[lf[bsel]]
        for g in cands:
            ok = has[g][lv[bsel]]
            cand = gn[g][lv[bsel]]
            d = np.where(ok, (cand * fnb).sum(1), -np.inf)
            upd = d > best
            best[upd] = d[upd]
            chosen[upd] = cand[upd]
        out[bsel] = chosen
    # junction / arcs: horizontal part exactly radial (spine) or exactly +-Y (panel end ring)
    if kind == "spine":
        fix = np.isin(lpart, (PART_BEVEL, PART_ARC_OUT, PART_ARC_IN))
        r = radial[lv[fix]]
    else:
        fix = (np.abs(co[lv, 0]) < 1e-9) & (lpart != PART_END) & (lpart != PART_CAP)
        r = np.zeros((int(fix.sum()), 3))
        r[:, 1] = 1.0
    if fix.any():
        nf = out[fix]
        hmag = np.hypot(nf[:, 0], nf[:, 1])
        sgn = np.sign((nf[:, :2] * r[:, :2]).sum(1))
        sgn[sgn == 0] = 1.0
        nf2 = r * (sgn * hmag)[:, None]
        nf2[:, 2] = nf[:, 2]
        out[fix] = nf2
    out = _unit(out)
    me.normals_split_custom_set([tuple(v) for v in out.tolist()])


# ---------------------------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------------------------

def _state(obj: bpy.types.Object, topo: dict) -> dict:
    """World-space vertices (after the armature), face normals, centres and areas."""
    co = common.evaluated_vertices(obj, world=True)
    ls, lt, lv = topo["ls"], topo["lt"], topo["lv"]
    lf = topo["loop_face"]
    pos = np.arange(len(lv)) - ls[lf]
    nxt = ls[lf] + (pos + 1) % lt[lf]
    cr = np.cross(co[lv], co[lv[nxt]])
    av = np.zeros((len(ls), 3))
    np.add.at(av, lf, cr)
    av *= 0.5
    area = np.linalg.norm(av, axis=1)
    fc = np.zeros((len(ls), 3))
    np.add.at(fc, lf, co[lv])
    fc /= lt[:, None]
    lo = np.full((len(ls), 3), np.inf)
    hi = np.full((len(ls), 3), -np.inf)
    np.minimum.at(lo, lf, co[lv])
    np.maximum.at(hi, lf, co[lv])
    width = area / np.maximum(np.linalg.norm(hi - lo, axis=1), 1e-30)  # ~ smallest extent
    return {"co": co, "fn": _unit(av), "area": area, "fc": fc, "width": width,
            "polys": topo["polys"], "part": topo["part"]}


def _topo(obj: bpy.types.Object) -> dict:
    a = _mesh_arrays(obj.data)
    a["polys"] = [tuple(p.vertices) for p in obj.data.polygons]
    a["mat_names"] = [m.name for m in obj.data.materials]
    return a


def _bvh(st: dict) -> BVHTree:
    return BVHTree.FromPolygons(st["co"].tolist(), st["polys"], epsilon=0.0)


def _sector_violation(co: np.ndarray, center_deg: float, half_deg: float) -> float:
    """Largest angular excursion (deg) of points outside [center - half, center + half]."""
    th = np.degrees(np.arctan2(co[:, 1], co[:, 0]))
    d = (th - center_deg + 180.0) % 360.0 - 180.0
    return float(max(0.0, (np.abs(d) - half_deg).max()))


def _coincident(sa: dict, bvh_b: BVHTree, tol: float = 1e-6):
    """Faces of A lying on a face of B: a ray through A's face centre along its normal, from
    -tol to +tol, hits B (same-facing count = z-fighting, opposite-facing = hidden contact).
    Rays, not find_nearest: BVHTree.find_nearest is off by microns on the 148 mm x 0.05 mm
    sliver triangles of the spine."""
    same = opp = 0
    for c, n, wd, part in zip(sa["fc"], sa["fn"], sa["width"], sa["part"]):
        if wd < 1e-7:
            continue  # collapsed sliver (the spine at 180 deg): no area, nothing to see
        if part == PART_END:
            continue  # hidden joins between spine and panel, always enclosed by the solid
        nv = Vector(n)
        hit = bvh_b.ray_cast(Vector(c) - nv * tol, nv, 2 * tol)
        if hit[0] is None:
            continue
        nb = hit[1]
        dot = nv.dot(nb)
        if dot > 0.999:
            same += 1
        elif dot < -0.999:
            opp += 1
    return same, opp


def _uv_orientation(obj, layer_name, mat_name, screen_axes):
    """Count triangles whose UV winding differs from their on-screen winding (= mirrored),
    and the sign of the u/x and v/z correlation, for faces of mat_name in world space."""
    me = obj.data
    co = common.evaluated_vertices(obj, world=True)
    uvl = me.uv_layers[layer_name].data
    names = [m.name for m in me.materials]
    if mat_name not in names:
        return None
    mi_target = names.index(mat_name)
    mirrored = total = 0
    us, xs, vs, zs = [], [], [], []
    for poly in me.polygons:
        if poly.material_index != mi_target:
            continue
        li = list(poly.loop_indices)
        for k in range(1, len(li) - 1):
            tri = (li[0], li[k], li[k + 1])
            P = np.array([co[me.loops[t].vertex_index] for t in tri])
            U = np.array([uvl[t].uv[:] for t in tri])
            s = P[:, screen_axes]
            a_screen = np.cross(s[1] - s[0], s[2] - s[0])
            a_uv = np.cross(U[1] - U[0], U[2] - U[0])
            if abs(a_screen) < 1e-14 or abs(a_uv) < 1e-12:
                continue
            total += 1
            mirrored += int(np.sign(a_screen) != np.sign(a_uv))
        for t in li:
            us.append(uvl[t].uv[0]); vs.append(uvl[t].uv[1])
            p = co[me.loops[t].vertex_index]
            xs.append(p[screen_axes[0]]); zs.append(p[screen_axes[1]])
    return {
        "triangles": total, "mirrored": mirrored,
        "u_follows_screen_right": bool(np.corrcoef(us, xs)[0, 1] > 0.99),
        "v_follows_screen_up": bool(np.corrcoef(vs, zs)[0, 1] > 0.99),
    }


def _uv_array(obj, layer_name) -> np.ndarray:
    me = obj.data
    uv = np.zeros(len(me.loops) * 2)
    me.uv_layers[layer_name].data.foreach_get("uv", uv)
    return uv.reshape(-1, 2)


def _uv_bounds(obj, layer_name):
    me = obj.data
    uv = _uv_array(obj, layer_name)
    a = _mesh_arrays(me)
    lm = a["mi"][a["loop_face"]]
    out = {"all": [uv.min(0).tolist(), uv.max(0).tolist()]}
    for i, m in enumerate(me.materials):
        sel = uv[lm == i]
        if len(sel):
            out[m.name] = [sel.min(0).tolist(), sel.max(0).tolist()]
    return out


def _loop_tris(obj, layer_name):
    """(3D triangle corners [n,3,3] in local space, UV corners [n,3,2])."""
    me = obj.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    tl = np.zeros(nt * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("loops", tl)
    lv = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    co = common.mesh_vertices(obj, world=False)
    uv = _uv_array(obj, layer_name)
    return co[lv[tl]].reshape(nt, 3, 3), uv[tl].reshape(nt, 3, 2)


def _uv_stats(P: np.ndarray, U: np.ndarray) -> dict:
    """Per triangle: 3D area, UV area and the singular values of the 3D->UV map."""
    e1, e2 = P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]
    a3 = 0.5 * np.linalg.norm(np.cross(e1, e2), axis=1)
    ax = _unit(e1)
    by = _unit(e2 - (e2 * ax).sum(1)[:, None] * ax)
    p1 = np.stack([np.linalg.norm(e1, axis=1), np.zeros(len(P))], 1)
    p2 = np.stack([(e2 * ax).sum(1), (e2 * by).sum(1)], 1)
    Pm = np.stack([p1, p2], 2)                       # columns = local 2D edges
    D = np.stack([U[:, 1] - U[:, 0], U[:, 2] - U[:, 0]], 2)
    ok = a3 > 1e-14
    J = np.zeros((len(P), 2, 2))
    J[ok] = D[ok] @ np.linalg.inv(Pm[ok])
    sv = np.linalg.svd(J, compute_uv=False)
    ua = 0.5 * np.abs(np.cross(D[:, :, 0], D[:, :, 1]))
    return {"a3": a3, "auv": ua, "s1": sv[:, 0], "s2": sv[:, 1]}


def _uv_overlap_pixels(objs, layer_name, res=1024):
    """Rasterise the UV triangles of all objects into one grid (pixel centres, shrunk by a hair)
    and count doubly covered pixels."""
    cover = np.zeros((res, res), dtype=np.int16)
    for obj in objs:
        _P, U = _loop_tris(obj, layer_name)
        for tri in U * res:
            x0, y0 = np.floor(tri.min(0)).astype(int)
            x1, y1 = np.ceil(tri.max(0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, res - 1), min(y1, res - 1)
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            a, b, c = tri
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-12:
                continue
            l1 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / den
            l2 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / den
            l3 = 1 - l1 - l2
            eps = 1e-4
            inside = (l1 > eps) & (l2 > eps) & (l3 > eps)
            cover[y0:y1 + 1, x0:x1 + 1] += inside.astype(np.int16)
    return int((cover > 1).sum()), float((cover > 0).mean())


def _manifold(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    inconsistent = sum(1 for e in bm.edges if e.is_manifold and not e.is_contiguous)
    degenerate = sum(1 for f in bm.faces if f.calc_area() < 1e-14)
    volume = bm.calc_volume(signed=True)
    bm.free()
    # folded-over faces: every top/bottom cut-edge cap must face straight up/down
    part = np.zeros(len(obj.data.polygons), dtype=np.int32)
    obj.data.attributes["part"].data.foreach_get("value", part)
    flipped = 0
    for p in obj.data.polygons:
        if part[p.index] == PART_CAP:
            want = 1.0 if p.center.z > H / 2 else -1.0
            flipped += int(p.normal.z * want < 0.99)
    return {"non_manifold_edges": non_manifold, "boundary_edges": boundary,
            "inconsistent_winding_edges": inconsistent, "degenerate_faces": degenerate,
            "folded_cap_faces": flipped,
            "signed_volume_mm3": volume * 1e9, "normals_outward": volume > 0}


def _visible_print(states: dict, topos: dict, want: str) -> dict:
    """Faces seen by the front camera (normal within 45 deg of -Y, nothing in front of them
    along -Y) must all carry the print `want`; any paper there would be a white rim."""
    allco, allpolys, off = [], [], 0
    for name in MESHES:
        st = states[name]
        allco.append(st["co"])
        allpolys += [tuple(i + off for i in p) for p in st["polys"]]
        off += len(st["co"])
    bvh = BVHTree.FromPolygons(np.concatenate(allco).tolist(), allpolys, epsilon=0.0)
    d = Vector((0.0, -1.0, 0.0))
    res = {"visible_faces": 0, "wrong_material": 0, "by_material": {}}
    for name in MESHES:
        st, tp = states[name], topos[name]
        for f in range(len(st["polys"])):
            n = st["fn"][f]
            if st["area"][f] < 1e-12 or -n[1] < 0.7072:
                continue
            o = Vector(st["fc"][f]) + Vector(n) * 2e-7
            if bvh.ray_cast(o, d)[0] is not None:
                continue
            m = tp["mat_names"][tp["mi"][f]]
            res["visible_faces"] += 1
            res["by_material"][m] = res["by_material"].get(m, 0) + 1
            res["wrong_material"] += int(m != want)
    return res


def _ray_y(bvh: BVHTree, x: float, z: float, y0: float, direction: float) -> float | None:
    hit = bvh.ray_cast(Vector((x, y0, z)), Vector((0.0, direction, 0.0)))
    return None if hit[0] is None else hit[0].y


def check_card(ctx: Ctx) -> bool:
    objs = {n: ctx.objects[n] for n in MESHES}
    back, front, spine = objs["Card_Back"], objs["Card_Front"], objs["Card_Spine"]
    hinge, card = ctx.objects["Card_Hinge"], ctx.objects["Card"]
    mm = 1000.0
    res: dict = {}
    fails: list[str] = []

    def expect(cond, msg):
        if not cond:
            fails.append(msg)

    topos = {n: _topo(o) for n, o in objs.items()}
    set_open_angle(ctx, 0.0)

    # --- dimensions (rest = closed, hinge frame) -----------------------------------------------
    dims = {}
    for obj in (back, front):
        co = common.mesh_vertices(obj, world=False)
        bvh = BVHTree.FromPolygons(co.tolist(), topos[obj.name]["polys"])
        th = []
        for fx, fz in ((0.503, 0.507), (0.9, 0.13), (0.11, 0.9), (0.95, 0.53), (0.03, 0.52)):
            o = Vector((fx * L, -0.01, fz * H))
            d = Vector((0, 1, 0))
            h1 = bvh.ray_cast(o, d)
            h2 = bvh.ray_cast(h1[0] + d * 1e-9, d)[0]
            th.append((h2 - h1[0]).length * abs(h1[1].y) * mm)  # along the face normal
        dims[obj.name] = {
            "width_fold_line_to_free_edge_mm": co[:, 0].max() * mm,
            "height_mm": (co[:, 2].max() - co[:, 2].min()) * mm,
            "z_min_mm": co[:, 2].min() * mm,
            "thickness_mm": {"min": min(th), "max": max(th)},
        }
        d = dims[obj.name]
        expect(abs(d["width_fold_line_to_free_edge_mm"] - 105.0) <= 0.1, f"{obj.name} width")
        expect(abs(d["height_mm"] - 148.0) <= 0.1, f"{obj.name} height")
        expect(abs(d["thickness_mm"]["min"] - 0.4) <= 0.01 and abs(d["thickness_mm"]["max"] - 0.4) <= 0.01,
               f"{obj.name} thickness")
    sco = common.mesh_vertices(spine, world=False)
    sp = topos["Card_Spine"]
    arc_out = sorted({v for f, p in enumerate(sp["polys"]) if sp["part"][f] == PART_ARC_OUT for v in p})
    arc_in = sorted({v for f, p in enumerate(sp["polys"]) if sp["part"][f] == PART_ARC_IN for v in p})
    r_out = np.hypot(sco[arc_out, 0], sco[arc_out, 1])
    r_in = np.hypot(sco[arc_in, 0], sco[arc_in, 1])
    dims["Card_Spine"] = {
        "outer_radius_mm": {"min": r_out.min() * mm, "max": r_out.max() * mm},
        "inner_radius_mm": {"min": r_in.min() * mm, "max": r_in.max() * mm},
        "thickness_mm": (r_out.min() - r_in.max()) * mm,
        "height_mm": (sco[:, 2].max() - sco[:, 2].min()) * mm,
        "skin_ring_error_segments": ctx.info.get("skin_ring_error_segments"),
    }
    expect(abs(r_out.min() - R_OUT) < 1e-7 and abs(r_out.max() - R_OUT) < 1e-7, "spine outer radius")
    expect(abs(r_in.min() - R_IN) < 1e-7 and abs(r_in.max() - R_IN) < 1e-7, "spine inner radius")
    expect(abs(dims["Card_Spine"]["height_mm"] - 148.0) <= 0.1, "spine height")
    res["dimensions"] = dims

    # --- hinge / fold ---------------------------------------------------------------------------
    hz = hinge.matrix_world.to_3x3() @ Vector((0, 0, 1))
    fold = {
        "hinge_axis_vs_card_z_deg": math.degrees(hz.angle(card.matrix_world.to_3x3() @ Vector((0, 0, 1)))),
        "hinge_origin_vs_card_origin_mm": (hinge.matrix_world.translation - card.matrix_world.translation).length * mm,
        "spine_axis_vs_hinge_axis_mm": 0.0 if abs(r_out.max() - r_out.min()) < 1e-7 else None,
        "sign_convention": "Card_Hinge.rotation_euler.z = -radians(openAngle)",
        "spine_bones": f"Spine_kk.rotation_euler.y = kk/{NARC} * Card_Hinge.rotation_euler.z (driver)",
    }
    for obj in (back, front):
        co = common.mesh_vertices(obj, world=False)
        end = co[np.abs(co[:, 0]) < 1e-9]
        ay = np.abs(end[:, 1])
        fold[obj.name] = {"end_ring_x_mm": float(np.abs(end[:, 0]).max() * mm),
                          "end_ring_offset_from_fold_line_mm": [ay.min() * mm, ay.max() * mm]}
        expect(abs(ay.min() - R_IN) < 1e-7 and abs(ay.max() - R_OUT) < 1e-7, f"{obj.name} end ring")
    expect(fold["hinge_axis_vs_card_z_deg"] < 1e-4, "hinge axis tilted")
    res["fold"] = fold

    # --- triangles --------------------------------------------------------------------------------
    tris = {o.name: common.triangle_count(o) for o in objs.values()}
    tris["total"] = sum(tris.values())
    res["triangles"] = tris
    expect(tris["total"] <= 5000, "triangle budget")

    # --- manifold / normals ------------------------------------------------------------------------
    res["topology"] = {o.name: _manifold(o) for o in objs.values()}
    for name, t in res["topology"].items():
        expect(t["non_manifold_edges"] == 0 and t["inconsistent_winding_edges"] == 0
               and t["normals_outward"] and t["degenerate_faces"] == 0
               and t["folded_cap_faces"] == 0, f"{name} topology")

    # --- UVs -----------------------------------------------------------------------------------------
    uvs = {}
    for o in objs.values():
        P, U = _loop_tris(o, "UVMap")
        st = _uv_stats(P, U)
        ref = st["a3"] / (L * H)  # UV area expected at ~panel units
        degenerate = int(((st["a3"] > 1e-12) & (st["auv"] < 0.01 * ref)).sum())
        uvs[o.name] = {"UVMap": _uv_bounds(o, "UVMap"), "UV_AO": _uv_bounds(o, "UV_AO"),
                       "UVMap_degenerate_triangles": degenerate,
                       "layers": [lay.name for lay in o.data.uv_layers]}
        expect(degenerate == 0, f"{o.name} degenerate UVMap triangles (tangent space)")
        b = uvs[o.name]["UV_AO"]["all"]
        expect(min(b[0]) >= 0 and max(b[1]) <= 1, f"{o.name} UV_AO bounds")
        expect(uvs[o.name]["layers"][:2] == ["UVMap", "UV_AO"], f"{o.name} uv layer order")
        for mname in ("M_Print_Front", "M_Print_Inside"):
            bb = uvs[o.name]["UVMap"].get(mname)
            if bb:
                expect(min(bb[0]) >= -1e-6 and max(bb[1]) <= 1 + 1e-6, f"{o.name} {mname} uv bounds")
    ci = uvs["Card_Front"]["UVMap"]["M_Print_Inside"]
    bi = uvs["Card_Back"]["UVMap"]["M_Print_Inside"]
    expect(ci[0][0] >= -1e-6 and ci[1][0] <= 0.5 + 1e-6, "cover inside uv = left half")
    expect(bi[0][0] >= 0.5 - 1e-6 and bi[1][0] <= 1 + 1e-6, "back inside uv = right half")
    # one shared lightmap: no overlap across all card meshes, isotropic, one texel density
    ov, cov = _uv_overlap_pixels(list(objs.values()), "UV_AO")
    ratios, dens, areas = [], [], []
    for o in objs.values():
        P, U = _loop_tris(o, "UV_AO")
        st = _uv_stats(P, U)
        big = st["a3"] > 1e-6  # > 1 mm^2
        ratios.append((st["s1"] / np.maximum(st["s2"], 1e-30))[big])
        dens.append((st["auv"] / np.maximum(st["a3"], 1e-30))[big])
        areas.append(st["a3"][big])
    ratios, dens, areas = np.concatenate(ratios), np.concatenate(dens), np.concatenate(areas)
    uvs["UV_AO_combined"] = {
        "overlap_pixels_1024": ov, "coverage": cov,
        "isotropy_sv_ratio_area_weighted": float((ratios * areas).sum() / areas.sum()),
        "isotropy_sv_ratio_max_big_triangles": float(ratios.max()),
        "texel_density_max_over_min_big_triangles": float(dens.max() / dens.min()),
        "note": "one lightmap for Card_Back + Card_Front + Card_Spine (materials are shared)",
    }
    expect(ov == 0, "UV_AO overlap across card meshes")
    expect(ratios.max() < 1.1, "UV_AO not isotropic")
    expect(dens.max() / dens.min() < 1.1, "UV_AO texel density not uniform")
    # mirror test in the views where each print is read (screen right = +X, up = +Z)
    set_open_angle(ctx, 0.0)
    mirror = {"front_closed": _uv_orientation(front, "UVMap", "M_Print_Front", [0, 2])}
    set_open_angle(ctx, 180.0)
    mirror["inside_left_open180"] = _uv_orientation(front, "UVMap", "M_Print_Inside", [0, 2])
    mirror["inside_right_open180"] = _uv_orientation(back, "UVMap", "M_Print_Inside", [0, 2])
    for k, v in mirror.items():
        expect(v["mirrored"] == 0 and v["u_follows_screen_right"] and v["v_follows_screen_up"],
               f"mirror test {k}")
    uvs["mirror_test"] = mirror
    res["uv"] = uvs

    # --- print reaches the silhouette (no paper rim on the printed sides) ----------------------------
    prints = {}
    for phi, want in ((0, "M_Print_Front"), (180, "M_Print_Inside")):
        set_open_angle(ctx, phi)
        states = {n: _state(o, topos[n]) for n, o in objs.items()}
        prints[f"open_{phi:03d}_seen_from_front"] = r = _visible_print(states, topos, want)
        r["expected"] = want
        expect(r["wrong_material"] == 0 and r["visible_faces"] > 0, f"paper visible on print side at {phi}")
    res["print_coverage"] = prints

    # --- sweep 0..180 deg in 1 deg steps: sectors, z-fighting, seams ----------------------------------
    rest = {n: common.mesh_vertices(o, world=False) for n, o in objs.items()}
    s_rest = rest["Card_Spine"]
    s_th = np.degrees(_angle(s_rest[:, 0], s_rest[:, 1]))
    seam_pairs = {}
    for pname, ring_deg in (("Card_Back", 90.0), ("Card_Front", 270.0)):
        kd = KDTree(len(rest[pname]))
        for i, c in enumerate(rest[pname]):
            kd.insert(c, i)
        kd.balance()
        idx = np.nonzero(np.abs(s_th - ring_deg) < 1e-4)[0]
        pairs = []
        for i in idx:
            _c, j, dist = kd.find(s_rest[i])
            if dist < 2e-6:  # bevel rounding on the arc vs the straight rim: ~1 um
                pairs.append((i, j))
        seam_pairs[pname] = (np.array(pairs), len(idx))
    sweep = {"angles": "0..180 step 1", "same_facing_coincident_faces": 0,
             "worst_same_facing": [], "sector_violation_deg_max": 0.0,
             "seam_gap_mm_max": 0.0,
             "seam_unmatched_spine_vertices": {k: int(v[1] - len(v[0])) for k, v in seam_pairs.items()},
             "hidden_contacts_opposite_facing_max": 0}
    # detector self-test: a sliver lying 0.3 um above a same-facing sliver must be flagged
    sq = [(0, 0, 0), (0.148, 0, 0), (0.148, 5e-5, 0), (0, 5e-5, 0)]
    probe = {"fc": np.array([[0.074, 2.5e-5, 3e-7]]), "fn": np.array([[0.0, 0.0, 1.0]]),
             "width": np.array([5e-5]), "part": np.array([PART_ARC_OUT])}
    selftest = _coincident(probe, BVHTree.FromPolygons(sq, [(0, 1, 2, 3)]))
    sweep["detector_self_test_same_facing"] = selftest[0]
    expect(selftest == (1, 0), "z-fighting detector self-test")
    pairs_ab = (("Card_Back", "Card_Front"), ("Card_Back", "Card_Spine"), ("Card_Front", "Card_Spine"))
    for phi in range(0, 181):
        set_open_angle(ctx, phi)
        states = {n: _state(o, topos[n]) for n, o in objs.items()}
        bvhs = {n: _bvh(s) for n, s in states.items()}
        viol = max(_sector_violation(states["Card_Back"]["co"], 45.0, 45.0),
                   _sector_violation(states["Card_Front"]["co"], 315.0 - phi, 45.0),
                   _sector_violation(states["Card_Spine"]["co"], 180.0 - phi / 2, 90.0 - phi / 2))
        sweep["sector_violation_deg_max"] = max(sweep["sector_violation_deg_max"], viol)
        same_total = opp_total = 0
        for a_, b_ in pairs_ab:
            for x_, y_ in ((a_, b_), (b_, a_)):
                s, o = _coincident(states[x_], bvhs[y_])
                same_total += s
                opp_total += o
        if same_total:
            sweep["worst_same_facing"].append([phi, same_total])
        sweep["same_facing_coincident_faces"] += same_total
        sweep["hidden_contacts_opposite_facing_max"] = max(sweep["hidden_contacts_opposite_facing_max"], opp_total)
        for pname, (pairs, _n) in seam_pairs.items():
            if len(pairs):
                gap = np.linalg.norm(states["Card_Spine"]["co"][pairs[:, 0]] - states[pname]["co"][pairs[:, 1]], axis=1).max()
                sweep["seam_gap_mm_max"] = max(sweep["seam_gap_mm_max"], float(gap) * mm)
    sweep["worst_same_facing"] = sweep["worst_same_facing"][:10]
    sweep["method"] = ("sectors: every vertex of Card_Back within [0,90] deg about the fold line, "
                       "Card_Spine within [90, 270-phi], Card_Front within [270-phi, 360-phi]; the "
                       "sectors are convex and disjoint, so the solids cannot interpenetrate. "
                       "z-fighting: face centres within 1 um of another mesh's face (projecting "
                       "inside it) with the same facing (dot > 0.999).")
    expect(sweep["same_facing_coincident_faces"] == 0, "z-fighting (same-facing coincident faces)")
    expect(sweep["sector_violation_deg_max"] <= 1e-4, "panels/spine leave their sectors (interpenetration)")
    expect(sweep["seam_gap_mm_max"] <= 2e-3, "gap between spine and panels")  # hidden joint, bevel rounding
    expect(all(v == 0 for v in sweep["seam_unmatched_spine_vertices"].values()), "spine end ring unmatched")
    res["sweep"] = sweep

    # --- per check angle: distances, spine coverage, shape ---------------------------------------------
    overlap = {}
    for phi in CHECK_ANGLES:
        set_open_angle(ctx, phi)
        states = {n: _state(o, topos[n]) for n, o in objs.items()}
        bb, bf, bs = (_bvh(states[n]) for n in MESHES)
        entry = {}
        # min distance between the two panels away from the fold zone
        min_d = math.inf
        for src, other in ((states["Card_Front"]["co"], bb), (states["Card_Back"]["co"], bf)):
            far = src[np.hypot(src[:, 0], src[:, 1]) > R_OUT + 1e-4]
            for p in far[::2]:
                min_d = min(min_d, other.find_nearest(Vector(p))[3])
        entry["min_distance_cover_back_mm"] = min_d * mm
        # the round spine: every arc ring sits on its circle at its expected angle, rings evenly
        # spread from the back's end (90 deg) to the cover's end (270 - phi), so the ruled strip
        # covers the whole bend with no gap (deviation = chord sag only)
        sc = states["Card_Spine"]["co"]
        ring_sel = np.isin(np.arange(len(sc)), arc_out + arc_in)
        k = np.round((s_th - 90.0) / 180.0 * NARC)
        want = 90.0 + (180.0 - phi) * k / NARC
        got = np.degrees(_angle(sc[:, 0], sc[:, 1]))
        err_ang = np.abs((got - want + 180.0) % 360.0 - 180.0)[ring_sel].max()
        r_now = np.hypot(sc[ring_sel, 0], sc[ring_sel, 1])
        r_err = np.minimum(np.abs(r_now - R_OUT), np.abs(r_now - R_IN)).max()
        entry["spine_ring_angle_error_deg"] = float(err_ang)
        entry["spine_ring_radius_error_mm"] = float(r_err) * mm
        entry["spine_arc_deg"] = [90.0, 270.0 - phi]
        entry["spine_chord_sag_outer_mm"] = R_OUT * (1 - math.cos(math.radians((180 - phi) / NARC / 2))) * mm
        expect(err_ang < 1e-3 and r_err < 1e-8, f"spine bend off at {phi}")
        if phi == 0:
            expect(min_d <= 1e-6, "closed card: cover does not touch the back")
            gaps = {}
            for xm in (0.0005, 0.003, EASE, L / 2, L - 0.0005):
                yb = _ray_y(bb, xm, H / 2, 0.0, 1.0)
                yf = _ray_y(bf, xm, H / 2, 0.0, -1.0)
                gaps[f"x_{xm * mm:.1f}mm"] = None if yb is None or yf is None else (yb - yf) * mm
            entry["closed_gap_between_inner_faces_mm_at_mid_height"] = gaps
        else:
            expect(min_d > 0, f"touching at {phi}")
        if phi == 180:
            prof = {}
            for xm in (-0.1, -0.03, -0.006, -0.003, 0.0, 0.003, 0.006, 0.03, 0.1):
                ys = [y for y in (_ray_y(t, xm, H / 2, -0.01, 1.0) for t in (bb, bf, bs)) if y is not None]
                prof[f"x_{xm * mm:+.0f}mm"] = min(ys) * mm if ys else None
            entry["inner_surface_y_mm_at_mid_height (crease valley, +y = away from viewer)"] = prof
            allx = np.concatenate([states[n]["co"][:, 0] for n in MESHES])
            entry["flat_sheet_span_x_mm"] = [allx.min() * mm, allx.max() * mm]
        fe = states["Card_Front"]["co"]
        tip = fe[np.argmax(rest["Card_Front"][:, 0])]
        entry["cover_free_edge_xy_mm"] = [tip[0] * mm, tip[1] * mm]
        overlap[str(phi)] = entry
    res["angles"] = overlap

    # --- spine normals ------------------------------------------------------------------------------------
    # Exported (bind-pose) normals must be exactly radial on the arcs: glTF skinning then rotates
    # each ring's normals rigidly with its bone, so they stay exact at every angle in three.js.
    # Blender's own deformed preview re-derives custom normals from the compressed faces, which
    # leaves up to half a ring step of error; that is reported, not failed.
    set_open_angle(ctx, 0.0)
    cn0 = np.zeros(len(spine.data.loops) * 3)
    spine.data.corner_normals.foreach_get("vector", cn0)
    cn0 = cn0.reshape(-1, 3)
    sel0 = np.isin(sp["part"][sp["loop_face"]], (PART_ARC_OUT, PART_ARC_IN))
    rv0 = sco[sp["lv"][sel0]].copy()
    rv0[:, 2] = 0
    sgn0 = np.where(sp["part"][sp["loop_face"]][sel0] == PART_ARC_OUT, 1.0, -1.0)[:, None]
    err0 = np.degrees(np.arccos(np.clip((_unit(rv0) * sgn0 * cn0[sel0]).sum(1), -1, 1))).max()
    res["spine_bind_pose_normals_max_error_deg"] = float(err0)
    expect(err0 < 0.1, "spine bind-pose normals not radial")  # int16 custom-normal encoding
    set_open_angle(ctx, 90.0)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = spine.evaluated_get(dg)
    me = ev.to_mesh()
    try:
        cn = np.zeros(len(me.loops) * 3)
        me.corner_normals.foreach_get("vector", cn)
        cn = cn.reshape(-1, 3)
        eco = np.zeros(len(me.vertices) * 3)
        me.vertices.foreach_get("co", eco)
        eco = eco.reshape(-1, 3)
        sel = sp["part"][sp["loop_face"]] == PART_ARC_OUT
        rv = eco[sp["lv"][sel]].copy()
        rv[:, 2] = 0
        err = np.degrees(np.arccos(np.clip((_unit(rv) * cn[sel]).sum(1), -1, 1))).max()
        res["spine_blender_preview_normals_at_90deg_max_error_deg"] = float(err)
    finally:
        ev.to_mesh_clear()

    # --- ground contact at 30 deg ---------------------------------------------------------------------
    set_open_angle(ctx, 30.0)
    ground = {"placement": "Card empty at the world origin, identity rotation: the fold line is "
                           "vertical and every part stands on its bottom cut edge (z = 0) at any "
                           "opening angle, so no extra placement is needed for the tent pose."}
    for o in objs.values():
        w = common.evaluated_vertices(o, world=True)
        low = w[w[:, 2] < 0.0002]
        r_axis = np.hypot(low[:, 0], low[:, 1])
        ground[o.name] = {"z_min_mm": w[:, 2].min() * mm,
                          "bottom_edge_touching_from_mm": r_axis.min() * mm,
                          "bottom_edge_touching_to_mm": r_axis.max() * mm}
        expect(abs(w[:, 2].min()) <= 0.0002, f"{o.name} not on ground")
        if o is not spine:
            expect(r_axis.max() >= L - 0.001, f"{o.name} bottom edge lifts")
    res["ground_contact_30deg"] = ground

    # --- materials ------------------------------------------------------------------------------------
    mres = {}
    for name, m in ctx.materials.items():
        bsdf = common.find_node(m.node_tree, "BSDF_PRINCIPLED")
        vals = {k: common.socket(bsdf.inputs, k).default_value for k in
                ("Metallic", "Roughness", "Specular IOR Level", "Sheen Weight", "Coat Weight",
                 "Transmission Weight")}
        extra = common.assert_principled_only(m)
        mres[name] = {"inputs": vals, "unsupported_nodes": extra, "users": m.users}
        expect(not extra and vals["Metallic"] == 0 and vals["Sheen Weight"] == 0
               and vals["Coat Weight"] == 0 and vals["Transmission Weight"] == 0, f"material {name}")
    res["materials"] = mres
    res["paper_normal_map"] = ctx.info.get("paper_normal")

    set_open_angle(ctx, 0.0)
    res["passed"] = not fails
    res["failures"] = fails
    common.write_json(os.path.join(ctx.stage_renders("card"), "checks.json"), rnd(res, 6))
    for f in fails:
        log(f"CHECK FAILED: {f}")
    log(f"checks {'passed' if not fails else 'FAILED'}")
    return not fails


# ---------------------------------------------------------------------------------------------
# Check renders
# ---------------------------------------------------------------------------------------------

def _box(center, half) -> np.ndarray:
    c = np.array(center)
    return np.array([c + np.array([sx, sy, sz]) * half
                     for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])


def _spine_box(phi: float, half: float = 0.003) -> np.ndarray:
    c = math.radians(180.0 - phi / 2)
    return _box((R_OUT * math.cos(c), R_OUT * math.sin(c), H - 0.0016), half)


def _tint(ctx: Ctx, on: bool, store: dict) -> None:
    """Diagnostic colours per mesh (cover red, back blue, spine green) for the spine macros."""
    colours = {"Card_Front": "#d62828", "Card_Back": "#1d4ed8", "Card_Spine": "#16a34a"}
    for name, hexc in colours.items():
        me = ctx.objects[name].data
        if on:
            store[name] = [m for m in me.materials]
            mat = bpy.data.materials.get(f"M_Tint_{name}") or common.principled_material(
                f"M_Tint_{name}", base_color=common.hex_to_linear(hexc), roughness=0.6)
            for i in range(len(me.materials)):
                me.materials[i] = mat
        else:
            for i, m in enumerate(store[name]):
                me.materials[i] = m


def render_card(ctx: Ctx) -> None:
    out = ctx.stage_renders("card")
    for old in glob.glob(os.path.join(out, "*.png")):
        os.remove(old)  # only this stage's own previous check renders
    scene = ctx.scene
    common.setup_eevee(scene, 1024, 64)
    common.build_studio(ctx, Vector((0.0, 0.0, H * 0.45)))
    coll = common.collection("CheckStudio")
    card = ctx.objects["Card"]

    def card_points():
        return np.concatenate([common.evaluated_vertices(ctx.objects[n]) for n in MESHES])[::3]

    shots = [
        # name, angle, az, el, lens, points (None = whole card), margin, mode
        ("closed_front", 0, 0, 6, 45, None, 0.86, None),
        ("closed_34", 0, 38, 18, 45, None, 0.86, None),
        ("open_030", 30, 35, 16, 45, None, 0.86, None),
        ("open_090", 90, 30, 16, 45, None, 0.86, None),
        ("open_150", 150, 0, 14, 45, None, 0.86, None),
        ("open_180_top", 180, 0, 90, 45, None, 0.9, "flat"),
        ("open_180_front", 180, 12, 22, 45, None, 0.9, None),
        ("fold_closeup", 150, -8, 34, 100, _box((0.0, -0.0005, H - 0.0018), 0.0032), 1.0, None),
        ("edge_closeup", 0, 42, 30, 100, _box((L - 0.0012, -0.0009, H - 0.0012), 0.0024), 1.0, None),
        ("fold_closeup_000", 0, -60, 34, 100, _box((-0.0006, 0.0, H - 0.0010), 0.0025), 1.0, None),
        ("fold_outer_090", 90, -140, 26, 100, _box((-0.0006, 0.0006, H - 0.0018), 0.003), 1.0, None),
        ("crease_inner_180", 180, 0, 40, 100, _box((0.0, 0.0003, H - 0.004), 0.005), 1.0, None),
        ("spine_tint_030", 30, -105, 22, 100, _spine_box(30), 1.0, "tint"),
        ("spine_tint_090", 90, -135, 22, 100, _spine_box(90), 1.0, "tint"),
        ("spine_tint_150", 150, -165, 22, 100, _spine_box(150), 1.0, "tint"),
    ]
    items = []
    store: dict = {}
    for name, phi, az, el, lens, pts, margin, mode in shots:
        set_open_angle(ctx, phi)
        if mode == "flat":  # lay the open card on the floor, printed side up, lowest point z=0
            card.rotation_euler = (-math.pi / 2, 0.0, 0.0)
            card.location = (0.0, 0.0, 0.0)
            bpy.context.view_layer.update()
            card.location.z = -float(card_points()[:, 2].min())
            bpy.context.view_layer.update()
        if mode == "tint":
            _tint(ctx, True, store)
        common.face_studio(az)
        cam = common.new_camera(f"Cam_{name}", coll, lens)
        common.fit_camera(cam, card_points() if pts is None else pts, az, el, margin)
        path = os.path.join(out, f"{name}.png")
        common.render_still(scene, cam, path)
        items.append((name, path))
        if mode == "tint":
            _tint(ctx, False, store)
        if mode == "flat":
            card.rotation_euler = (0.0, 0.0, 0.0)
            card.location = (0.0, 0.0, 0.0)
    set_open_angle(ctx, 0.0)
    common.contact_sheet(items, os.path.join(out, "contact.png"), cols=4, tile=512,
                         legend_path=os.path.join(out, "contact.json"))
