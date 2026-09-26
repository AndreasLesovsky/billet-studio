"""H4 - export of the story GLB (docs/hero-story.md). Runs after the story build (hero.blend is
already saved) and changes the scene in memory only:

1. scene['heroStory'] (JSON string) from the timeline markers (build_story.story_meta).
2. Visual keys: every constraint of an exported object and every driver (the spine bones follow
   Card_Hinge through drivers) are sampled per frame into keys, then removed - the glTF exporter
   drops constraints and drivers.
3. The preview collection (render camera, lights, heart stand-in) is deleted; the materials get
   their export form: card materials without the Fx_CardFade driver (alpha 1), shadow materials
   with the baked texture alpha linked directly (BLEND), Phone_Screen back on the plain M_Screen,
   16 x 16 placeholders in the slots the runtime replaces (M_Print_Front, M_Print_Inside,
   M_Screen).
4. glTF export of what is left (the export set) to export/hero-story.glb: one merged clip named
   after the scene ('Story', SCENE animation mode), extras on, cameras / lights off, pointer
   animation off, forced sampling of every frame, skin + armature kept, no Draco.
5. Read-back of the GLB JSON: required nodes, one clip 'Story' of the right duration, extras,
   node names, skin, UVs, no KHR_materials_*, the landing (GiftSlot == dock at the last key).
"""

from __future__ import annotations

import json
import math
import os
import re
import struct

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

import build_card
import build_phone
import build_story
import common
from common import Ctx, log, rnd

EXPORT_PATH = os.path.join(common.EXPORT_DIR, "hero-story.glb")
REQUIRED_NODES = ("Cam", "CamTarget", "Card", "Card_Back", "Card_Front", "Card_Spine",
                  "Card_Hinge", "Card_Rig", "GiftSlot", "Phone", "Phone_Body", "Phone_Screen",
                  "Phone_ScreenDock", "Fx_Wake", "Fx_Notif", "Fx_Billet", "Fx_CardFade")
PLACEHOLDER_MATS = ("M_Print_Front", "M_Print_Inside", build_phone.SCREEN_MAT)
NAME_OK = re.compile(r"^[A-Za-z0-9_]+$")


# ---------------------------------------------------------------------------------------------
# Baking
# ---------------------------------------------------------------------------------------------

def _all_drivers():
    """(owner ID, driver F-curve) for every driver in the file."""
    owners = list(bpy.data.objects) + list(bpy.data.armatures) + list(bpy.data.meshes)
    owners += [m.node_tree for m in bpy.data.materials if m.node_tree is not None]
    owners += list(bpy.data.materials)
    for owner in owners:
        ad = getattr(owner, "animation_data", None)
        if ad is None:
            continue
        for fc in list(ad.drivers):
            yield owner, fc


def _bake_bones(ctx: Ctx, frames: np.ndarray) -> dict:
    """Spine bones: their driven rotations sampled per frame (evaluated pose) into keys."""
    rig = ctx.objects["Card_Rig"]
    names = [pb.name for pb in rig.pose.bones]
    vals = {n: [] for n in names}
    dg = bpy.context.evaluated_depsgraph_get()
    for f in frames:
        ctx.scene.frame_set(int(f))
        ev = rig.evaluated_get(dg)
        for n in names:
            vals[n].append(tuple(ev.pose.bones[n].rotation_euler))
    ad = rig.animation_data
    removed = 0
    if ad is not None:
        for fc in list(ad.drivers):
            ad.drivers.remove(fc)
            removed += 1
    for n in names:
        arr = np.array(vals[n])
        pb = rig.pose.bones[n]
        pb.rotation_mode = "XYZ"
        for i in range(3):
            common.key_channel(rig, f'pose.bones["{n}"].rotation_euler', i, frames, arr[:, i], group=n)
    # the bake reproduces the drivers: bone kk turns by kk/16 of the hinge angle
    ctx.scene.frame_set(int(frames[len(frames) // 3]))
    hinge = ctx.objects["Card_Hinge"].rotation_euler.z
    err = max(abs(rig.pose.bones[n].rotation_euler.y - hinge * int(n[-2:]) / build_card.NARC)
              for n in names)
    return {"bones": len(names), "drivers_removed": removed, "driver_vs_keys_max_rad": err}


def _bake_constraints(ctx: Ctx, objs, frames: np.ndarray) -> list[str]:
    """Exported objects with constraints: world matrices sampled per frame -> local keys."""
    baked = []
    for o in objs:
        if not o.constraints:
            continue
        mats = []
        for f in frames:
            ctx.scene.frame_set(int(f))
            mats.append(o.matrix_world.copy())
        for c in list(o.constraints):
            o.constraints.remove(c)
        parent_inv = []
        for f, mw in zip(frames, mats):
            ctx.scene.frame_set(int(f))
            pm = o.parent.matrix_world if o.parent else Matrix.Identity(4)
            parent_inv.append((pm @ o.matrix_parent_inverse).inverted() @ mw)
        locs, quats, scales = [], [], []
        for m in parent_inv:
            loc, q, s = m.decompose()
            locs.append(loc[:])
            quats.append(q[:])
            scales.append(s[:])
        common.key_transform(o, frames, np.array(locs), np.array(quats), np.array(scales))
        baked.append(o.name)
    return baked


# ---------------------------------------------------------------------------------------------
# Scene clean-up and materials
# ---------------------------------------------------------------------------------------------

def _delete_collection(name: str) -> list[str]:
    coll = bpy.data.collections.get(name)
    if coll is None:
        return []
    gone = []
    for o in list(coll.all_objects):
        gone.append(o.name)
        bpy.data.objects.remove(o, do_unlink=True)
    for child in list(coll.children_recursive):
        bpy.data.collections.remove(child)
    bpy.data.collections.remove(coll)
    return gone


def _placeholder(name: str, rgba) -> bpy.types.Image:
    img = bpy.data.images.get(name) or bpy.data.images.new(name, 16, 16, alpha=False)
    img.generated_color = rgba
    return img


def _export_materials(ctx: Ctx) -> dict:
    out = {}
    # card: no fade driver, opaque
    for name in build_card.MAT_NAMES:
        mat = ctx.materials[name]
        bsdf = common.find_node(mat.node_tree, "BSDF_PRINCIPLED")
        common.socket(bsdf.inputs, "Alpha").default_value = 1.0
        try:
            mat.surface_render_method = "DITHERED"
        except (AttributeError, TypeError):
            pass
    # prints -> 16 x 16 placeholders (the runtime sets the maps per language)
    paper = common.hex_to_linear(build_card.PAPER_HEX)
    for name in ("M_Print_Front", "M_Print_Inside"):
        tree = ctx.materials[name].node_tree
        tex = next(n for n in tree.nodes if n.type == "TEX_IMAGE" and n.image is not None
                   and "normal" not in n.image.name)
        tex.image = _placeholder(f"placeholder_{name}", paper)
        out[name] = tex.image.name
    # shadows: texture alpha straight into the BSDF
    for name in build_story.SHADOWS:
        mat = bpy.data.materials[f"M_Shadow_{name}"]
        tree = mat.node_tree
        fade = tree.nodes.get("FxFade")
        tex = tree.nodes.get("ShadowImage")
        bsdf = common.find_node(tree, "BSDF_PRINCIPLED")
        if fade is not None:
            tree.nodes.remove(fade)
        tree.links.new(common.socket(tex.outputs, "Alpha"), common.socket(bsdf.inputs, "Alpha"))
        try:
            mat.surface_render_method = "BLENDED"
        except (AttributeError, TypeError):
            pass
        out[mat.name] = tex.image.name
    # screen: the plain placeholder material, 16 x 16 black
    screen = ctx.objects["Phone_Screen"]
    mat = ctx.materials[build_phone.SCREEN_MAT]
    screen.data.materials[0] = mat
    tex = next(n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE")
    tex.image = _placeholder("placeholder_M_Screen", (0.0, 0.0, 0.0, 1.0))
    out[mat.name] = tex.image.name
    return out


# ---------------------------------------------------------------------------------------------
# Export + read-back
# ---------------------------------------------------------------------------------------------

def _gltf_export(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kwargs = dict(
        filepath=path, export_format="GLB",
        use_selection=False, use_visible=False, use_renderable=False, use_active_collection=False,
        export_extras=True, export_yup=True, export_apply=False,
        export_cameras=False, export_lights=False,
        export_animations=True, export_animation_mode="SCENE", export_anim_scene_split_object=False,
        export_force_sampling=True, export_frame_range=True, export_frame_step=1,
        export_pointer_animation=False, export_bake_animation=False,
        export_optimize_animation_size=False, export_anim_slide_to_zero=False,
        export_skins=True, export_def_bones=False, export_leaf_bone=False,
        export_rest_position_armature=True, export_armature_object_remove=False,
        export_hierarchy_flatten_bones=False, export_hierarchy_flatten_objs=False,
        export_draco_mesh_compression_enable=False, export_materials="EXPORT",
        export_image_format="AUTO", export_texcoords=True, export_normals=True,
        export_tangents=False, export_attributes=False, export_morph=False,
        # static transforms at the current frame (_export_frame), not at frame 0
        export_current_frame=True,
    )
    props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    missing = sorted(set(kwargs) - props)
    if missing:
        raise RuntimeError(f"glTF exporter options not available: {missing}")
    bpy.ops.export_scene.gltf(**kwargs)


def _read_glb(path: str):
    with open(path, "rb") as fh:
        data = fh.read()
    clen = struct.unpack("<I", data[12:16])[0]
    js = json.loads(data[20:20 + clen])
    bin_chunk = data[20 + clen + 8:]
    return data, js, bin_chunk


def _floats(js: dict, bin_chunk: bytes, idx: int) -> np.ndarray:
    a = js["accessors"][idx]
    k = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    if a["componentType"] != 5126:
        raise ValueError("expected FLOAT accessor")
    bv = js["bufferViews"][a["bufferView"]]
    stride = bv.get("byteStride", 4 * k)
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = a["count"]
    raw = np.frombuffer(bin_chunk, dtype=np.uint8, count=stride * (n - 1) + 4 * k, offset=off)
    return np.lib.stride_tricks.as_strided(raw, shape=(n, 4 * k), strides=(stride, 1)).copy() \
        .view("<f4").reshape(n, k).astype(np.float64)


def _trs(node: dict, anim: dict, t_index: int = -1) -> Matrix:
    """A node's local matrix with its animated channels at their last (or given) key."""
    t = Vector(anim.get("translation", node.get("translation", [0, 0, 0])))
    x, y, z, w = anim.get("rotation", node.get("rotation", [0, 0, 0, 1]))
    s = Vector(anim.get("scale", node.get("scale", [1, 1, 1])))
    return Matrix.LocRotScale(t, Quaternion((w, x, y, z)), s)


def read_back(path: str, meta: dict) -> dict:
    data, js, bin_chunk = _read_glb(path)
    fails: list[str] = []
    res: dict = {"file": path, "bytes": len(data)}

    def expect(cond, msg):
        if not cond:
            fails.append(msg)

    nodes = js.get("nodes", [])
    names = [n.get("name", "") for n in nodes]
    res["nodes"] = len(nodes)
    for n in REQUIRED_NODES:
        expect(n in names, f"node {n} missing")
    shadows = [n for n in names if n.startswith("Shadow_")]
    fx = [n for n in names if n.startswith("Fx_")]
    res["shadow_nodes"], res["fx_nodes"] = shadows, fx
    res["shadows_without_fx (always full strength)"] = [s for s in shadows if f"Fx_{s}" not in names]
    bad = [n for n in names if not NAME_OK.match(n)]
    expect(not bad, f"node names outside [A-Za-z0-9_]: {bad}")
    preview = [n for n in names if n.startswith(("HeartPreview", "RenderCam", "Story_", "Check"))]
    expect(not preview, f"preview objects exported: {preview}")
    expect(len(names) == len(set(names)), "duplicate node names")
    expect("cameras" not in js and "KHR_lights_punctual" not in json.dumps(js.get("extensionsUsed", [])),
           "cameras or lights exported")

    anims = js.get("animations", [])
    res["animations"] = [a.get("name") for a in anims]
    expect(len(anims) == 1 and anims[0].get("name") == meta["clip"], "exactly one clip named Story")
    t_max = 0.0
    last: dict = {}
    if anims:
        a = anims[0]
        for ch in a["channels"]:
            smp = a["samplers"][ch["sampler"]]
            inp = _floats(js, bin_chunk, smp["input"])
            t_max = max(t_max, float(inp.max()))
            out = _floats(js, bin_chunk, smp["output"])
            last.setdefault(ch["target"]["node"], {})[ch["target"]["path"]] = out[-1].tolist()
        res["channels"] = len(a["channels"])
    res["clip_duration"] = t_max
    expect(abs(t_max - meta["duration"]) < 1e-3, f"clip duration {t_max} != {meta['duration']}")

    extras = (js.get("scenes", [{}])[js.get("scene", 0)].get("extras") or {})
    raw = extras.get("heroStory")
    expect(isinstance(raw, str), "scene extras.heroStory is not a JSON string")
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else None
    except ValueError:
        parsed = None
    expect(parsed == meta, "heroStory extras differ from the markers")
    res["heroStory"] = parsed

    ext = js.get("extensionsUsed", [])
    res["extensionsUsed"] = ext
    expect(not [e for e in ext if e.startswith("KHR_materials_")], f"KHR_materials_* used: {ext}")
    mats = {m.get("name"): m for m in js.get("materials", [])}
    res["materials"] = sorted(mats)
    for m in PLACEHOLDER_MATS:
        expect(m in mats, f"material {m} missing")
    for s in shadows:
        expect(f"M_{s}" in mats, f"material M_{s} missing")

    # meshes: UVs, skin
    meshes = js.get("meshes", [])
    node_mesh = {n.get("name"): meshes[n["mesh"]] for n in nodes if "mesh" in n}
    uv = {}
    for name, mesh in node_mesh.items():
        attrs = set()
        for p in mesh["primitives"]:
            attrs |= set(p["attributes"])
        uv[name] = sorted(a for a in attrs if a.startswith("TEXCOORD"))
    res["texcoords"] = uv
    for name in ("Card_Back", "Card_Front", "Card_Spine", "Phone_Screen") + tuple(shadows):
        expect("TEXCOORD_0" in uv.get(name, []), f"{name} without TEXCOORD_0")
    expect("TEXCOORD_1" in uv.get("Phone_Body", []), "Phone_Body without TEXCOORD_1")
    skins = js.get("skins", [])
    spine = next((n for n in nodes if n.get("name") == "Card_Spine"), {})
    joints = [nodes[j]["name"] for j in skins[spine["skin"]]["joints"]] if "skin" in spine else []
    res["skin_joints"] = joints
    expect(joints == [f"Spine_{k:02d}" for k in range(build_card.NARC + 1)], "Card_Spine skin")

    # the landing, from the glTF data itself: GiftSlot's world matrix at the last key equals the
    # dock's (Phone at its last key x the dock's static local matrix)
    idx = {n.get("name"): i for i, n in enumerate(nodes)}
    parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}

    def world(i):
        m = _trs(nodes[i], last.get(i, {}))
        while i in parent:
            i = parent[i]
            m = _trs(nodes[i], last.get(i, {})) @ m
        return m

    ws, wd = world(idx["GiftSlot"]), world(idx["Phone_ScreenDock"])
    ls, qs, ss = ws.decompose()
    ld, qd, sd = wd.decompose()
    res["landing_at_last_key"] = {"pos_mm": (ls - ld).length * 1000,
                                  "rot_deg": math.degrees(qs.rotation_difference(qd).angle),
                                  "scale_rel": abs(ss.x / sd.x - 1)}
    expect(res["landing_at_last_key"]["pos_mm"] < 0.002 and res["landing_at_last_key"]["rot_deg"] < 0.001
           and res["landing_at_last_key"]["scale_rel"] < 1e-5,
           "GiftSlot != Phone_ScreenDock at the end of the clip")
    # the phone's static children must sit exactly where Blender has them (float32 only)
    body = nodes[idx["Phone_Body"]]
    res["phone_body_local_translation"] = body.get("translation", [0, 0, 0])
    expect(max(abs(v) for v in res["phone_body_local_translation"]) < 1e-6,
           "Phone_Body's static transform lost precision")
    dock = nodes[idx["Phone_ScreenDock"]]
    expect({"sceneRectDe", "sceneRectEn", "screenWidthM", "screenHeightM", "dockScale"}
           <= set((dock.get("extras") or {}).keys()), "Phone_ScreenDock extras")
    res["passed"] = not fails
    res["failures"] = fails
    return res


def _export_frame(ctx: Ctx, frames: np.ndarray) -> int:
    """The frame the exporter reads the static transforms at. It derives a child's local matrix
    from its parent's world matrix at the current frame, so every exported parent (Card, Phone)
    must have unit scale there: at frame 0 the hidden phone is scaled to 0.00036, which costs the
    phone's children tens of microns."""
    best, best_err = int(frames[0]), math.inf
    for f in frames:
        ctx.scene.frame_set(int(f))
        err = sum(abs(ctx.objects[n].matrix_world.to_scale().x - 1.0) for n in ("Card", "Phone"))
        if err < best_err - 1e-9:
            best, best_err = int(f), err
    return best


def export_story(ctx: Ctx) -> dict:
    scene = ctx.scene
    frames = np.arange(scene.frame_start, scene.frame_end + 1)
    meta = build_story.story_meta(scene)
    scene["heroStory"] = json.dumps(meta)
    res: dict = {"heroStory": meta}

    res["deleted_preview_objects"] = _delete_collection(build_story.PREVIEW_COLL)
    res["deleted_check_objects"] = _delete_collection("CheckStudio")
    exported = [o for o in scene.objects]
    res["bones"] = _bake_bones(ctx, frames)
    res["constraints_baked"] = _bake_constraints(ctx, exported, frames)
    drivers = 0
    for owner, fc in list(_all_drivers()):
        owner.animation_data.drivers.remove(fc)
        drivers += 1
    res["drivers_removed"] = drivers
    res["materials"] = _export_materials(ctx)
    res["static_transforms_frame"] = _export_frame(ctx, frames)
    scene.frame_set(res["static_transforms_frame"])
    left = sorted(o.name for o in scene.objects)
    res["export_set"] = left

    _gltf_export(EXPORT_PATH)
    log(f"exported {EXPORT_PATH}")
    rb = read_back(EXPORT_PATH, meta)
    res["read_back"] = rb
    fails = list(rb["failures"])
    if res["bones"]["driver_vs_keys_max_rad"] > 1e-5:
        fails.append("spine bone keys differ from the drivers")
    res["passed"] = not fails
    res["failures"] = fails
    for f in fails:
        log(f"CHECK FAILED: {f}")
    log(f"export {'ok' if not fails else 'FAILED'}: {rb['bytes'] / 1024:.0f} KB, "
        f"{rb.get('channels', 0)} channels, clip {rb.get('clip_duration')} s")
    return rnd(res, 6)
