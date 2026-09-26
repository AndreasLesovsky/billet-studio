"""Shared helpers for the hero build scripts (Blender 5.2, run headless via build.py).

Conventions used by every stage:
- Units are metres, Blender Z-up (the glTF exporter converts to Y-up later).
- Object names only use [A-Za-z0-9_].
- Shader nodes are looked up by ``node.type`` (never by name: names are localised in the UI).
- Enum identifiers that differ between Blender versions are read from RNA or assigned inside
  ``try/except TypeError``.
- Materials are Principled BSDF only (glTF / three.js MeshStandardMaterial target).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass, field

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERO_DIR = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.path.join(HERO_DIR, ".work")
RENDERS_DIR = os.path.join(HERO_DIR, ".renders")
IMAGES_DIR = os.path.join(HERO_DIR, "images")
TESTDATA_DIR = os.path.join(HERO_DIR, "testdata")

STAGES = ("card", "phone", "story", "bake", "export")


# --------------------------------------------------------------------------------------------
# CLI + context
# --------------------------------------------------------------------------------------------

def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse the arguments after Blender's own '--' separator."""
    own = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser(prog="build.py", description="Hero asset build (Blender headless)")
    p.add_argument("--stage", choices=STAGES, default="card")
    p.add_argument("--render", action="store_true", help="write check renders + contact sheet")
    p.add_argument("--textures", default=None,
                   help="folder with print_front.png / print_inside.png (default: test textures)")
    return p.parse_args(own)


@dataclass
class Ctx:
    args: argparse.Namespace
    scene: bpy.types.Scene
    hero_dir: str = HERO_DIR
    work_dir: str = WORK_DIR
    renders_dir: str = RENDERS_DIR
    images_dir: str = IMAGES_DIR
    objects: dict = field(default_factory=dict)
    materials: dict = field(default_factory=dict)
    info: dict = field(default_factory=dict)

    def stage_renders(self, stage: str) -> str:
        path = os.path.join(self.renders_dir, stage)
        os.makedirs(path, exist_ok=True)
        return path


def make_context(args: argparse.Namespace) -> Ctx:
    for d in (WORK_DIR, RENDERS_DIR, IMAGES_DIR):
        os.makedirs(d, exist_ok=True)
    return Ctx(args=args, scene=bpy.context.scene)


def log(msg: str) -> None:
    print(f"[hero] {msg}", flush=True)


def print_texture_paths(ctx: Ctx) -> tuple[str, str]:
    """(front, inside) print textures: --textures DIR or the orientation test prints."""
    if ctx.args.textures:
        d = os.path.abspath(ctx.args.textures)
        front, inside = os.path.join(d, "print_front.png"), os.path.join(d, "print_inside.png")
    else:
        front = os.path.join(TESTDATA_DIR, "print_front_test.png")
        inside = os.path.join(TESTDATA_DIR, "print_inside_test.png")
    for f in (front, inside):
        if not os.path.isfile(f):
            raise FileNotFoundError(f"print texture missing: {f}")
    return front, inside


# --------------------------------------------------------------------------------------------
# Scene
# --------------------------------------------------------------------------------------------

def reset_scene(ctx: Ctx) -> None:
    """Empty the factory-startup scene (cube, camera, light) and purge orphan data."""
    scene = ctx.scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights,
                  bpy.data.images, bpy.data.worlds):
        for item in list(block):
            if item.users == 0:
                block.remove(item)
    us = scene.unit_settings
    us.system = "METRIC"
    us.scale_length = 1.0
    try:
        us.length_unit = "MILLIMETERS"  # display only; data stays in metres
    except TypeError:
        pass
    scene.frame_set(1)


def collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if coll.name not in parent.children:
        parent.children.link(coll)
    return coll


def new_empty(name: str, coll: bpy.types.Collection, display: str = "PLAIN_AXES",
              size: float = 0.01, parent: bpy.types.Object | None = None) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = display
    obj.empty_display_size = size
    coll.objects.link(obj)
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
    return obj


def new_mesh_object(name: str, mesh: bpy.types.Mesh, coll: bpy.types.Collection,
                    parent: bpy.types.Object | None = None) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
    return obj


def apply_modifiers(obj: bpy.types.Object) -> None:
    """Bake the modifier stack into the mesh data (same result as glTF 'apply modifiers')."""
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    new = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True,
                                          depsgraph=dg)
    old = obj.data
    name = old.name
    obj.modifiers.clear()
    obj.data = new
    bpy.data.meshes.remove(old)
    new.name = name


def triangle_count(obj: bpy.types.Object) -> int:
    counts = np.zeros(len(obj.data.polygons), dtype=np.int64)
    obj.data.polygons.foreach_get("loop_total", counts)
    return int((counts - 2).sum())


def mesh_vertices(obj: bpy.types.Object, world: bool = True) -> np.ndarray:
    me = obj.data
    co = np.zeros(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    if world:
        m = np.array(obj.matrix_world, dtype=np.float64)
        co = co @ m[:3, :3].T + m[:3, 3]
    return co


def evaluated_vertices(obj: bpy.types.Object, world: bool = True) -> np.ndarray:
    """Vertex positions after modifiers/deformation (e.g. an armature), same order as obj.data
    when the modifiers keep the topology."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    try:
        co = np.zeros(len(me.vertices) * 3, dtype=np.float64)
        me.vertices.foreach_get("co", co)
    finally:
        ev.to_mesh_clear()
    co = co.reshape(-1, 3)
    if world:
        m = np.array(ev.matrix_world, dtype=np.float64)
        co = co @ m[:3, :3].T + m[:3, 3]
    return co


def save_blend(ctx: Ctx, name: str = "hero.blend") -> str:
    path = os.path.join(ctx.work_dir, name)
    bpy.ops.wm.save_as_mainfile(filepath=path, check_existing=False, compress=True,
                                relative_remap=True)
    log(f"saved {path}")
    return path


# --------------------------------------------------------------------------------------------
# Colour + materials (nodes found by type, sockets by identifier)
# --------------------------------------------------------------------------------------------

def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(hex_color: str) -> tuple[float, float, float, float]:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


def find_node(tree: bpy.types.NodeTree, node_type: str):
    return next((n for n in tree.nodes if n.type == node_type), None)


def socket(sockets, identifier: str):
    for s in sockets:
        if s.identifier == identifier:
            return s
    for s in sockets:
        if s.name == identifier:
            return s
    raise KeyError(identifier)


def load_image(path: str, colorspace: str = "sRGB", name: str | None = None) -> bpy.types.Image:
    img = bpy.data.images.load(path, check_existing=True)
    if name:
        img.name = name
    try:
        img.colorspace_settings.name = colorspace
    except TypeError:
        img.colorspace_settings.is_data = colorspace != "sRGB"
    return img


def image_to_numpy(img: bpy.types.Image) -> np.ndarray:
    """RGBA float array [rows(bottom-up), cols, 4] of the image's stored pixel values."""
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def save_numpy_png(arr: np.ndarray, path: str, name: str = "tmp_save") -> None:
    """Write an RGBA/RGB float array [rows(bottom-up), cols, C] (values 0..1) as 8-bit PNG."""
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1), dtype=arr.dtype)], axis=2)
    img = bpy.data.images.new(name, width=w, height=h, alpha=True, float_buffer=False)
    try:
        img.colorspace_settings.name = "Non-Color"  # store values 1:1
    except TypeError:
        img.colorspace_settings.is_data = True
    img.pixels.foreach_set(np.clip(arr, 0.0, 1.0).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def new_material(name: str) -> tuple[bpy.types.Material, bpy.types.NodeTree, object]:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        mat.use_nodes = True  # always on in 5.x; kept for older versions
    except (AttributeError, TypeError):
        pass
    tree = mat.node_tree
    bsdf = find_node(tree, "BSDF_PRINCIPLED")
    out = find_node(tree, "OUTPUT_MATERIAL")
    if bsdf is None:
        bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    if out is None:
        out = tree.nodes.new("ShaderNodeOutputMaterial")
    if not socket(out.inputs, "Surface").is_linked:
        tree.links.new(socket(bsdf.outputs, "BSDF"), socket(out.inputs, "Surface"))
    bsdf.location = (300, 0)
    out.location = (600, 0)
    return mat, tree, bsdf


def principled_material(name: str, *, base_color=(0.8, 0.8, 0.8, 1.0),
                        base_image: bpy.types.Image | None = None,
                        roughness: float = 0.5,
                        normal_image: bpy.types.Image | None = None,
                        normal_strength: float = 0.3,
                        normal_tiling: tuple[float, float] = (1.0, 1.0),
                        uv_map: str = "UVMap") -> bpy.types.Material:
    """Principled BSDF material, glTF-exportable: base colour (constant or image),
    roughness, metallic 0, default specular, optional tiled tangent-space normal map
    (UV Map -> Mapping -> Image -> Normal Map, exported as KHR_texture_transform)."""
    mat, tree, bsdf = new_material(name)
    socket(bsdf.inputs, "Metallic").default_value = 0.0
    socket(bsdf.inputs, "Roughness").default_value = roughness
    socket(bsdf.inputs, "Base Color").default_value = base_color
    uv = tree.nodes.new("ShaderNodeUVMap")
    uv.uv_map = uv_map
    uv.location = (-900, 0)
    if base_image is not None:
        tex = tree.nodes.new("ShaderNodeTexImage")
        tex.image = base_image
        tex.extension = "EXTEND"
        tex.interpolation = "Linear"
        tex.location = (-300, 250)
        tree.links.new(socket(uv.outputs, "UV"), socket(tex.inputs, "Vector"))
        tree.links.new(socket(tex.outputs, "Color"), socket(bsdf.inputs, "Base Color"))
    if normal_image is not None:
        mapping = tree.nodes.new("ShaderNodeMapping")
        mapping.vector_type = "POINT"
        mapping.location = (-650, -250)
        socket(mapping.inputs, "Scale").default_value = (normal_tiling[0], normal_tiling[1], 1.0)
        ntex = tree.nodes.new("ShaderNodeTexImage")
        ntex.image = normal_image
        ntex.extension = "REPEAT"
        ntex.interpolation = "Linear"
        ntex.location = (-400, -250)
        nmap = tree.nodes.new("ShaderNodeNormalMap")
        nmap.space = "TANGENT"
        nmap.uv_map = uv_map
        nmap.location = (-100, -250)
        socket(nmap.inputs, "Strength").default_value = normal_strength
        tree.links.new(socket(uv.outputs, "UV"), socket(mapping.inputs, "Vector"))
        tree.links.new(socket(mapping.outputs, "Vector"), socket(ntex.inputs, "Vector"))
        tree.links.new(socket(ntex.outputs, "Color"), socket(nmap.inputs, "Color"))
        tree.links.new(socket(nmap.outputs, "Normal"), socket(bsdf.inputs, "Normal"))
    return mat


def assert_principled_only(mat: bpy.types.Material) -> list[str]:
    """Node types that the glTF target can't express (should be empty)."""
    allowed = {"BSDF_PRINCIPLED", "OUTPUT_MATERIAL", "TEX_IMAGE", "UVMAP", "MAPPING",
               "NORMAL_MAP", "TEX_COORD"}
    return sorted({n.type for n in mat.node_tree.nodes} - allowed)


# --------------------------------------------------------------------------------------------
# Procedural textures (computed with numpy, saved as images)
# --------------------------------------------------------------------------------------------

def _gauss_blur_periodic(a: np.ndarray, sigma: float) -> np.ndarray:
    """Periodic (tile-safe) Gaussian blur via FFT."""
    n0, n1 = a.shape
    f0 = np.fft.fftfreq(n0)[:, None]
    f1 = np.fft.fftfreq(n1)[None, :]
    g = np.exp(-2.0 * (math.pi * sigma) ** 2 * (f0 ** 2 + f1 ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def _slope_rms(h: np.ndarray) -> float:
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    return float(np.sqrt((dx ** 2 + dy ** 2).mean()))


def paper_fibre_normal_map(path: str, size: int = 1024, tile_mm: float = 60.0,
                           seed: int = 20260926, rms_slope: float = 0.14) -> dict:
    """Tileable uncoated card-stock normal map (OpenGL / glTF convention, +Y = up in UV).

    The tile covers tile_mm x tile_mm of card. The height field mixes four bands, weighted by
    their share of the surface slope, so that something survives at every viewing distance:
      cockle     1-6 mm undulation   (still visible at hero scale, where one screen pixel
                                      covers several texels and the fine bands mip away)
      mottle     0.2-0.6 mm clouds   (felt-like tooth in close-ups)
      grain      ~0.05 mm noise
      fibres     0.4-1.4 mm strokes, mostly isotropic, low amplitude
    Every operation wraps around, so the tile is seamless. Returns the band weights."""
    rng = np.random.default_rng(seed)
    n = size
    px_mm = tile_mm / n

    def band(lo_mm: float, hi_mm: float) -> np.ndarray:
        white = rng.normal(0.0, 1.0, (n, n))
        return (_gauss_blur_periodic(white, lo_mm / px_mm)
                - _gauss_blur_periodic(white, hi_mm / px_mm))

    cockle = band(0.9, 3.0)
    mottle = band(0.18, 0.6)
    grain = _gauss_blur_periodic(rng.normal(0.0, 1.0, (n, n)), 0.9)
    fib = np.zeros((n, n), dtype=np.float64)
    count = int(9000 * (n / 1024) ** 2)
    cx, cy = rng.uniform(0, n, count), rng.uniform(0, n, count)
    ang = np.where(rng.random(count) < 0.25, rng.normal(0.0, 0.5, count),
                   rng.uniform(0, math.pi, count))
    length = rng.uniform(0.4, 1.4, count) / px_mm
    amp = rng.uniform(0.2, 1.0, count)
    for i in range(count):
        t = np.linspace(-0.5, 0.5, int(length[i] * 2) + 2) * length[i]
        a = ang[i] + rng.normal(0, 0.01) * t  # slight curl
        xs = np.mod(np.round(cx[i] + t * np.cos(a)).astype(np.int64), n)
        ys = np.mod(np.round(cy[i] + t * np.sin(a)).astype(np.int64), n)
        np.add.at(fib, (ys, xs), amp[i])
    fib = _gauss_blur_periodic(fib, 0.6)

    weights = {"cockle": 0.42, "mottle": 0.30, "grain": 0.16, "fibres": 0.12}
    h = np.zeros((n, n))
    for name, comp in (("cockle", cockle), ("mottle", mottle), ("grain", grain), ("fibres", fib)):
        h += weights[name] * (comp - comp.mean()) / (_slope_rms(comp) + 1e-12)
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    k = rms_slope / (_slope_rms(h) + 1e-12)
    nx, ny, nz = -k * dx, -k * dy, np.ones_like(h)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    rgb = np.stack([nx / ln, ny / ln, nz / ln], axis=2) * 0.5 + 0.5
    save_numpy_png(rgb.astype(np.float32), path, name="paper_normal_gen")
    return {"size_px": n, "tile_mm": tile_mm, "rms_slope": rms_slope, "band_weights": weights}


# --------------------------------------------------------------------------------------------
# Rendering: engine, colour management, neutral studio, cameras
# --------------------------------------------------------------------------------------------

def set_engine(scene: bpy.types.Scene, wanted: str) -> str:
    try:
        scene.render.engine = wanted
    except TypeError as e:
        raise RuntimeError(f"render engine {wanted!r} not available: {e}") from e
    return scene.render.engine


def set_view_transform(scene: bpy.types.Scene, preferred=("Khronos PBR Neutral", "Standard")) -> str:
    for vt in preferred:
        try:
            scene.view_settings.view_transform = vt
            scene.view_settings.look = "None"
            return vt
        except TypeError:
            continue
    return scene.view_settings.view_transform


def setup_eevee(scene: bpy.types.Scene, resolution: int = 1024, samples: int = 64) -> None:
    set_engine(scene, "BLENDER_EEVEE")
    r = scene.render
    r.resolution_x = r.resolution_y = resolution
    r.resolution_percentage = 100
    r.film_transparent = False
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGB"
    r.image_settings.color_depth = "8"
    ee = scene.eevee
    ee.taa_render_samples = samples
    for attr, val in (("use_shadows", True), ("shadow_ray_count", 3), ("shadow_step_count", 8),
                      ("use_raytracing", True), ("use_fast_gi", True),
                      ("shadow_resolution_scale", 1.0)):
        if hasattr(ee, attr):
            setattr(ee, attr, val)
    set_view_transform(scene)


def setup_cycles(scene: bpy.types.Scene, samples: int = 128) -> str:
    """Cycles on the GPU: OPTIX -> CUDA -> CPU. Returns the device type used."""
    set_engine(scene, "CYCLES")
    scene.cycles.samples = samples
    used = "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for dev_type in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = dev_type
            except TypeError:
                continue
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == dev_type]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == dev_type
                used = dev_type
                break
    except (KeyError, AttributeError):
        pass
    scene.cycles.device = "GPU" if used != "CPU" else "CPU"
    return used


def build_studio(ctx: Ctx, target: Vector) -> bpy.types.Collection:
    """Neutral light-grey studio: a matte cyclorama (floor sweeping up into a back wall, turn it
    towards each camera with face_studio) + soft key, fill and rim area lights."""
    coll = collection("CheckStudio")
    scene = ctx.scene
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    try:
        world.use_nodes = True
    except (AttributeError, TypeError):
        pass
    bg = find_node(world.node_tree, "BACKGROUND")
    socket(bg.inputs, "Color").default_value = hex_to_linear("#c8c8cb")
    socket(bg.inputs, "Strength").default_value = 0.35

    # cyclorama profile in YZ: floor -> quarter circle -> wall; extruded along X
    prof = [(-4.0, 0.0), (-1.0, 0.0), (0.0, 0.0), (0.3, 0.0)]
    rad, wall_y = 0.6, 0.3
    for a in np.linspace(0, math.pi / 2, 17)[1:]:
        prof.append((wall_y + rad * math.sin(a), rad - rad * math.cos(a)))
    prof += [(wall_y + rad, 1.5), (wall_y + rad, 4.0)]
    xs = (-4.0, -1.0, 1.0, 4.0)
    verts = [(x, y, z) for (y, z) in prof for x in xs]
    nx = len(xs)
    faces = [(j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i)
             for j in range(len(prof) - 1) for i in range(nx - 1)]
    me = bpy.data.meshes.new("Studio_Cyc")
    me.from_pydata(verts, [], faces)
    me.shade_smooth()
    cyc = new_mesh_object("Studio_Cyc", me, coll)
    cyc.location.z = -2e-6  # never coplanar with the card's bottom edge
    me.materials.append(principled_material("M_Studio_Cyc", base_color=hex_to_linear("#b9b9bc"),
                                            roughness=0.95))

    def area(name, loc, size, power, color=(1.0, 1.0, 1.0)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.shape = "DISK"
        ld.size = size
        ld.energy = power
        ld.color = color
        if hasattr(ld, "use_shadow_jitter"):
            ld.use_shadow_jitter = True
        ob = bpy.data.objects.new(name, ld)
        coll.objects.link(ob)
        ob.location = target + Vector(loc)
        look_at(ob, target)
        return ob

    area("Studio_Key", (-0.45, -0.55, 0.55), 0.55, 16.0, (1.0, 0.985, 0.96))
    area("Studio_Fill", (0.6, -0.35, 0.25), 0.8, 5.0, (0.96, 0.98, 1.0))
    area("Studio_Rim", (0.15, 0.6, 0.5), 0.5, 7.0)
    return coll


def face_studio(az_deg: float) -> None:
    """Turn the cyclorama so its back wall is opposite a camera at azimuth az_deg."""
    cyc = bpy.data.objects.get("Studio_Cyc")
    if cyc is not None:
        cyc.rotation_euler = (0.0, 0.0, math.radians(az_deg))


def look_at(obj: bpy.types.Object, target: Vector, up: Vector = Vector((0, 0, 1))) -> None:
    d = (Vector(target) - obj.location).normalized()
    if abs(d.dot(up)) > 0.999:
        up = Vector((0, 1, 0))
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def view_direction(az_deg: float, el_deg: float) -> Vector:
    """Unit vector from the target towards the camera. az 0 = in front (-Y), +az = to the right
    (+X); el = elevation above the horizon."""
    az, el = math.radians(az_deg), math.radians(el_deg)
    return Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))


def fit_camera(cam: bpy.types.Object, points: np.ndarray, az_deg: float, el_deg: float,
               margin: float = 0.86, target: Vector | None = None) -> None:
    """Place a perspective camera on the (az, el) ray so all points fit the square frame."""
    pts = np.asarray(points, dtype=np.float64)
    tgt = Vector(target) if target is not None else Vector(((pts.min(0) + pts.max(0)) / 2).tolist())
    off = view_direction(az_deg, el_deg)
    fwd = -off
    up_hint = Vector((0, 0, 1)) if abs(fwd.z) < 0.999 else Vector((0, 1, 0))
    right = fwd.cross(up_hint).normalized()
    up = right.cross(fwd).normalized()
    half = math.atan(cam.data.sensor_width / (2 * cam.data.lens))  # square frame
    k = math.tan(half) * margin
    rel = pts - np.array(tgt)
    r = rel @ np.array(right)
    u = rel @ np.array(up)
    f = rel @ np.array(fwd)
    dist = float(np.max(np.maximum(np.abs(r), np.abs(u)) / k - f))
    cam.location = tgt + off * dist
    look_at(cam, tgt)
    if abs(fwd.z) >= 0.999:  # straight down/up: fixed roll, image up = +Y
        cam.rotation_euler = (0.0, 0.0, 0.0) if fwd.z < 0 else (math.pi, 0.0, 0.0)
    cam.data.clip_start = max(dist * 0.02, 1e-4)
    cam.data.clip_end = dist * 50 + 10


def new_camera(name: str, coll: bpy.types.Collection, lens: float = 50.0) -> bpy.types.Object:
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_fit = "HORIZONTAL"
    cd.sensor_width = 36.0
    cam = bpy.data.objects.new(name, cd)
    coll.objects.link(cam)
    return cam


def render_still(scene: bpy.types.Scene, cam: bpy.types.Object, path: str) -> str:
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log(f"render {os.path.basename(path)}")
    return path


# --------------------------------------------------------------------------------------------
# Contact sheet (numpy + a tiny built-in 5x7 bitmap font for the labels)
# --------------------------------------------------------------------------------------------

_FONT_5X7 = {
    "A": "01110 10001 10001 11111 10001 10001 10001", "B": "11110 10001 10001 11110 10001 10001 11110",
    "C": "01110 10001 10000 10000 10000 10001 01110", "D": "11110 10001 10001 10001 10001 10001 11110",
    "E": "11111 10000 10000 11110 10000 10000 11111", "F": "11111 10000 10000 11110 10000 10000 10000",
    "G": "01110 10001 10000 10111 10001 10001 01111", "H": "10001 10001 10001 11111 10001 10001 10001",
    "I": "01110 00100 00100 00100 00100 00100 01110", "J": "00111 00010 00010 00010 00010 10010 01100",
    "K": "10001 10010 10100 11000 10100 10010 10001", "L": "10000 10000 10000 10000 10000 10000 11111",
    "M": "10001 11011 10101 10101 10001 10001 10001", "N": "10001 10001 11001 10101 10011 10001 10001",
    "O": "01110 10001 10001 10001 10001 10001 01110", "P": "11110 10001 10001 11110 10000 10000 10000",
    "Q": "01110 10001 10001 10001 10101 10010 01101", "R": "11110 10001 10001 11110 10100 10010 10001",
    "S": "01111 10000 10000 01110 00001 00001 11110", "T": "11111 00100 00100 00100 00100 00100 00100",
    "U": "10001 10001 10001 10001 10001 10001 01110", "V": "10001 10001 10001 10001 10001 01010 00100",
    "W": "10001 10001 10001 10101 10101 10101 01010", "X": "10001 10001 01010 00100 01010 10001 10001",
    "Y": "10001 10001 01010 00100 00100 00100 00100", "Z": "11111 00001 00010 00100 01000 10000 11111",
    "0": "01110 10001 10011 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
    "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11111 00010 00100 00010 00001 10001 01110",
    "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
    "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
    "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
    "_": "00000 00000 00000 00000 00000 00000 11111", "-": "00000 00000 00000 11111 00000 00000 00000",
    ".": "00000 00000 00000 00000 00000 01100 01100", " ": "00000 00000 00000 00000 00000 00000 00000",
}


def _draw_text(canvas: np.ndarray, text: str, x0: int, y_top: int, scale: int, color) -> None:
    """Draw text into a top-down RGB canvas [rows(top-down), cols, 3]."""
    x = x0
    for ch in text.upper():
        rows = _FONT_5X7.get(ch, _FONT_5X7[" "]).split()
        for ry, row in enumerate(rows):
            for rx, bit in enumerate(row):
                if bit == "1":
                    canvas[y_top + ry * scale:y_top + (ry + 1) * scale,
                           x + rx * scale:x + (rx + 1) * scale] = color
        x += 6 * scale


def contact_sheet(items: list[tuple[str, str]], out_path: str, cols: int = 4, tile: int = 512,
                  legend_path: str | None = None) -> None:
    """Compose (label, png path) items into one labelled PNG (+ optional legend JSON)."""
    label_h = 34
    rows = math.ceil(len(items) / cols)
    pad = 6
    W = cols * tile + (cols + 1) * pad
    Hh = rows * (tile + label_h) + (rows + 1) * pad
    canvas = np.full((Hh, W, 3), 0.12, dtype=np.float32)  # top-down while composing
    legend = []
    for i, (label, path) in enumerate(items):
        r, c = divmod(i, cols)
        x0 = pad + c * (tile + pad)
        y0 = pad + r * (tile + label_h + pad)
        img = bpy.data.images.load(path, check_existing=False)
        px = image_to_numpy(img)[::-1, :, :3]  # to top-down
        bpy.data.images.remove(img)
        h, w = px.shape[:2]
        f = max(1, int(round(h / tile)))
        small = px[:h - h % f, :w - w % f].reshape(h // f, f, w // f, f, 3).mean(axis=(1, 3))
        small = small[:tile, :tile]
        canvas[y0:y0 + small.shape[0], x0:x0 + small.shape[1]] = small
        _draw_text(canvas, label, x0 + 8, y0 + tile + 7, 3, (0.95, 0.95, 0.95))
        legend.append({"index": i, "row": r, "col": c, "label": label, "file": os.path.basename(path)})
    save_numpy_png(canvas[::-1].copy(), out_path, name="contact_sheet")
    if legend_path:
        write_json(legend_path, legend)
    log(f"contact sheet {out_path}")


# --------------------------------------------------------------------------------------------
# JSON
# --------------------------------------------------------------------------------------------

def _jsonable(o):
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, Vector):
        return list(o)
    raise TypeError(type(o))


def write_json(path: str, data) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, default=_jsonable)
        fh.write("\n")
    log(f"wrote {path}")


def rnd(x, nd: int = 4):
    """Round floats (recursively) for readable JSON."""
    if isinstance(x, dict):
        return {k: rnd(v, nd) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [rnd(v, nd) for v in x]
    if isinstance(x, (float, np.floating)):
        return round(float(x), nd)
    return x


def exit_code_from(ok: bool) -> int:
    sys.stdout.flush()
    return 0 if ok else 1
