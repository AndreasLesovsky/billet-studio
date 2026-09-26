"""H4 - Cycles bakes of the story: soft contact shadows on the invisible ground.

For every patch Shadow_<Name> (build_story.SHADOWS) the scene is posed at the patch's ref_t,
only its casters stay renderable and Cycles bakes ambient occlusion onto the patch (GPU: OPTIX ->
CUDA -> CPU, like the phone's AO). The AO distance sets the softness: short for the standing
card (a contact line with a soft falloff), longer for the hovering phone (a soft blob).

    alpha = opacity * clamp(gain * (1 - AO)) ^ gamma * border fade        RGB = black

-> images/shadow_<name>.png (RGBA, straight alpha). The runtime multiplies the patch's opacity by
Fx_Shadow_<Name>; the border fade guarantees that no patch edge is ever visible.
The card's AO (its occlusion changes while it opens) is not baked: the paper stays clean.
"""

from __future__ import annotations

import os

import bpy
import numpy as np

import build_story
import common
from common import Ctx, log

SAMPLES = 384
BORDER = 0.14            # fraction of the patch over which alpha fades to 0 at its edges
CASTERS = {
    "card": build_story.CARD_MESHES,
    "phone": build_story.PHONE_MESHES,
}


def _bake_patch(ctx: Ctx, name: str, spec: dict) -> dict:
    scene = ctx.scene
    patch = ctx.objects[f"Shadow_{name}"]
    casters = [ctx.objects[n] for n in CASTERS[spec["follows"]]]
    scene.frame_set(int(round(spec["ref_t"] * build_story.FPS)))
    bpy.context.view_layer.update()

    world = scene.world
    world.light_settings.distance = spec["ao"]
    w_px, h_px = spec["res"]
    img = bpy.data.images.new(f"bake_shadow_{name}", w_px, h_px, alpha=False, float_buffer=True)
    try:
        img.colorspace_settings.name = "Non-Color"
    except TypeError:
        img.colorspace_settings.is_data = True

    # a temporary opaque bake material on the patch (its own material is transparent)
    me = patch.data
    saved_mats = list(me.materials)
    bake_mat, tree, _bsdf = common.new_material(f"M_Bake_{name}")
    tex = tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    for n in tree.nodes:
        n.select = False
    tex.select = True
    tree.nodes.active = tex
    me.materials.clear()
    me.materials.append(bake_mat)

    hidden = []
    for o in scene.objects:
        if o.type == "MESH" and o is not patch and o not in casters and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    patch.select_set(True)
    vl.objects.active = patch
    try:
        bpy.ops.object.bake(type="AO", margin=4, use_clear=True)
    finally:
        for o in hidden:
            o.hide_render = False
        patch.select_set(False)
        me.materials.clear()
        for m in saved_mats:
            me.materials.append(m)
        bpy.data.materials.remove(bake_mat)

    ao = common.image_to_numpy(img)[:, :, 0].astype(np.float64)   # rows bottom-up = v up
    bpy.data.images.remove(img)
    occ = np.clip(spec["gain"] * (1.0 - ao), 0.0, 1.0) ** spec["gamma"]
    v = (np.arange(h_px) + 0.5) / h_px
    u = (np.arange(w_px) + 0.5) / w_px
    fade = (build_story.smoothstep_arr(np.minimum(u, 1 - u) / BORDER)[None, :]
            * build_story.smoothstep_arr(np.minimum(v, 1 - v) / BORDER)[:, None])
    alpha = spec["opacity"] * occ * fade
    rgba = np.zeros((h_px, w_px, 4), dtype=np.float32)
    rgba[..., 3] = alpha
    path = common.generated_image_path(f"shadow_{name.lower()}.png")
    common.save_numpy_png(rgba, path, name=f"shadow_{name}_save")

    # the patch material shows the new texture
    node = patch.data.materials[0].node_tree.nodes["ShadowImage"]
    old = node.image
    new = bpy.data.images.load(path, check_existing=False)
    new.colorspace_settings.name = "sRGB"
    new.alpha_mode = "STRAIGHT"
    node.image = new
    if old is not None and old.users == 0:
        bpy.data.images.remove(old)
    new.name = f"shadow_{name.lower()}"
    edge = max(alpha[0].max(), alpha[-1].max(), alpha[:, 0].max(), alpha[:, -1].max())
    stats = {"path": path, "res": [w_px, h_px], "ao_distance_m": spec["ao"],
             "ao_min": float(ao.min()), "alpha_max": float(alpha.max()),
             "alpha_mean": float(alpha.mean()), "alpha_at_border_max": float(edge),
             "covered_fraction_alpha_gt_0_02": float((alpha > 0.02).mean()),
             "ref_t": spec["ref_t"], "casters": [c.name for c in casters]}
    log(f"shadow {name}: AO {spec['ao']} m, alpha max {stats['alpha_max']:.2f} -> {path}")
    return stats


def bake_shadows(ctx: Ctx) -> dict:
    scene = ctx.scene
    engine_before = scene.render.engine
    device = common.setup_cycles(scene, SAMPLES)
    scene.render.bake.target = "IMAGE_TEXTURES"
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.margin = 4
    res: dict = {"device": device, "samples": SAMPLES, "patches": {}}
    fails = []
    try:
        for name, spec in build_story.SHADOWS.items():
            st = _bake_patch(ctx, name, spec)
            res["patches"][name] = st
            if not (0.15 < st["alpha_max"] <= spec["opacity"] + 1e-6):
                fails.append(f"shadow {name}: baked alpha looks empty or broken ({st['alpha_max']:.3f})")
            if st["alpha_at_border_max"] > 1e-3:
                fails.append(f"shadow {name}: visible at the patch border")
    finally:
        try:
            scene.render.engine = engine_before
        except TypeError:
            pass
        scene.frame_set(0)
    res["passed"] = not fails
    res["failures"] = fails
    common.write_json(os.path.join(ctx.stage_renders("story"), "bake.json"), common.rnd(res, 6))
    for f in fails:
        log(f"CHECK FAILED: {f}")
    log(f"shadow bakes on {device}: {'ok' if not fails else 'FAILED'}")
    return res
