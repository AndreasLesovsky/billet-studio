"""H4 - the hero story (docs/hero-story.md): choreography, runtime camera, Fx values, markers.

Needs the card (build_card) and the phone (build_phone) in the scene and adds:

    Cam, CamTarget   empties: the runtime camera (position = Cam, lookAt = CamTarget, up = +Z,
                     three.js +Y). Cam carries the authored frame (fovDeg, aspect) and, for a
                     Blender that appends this file's objects, heroFrameRange = [0, 300] + heroFps.
    Card             stands tented, turns to the viewer, opens (beat write); closes where it stands
                     once the heart has flown (the cover swings away from the phone, in view),
                     lifts, takes on the phone's yaw and lean, shrinks and glides onto the upper
                     part of the screen, its cover title over the billet page's title, and sinks
                     towards the glass while it dissolves into the page (beat share). Card_Hinge
                     opens it, the spine bones follow through their drivers (baked by export.py).
    GiftSlot         the gift: peeks out of the fold and pops like a pop-up card, then stands in
                     front of the fold (beat gift); after the message it dips, flies ahead on an
                     arc into the phone (below the message banner) and lands on Phone_ScreenDock
                     with a small pop; from the landing on its world transform IS the dock's
                     (computed from the phone's pose, not approximated).
    Phone            rises screen first in front of the open cover (grows out of the ground,
                     comes forward, turns 24 deg to the front), wakes, the message slides in.
    Fx_<Name>        control values 0..1 in location.x: Wake, Notif, Billet, CardFade, Shadow_*.
    Shadow_<Name>    ground patches (M_Shadow_<Name>, images/shadow_<name>.png from --stage bake):
                     CardTent, CardOpen (they follow the card's turn), Phone (follows the phone's
                     ground position, yaw and scale while it rises).

Every story object is keyed per frame (LINEAR between frames) from the motion functions below,
so this file, the check renders and the glTF clip show the same film. The eased curves live in
the motion functions (smootherstep / clamped Hermite splines / small springs), never linear;
the camera's compositions are joined by C2 quintic splines.

Not exported (collection HeroPreview): RenderCam (follows Cam / CamTarget by constraints), the
studio lights, the heart stand-in (the light hero GLB under GiftSlot, fitted exactly like the
runtime's fitTransform, its beat looping) and M_ScreenPreview (lock -> message -> billet from the
Fx values through drivers; the exported M_Screen stays the plain placeholder). The card and
shadow materials fade by drivers on Fx_CardFade / Fx_Shadow_*; export.py removes all drivers.
Constraints and drivers only point at objects of this file, by ID (never by name), with simple
expressions, so they keep working when the objects are appended into another file.
"""

from __future__ import annotations

import glob
import json
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

import build_card
import build_phone
import common
from common import Ctx, log, rnd

# ---------------------------------------------------------------------------------------------
# Timeline (seconds; frame = t * FPS, frames 0 .. 300)
# ---------------------------------------------------------------------------------------------
FPS = 30
DURATION = 10.0
FRAME_END = int(round(DURATION * FPS))
SCENE_NAME = "Story"            # the glTF exporter names the SCENE-mode clip after the scene
FOV_DEG = 30.0                  # vertical FOV of the authored square frame
ASPECT = 1.0
FRAME_RULE = (0.04, 0.96)       # everything visible stays inside this part of the frame
GIFT_TEMPLATE = "valentinstag"

BEATS = (("write", 0.0), ("gift", 3.6), ("share", 6.2))
# The screens gate sits at the start of the share beat, before anything needs the lock, message
# or billet screen (Fx_Wake rises from T_WAKE): the textures (~60 KB) load while the card and the
# heart play, and a late load holds the clock where the share chapter begins (the phone has not
# appeared yet). Autoplay no longer waits for them at t = 0.
T_GATE_SCREENS = 186 / FPS      # 6.2 s
T_LAND = 258 / FPS              # 8.6 s: the heart reaches Phone_ScreenDock (on a frame, like its
                                # marker mark:land)

# The heart's own clip (beating-heart: a double beat, then a half turn about its up axis, looping
# every 1.625 s) runs on the gift's mixer, which the runtime advances with the story clock (it
# starts with the clock at 0 and only a gate hold would shift it). The heart is edge-on (30..150
# deg of its turn) during 0.60..1.13 s of every loop, so the story's two heart moments sit in
# face-on phases: the pop peaks at 4.45 s (loop phase 1.20 s, 157 deg) and the heart lands at
# 8.6 s (phase 0.48 s, its double beat during the flight); the check measures both.

# --- card ---------------------------------------------------------------------------------------
PHI_TENT = 18.0                 # tented just enough to stand
PHI_OPEN = 150.0
PHI_OVER = 152.5                # the paper swings a little past 150 and settles back
T_OPEN = (0.85, 2.15)           # the cover's main move
T_SETTLE = 2.6
# deg about the fold line: a 3/4 view of the cover, a turn towards the viewer (from the first
# frames on, with the camera's dolly), then the open spread faces the camera (its bisector is
# 15 deg right of the back panel's normal)
CARD_YAW = ((0.0, -4.0), (1.35, 8.0), (2.9, 3.0))
T_CLOSE = (7.95, 8.4)           # the cover closes where the card stands, once the heart is clear of
                                # its sweep; it swings away from the phone (in view)
T_TRAVEL = (8.05, 8.95)         # lifts, takes on the phone's yaw and lean, shrinks and glides onto
                                # the screen from the front right (starts when the cover is past
                                # 90 deg, i.e. swinging away from the phone)
T_SINK = (8.95, 9.4)            # then sinks towards the glass while it dissolves into the page
T_CARD_FADE = (9.12, 9.4)
CARD_END_SCALE = 0.49           # 51 x 73 mm: the upper part of the screen, inside its outline and
                                # above the landed heart (which, turning, reaches the glass); its
                                # title block then lies on the billet page's title block
CARD_END_TOP = 0.0025           # the card's top edge below the display's top edge (its corners
                                # stay inside the display's rounded corners)
CARD_ARRIVE_GAP = 0.006         # the card's back this far in front of the glass on arrival ...
CARD_END_GAP = 0.0008           # ... and when it has dissolved (never touching the glass)
CARD_TRAVEL_P1 = (-0.01, -0.16, 0.03)   # off the ground: towards the viewer and up, right of the
                                        # phone (never behind it while it covers it)
T_CARD_SHRINK = 0.45            # s after the lift: it is small before it glides (little frame room)
CARD_TRAVEL_FRONT = 0.035       # the last approach: from this far in front of the screen ...
CARD_TRAVEL_UP = 0.025          # ... and this far above the arrival (clear of the landed heart)
CARD_TRAVEL_RIGHT = 0.09        # ... and from the right (one round turn)

# --- heart (GiftSlot) -----------------------------------------------------------------------------
HEART_SCALE = 0.034             # GiftSlot scale while it stands in front of the fold (54 mm wide)
# GiftSlot scale / HEART_SCALE: it peeks out of the fold, pops (overshoot), settles
HEART_POP = ((3.62, 0.0), (4.12, 0.3), (4.45, 1.12), (4.63, 0.955), (4.8, 1.0))
T_EMERGE = (3.62, 4.75)         # out of the fold along the V's bisector, rising a little
HEART_R0 = 0.004
HEART_OUT = 0.046               # stands this far out of the fold (a pop-up element) ...
HEART_Z0 = 0.074
HEART_Z = 0.082                 # ... at this height (centre), in front of the open card
HOVER_BOB = 0.0015              # gentle float while it stands
BOB_PERIOD = 2.4
T_DIP = (7.5, 7.65)             # anticipation: a small dip before the flight
DIP = 0.0035
T_FLY = (7.75, T_LAND)
T_LAND_POP = (T_LAND, T_LAND + 0.34)
FLY_P1 = (0.045, -0.1, 0.02)    # launch: towards the viewer first (clear of the phone), up a little
FLY_FRONT = 0.06                # arrival: from the front of the screen ...
FLY_RIGHT = 0.05                # ... and from the right (below the message banner)
FLY_UP = 0.008

# --- phone ------------------------------------------------------------------------------------------
# It rises 150 mm in front of the card, left of the heart, screen first: it grows out of the ground
# (its bottom hovering at PHONE_HOVER) while it comes forward from a little behind its rest place
# and turns PHONE_TURN deg towards the viewer. From T_PHONE[1] on it stands still. Seen from the
# camera, phone | heart | card stand side by side in depth: the card, 150 mm further back, needs
# little frame width, so the camera can push in on the phone while the message arrives.
T_PHONE = (6.1, 6.95)
PHONE_END_XY = (-0.052, -0.15)   # outside the cover's sweep (the card closes in view, right of it)
PHONE_START_OFFSET = (0.022, 0.03)
PHONE_END_YAW = 0.0             # screen straight to the front; the camera ends 4 deg to its right
PHONE_TURN = 24.0               # deg: starts turned towards the right (the camera and the card)
PHONE_END_LEAN = 6.0            # deg, top leaning back
PHONE_HOVER = 0.01              # gap between the phone and the (invisible) ground
PHONE_VISIBLE = 0.01            # below this scale the phone counts as not shown yet

# --- Fx (eased transitions between (t, value) keys; holds outside) ------------------------------------
T_WAKE = (6.3, 6.65)            # the screen lights up while the phone rises: it reads as a
                                # phone at once, never as a black slab
T_NOTIF = (6.8, 7.15)           # then held unobstructed until the heart launches (T_FLY)
T_BILLET = (8.6, 9.38)          # starts as the gliding card reaches the banner: a first tenth
                                # under the arriving card, the rest together with the card's
                                # dissolve (T_CARD_FADE), so the card morphs into the page
FX = {
    "Wake": ((T_WAKE[0], 0.0), (T_WAKE[1], 1.0)),
    "Notif": ((T_NOTIF[0], 0.0), (T_NOTIF[1], 1.0)),
    "Billet": ((T_BILLET[0], 0.0), (T_CARD_FADE[0] - 0.1, 0.12), (T_BILLET[1], 1.0)),
    "CardFade": ((T_CARD_FADE[0], 1.0), (T_CARD_FADE[1], 0.0)),
    "Shadow_CardTent": ((0.95, 1.0), (1.8, 0.0)),
    "Shadow_CardOpen": ((1.2, 0.0), (2.3, 1.0), (T_CLOSE[0], 1.0), (T_TRAVEL[0] + 0.1, 0.0)),
    "Shadow_Phone": ((6.3, 0.0), (7.0, 1.0)),
}

# --- shadow patches (ground, z slightly below 0 so the card's bottom edge covers them) ------------
# follows: "card" = rides with the card's turn until it lifts; "phone" = under the phone (its ground
# position, yaw and scale), so it grows with the phone as that rises.
# ref_t: the pose baked into the patch (--stage bake). ao: AO distance of the bake.
SHADOWS = {
    "CardTent": dict(follows="card", centre=(0.052, -0.014), size=(0.23, 0.13), res=(512, 290),
                     ref_t=0.5, ao=0.034, gain=1.35, gamma=1.1, opacity=0.6),
    "CardOpen": dict(follows="card", centre=(0.006, -0.026), size=(0.29, 0.17), res=(512, 300),
                     ref_t=3.4, ao=0.034, gain=1.35, gamma=1.1, opacity=0.6),
    "Phone": dict(follows="phone", centre=(0.0, -0.004), size=(0.13, 0.075), res=(512, 296),
                  ref_t=DURATION, ao=0.028, gain=1.8, gamma=1.0, opacity=0.5),
}
SHADOW_Z = -0.0002
SHADOW_VISIBLE = 0.035          # a shadow counts as visible where alpha x Fx exceeds this

# --- camera: one arc of composed shots --------------------------------------------------------------
# Each key is a composition: at time t, seen from azimuth / elevation, the subjects' projected box
# is centred and fills `fill` of the frame (largest NDC half extent; with "phone_h" the phone's
# height fills it instead and everything else stays inside CAMERA_SAFE). Between the keys the
# camera's target, angles and log distance follow C2 quintic splines, clamped (no overshoot, zero
# velocity at the first and last key and wherever a value turns). The arc: a slow dolly in on
# the card while it opens (write), a gentle widen for the phone (gift), a push-in on the phone
# while the message arrives (the open card still in the frame), then, once the card has closed,
# on into the idle composition while the heart and the card fly to the phone; it reaches the
# idle composition at CAMERA_KEYS[-1] and stands still from there.
# Subjects: card, heart, phone_end (its rest pose), heart_end (the heart at the dock), shadows.
CAMERA_KEYS = (
    dict(t=0.0, az=14.0, el=12.0, subjects=("card", "shadows"), fill=0.52),
    dict(t=2.3, az=13.0, el=11.5, subjects=("card", "shadows"), fill=0.78),
    dict(t=3.6, az=12.5, el=11.0, subjects=("card", "shadows"), fill=0.84),
    dict(t=4.8, az=12.0, el=10.5, subjects=("card", "heart", "shadows"), fill=0.83),
    dict(t=6.8, az=10.5, el=9.5, subjects=("card", "heart", "phone_end", "shadows"), fill=0.84),
    dict(t=7.8, az=9.0, el=8.5, subjects=("card", "heart", "phone_end", "shadows"),
         fill="phone_h", phone_h=0.62),
    dict(t=8.15, az=8.0, el=8.0, subjects=("card", "heart", "phone_end", "shadows"),
         fill="phone_h", phone_h=0.625),
    dict(t=9.35, az=4.0, el=5.0, subjects=("phone_end", "heart_end", "shadows"), fill="rest"),
)
CAMERA_SAFE = 0.9
CAMERA_ENVELOPE = 0.3           # s: smoothing of the safety envelope
REST_FILL = 0.72
CAMERA_MAX_SPEED = 125.0        # mm/s, checked (the write beat's dolly is the reference pace)

HERO_GIFTS_JSON = os.path.normpath(os.path.join(common.HERO_DIR, "..", "..", "asset-pipeline",
                                                "hero", "hero-gifts.json"))
FRONTEND_PUBLIC = os.path.normpath(os.path.join(common.HERO_DIR, "..", "..", "..",
                                                "billet-studio-frontend", "public"))
CAPTURES = build_phone.CAPTURES_DIR
PRINT_FRONT_PNG = os.path.join(CAPTURES, "print-front-valentinstag-de-light.png")
PRINT_INSIDE_PNG = os.path.join(CAPTURES, "print-inside-valentinstag-de-light.png")
LOCK_PNG = os.path.join(CAPTURES, "lock-de-light.png")
NOTIF_PNG = os.path.join(CAPTURES, "notification-valentinstag-de-light.png")
SCREEN_PNG = os.path.join(CAPTURES, "screen-valentinstag-de-light.png")
# the runtime's banner (hero-screen-material.ts): 358 x 120 CSS px, centred, 16 px below the top
BANNER_CSS = (358, 120, 16)

PREVIEW_COLL = "HeroPreview"   # not exported (export.py deletes it)
STORY_COLL = "HeroStory"
HEART_PHASES = 8                # heart poses (of its beat loop) the checks take into account

CARD_MESHES = build_card.MESHES
PHONE_MESHES = ("Phone_Body", "Phone_Screen", "Phone_PunchHole")
UP = Vector((0.0, 0.0, 1.0))


# ---------------------------------------------------------------------------------------------
# Easing
# ---------------------------------------------------------------------------------------------

def clamp01(x: float) -> float:
    return 0.0 if x <= 0.0 else 1.0 if x >= 1.0 else x


def span(t: float, t0: float, t1: float) -> float:
    return clamp01((t - t0) / (t1 - t0))


def smoothstep(x: float) -> float:
    x = clamp01(x)
    return x * x * (3.0 - 2.0 * x)


def smoothstep_arr(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def smootherstep(x: float) -> float:
    """Zero velocity and acceleration at both ends: the default ease of the story."""
    x = clamp01(x)
    return x * x * x * (x * (6.0 * x - 15.0) + 10.0)


class Spline:
    """Cubic Hermite spline through (t, value) keys. Tangents are Catmull-Rom, clamped like
    Blender's AUTO_CLAMPED handles: zero at the first and last key, at local extrema and at keys
    listed in `holds`, limited so a segment never overshoots its keys. Values may be vectors."""

    LIMIT = 3.0                 # tangent limit (x the smaller neighbouring slope): no overshoot

    def __init__(self, keys, holds: tuple = ()):
        self.t = np.array([k[0] for k in keys], dtype=np.float64)
        self.v = np.array([np.atleast_1d(np.asarray(k[1], dtype=np.float64)) for k in keys])
        n = len(self.t)
        m = np.zeros_like(self.v)
        for i in range(1, n - 1):
            if i in holds:
                continue
            d0 = (self.v[i] - self.v[i - 1]) / (self.t[i] - self.t[i - 1])
            d1 = (self.v[i + 1] - self.v[i]) / (self.t[i + 1] - self.t[i])
            mi = (self.v[i + 1] - self.v[i - 1]) / (self.t[i + 1] - self.t[i - 1])
            same = (np.sign(d0) == np.sign(d1)) & (d0 != 0) & (d1 != 0)
            lim = self.LIMIT * np.minimum(np.abs(d0), np.abs(d1))
            m[i] = np.where(same, np.clip(mi, -lim, lim), 0.0)
        self.m = m
        self.scalar = self.v.shape[1] == 1

    def _segment(self, t: float):
        i = int(np.searchsorted(self.t, t, side="right") - 1)
        h = self.t[i + 1] - self.t[i]
        return i, h, (t - self.t[i]) / h

    def _interp(self, i: int, h: float, s: float) -> np.ndarray:
        h00, h10 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s
        h01, h11 = -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
        return h00 * self.v[i] + h10 * h * self.m[i] + h01 * self.v[i + 1] + h11 * h * self.m[i + 1]

    def __call__(self, t: float):
        if t <= self.t[0]:
            out = self.v[0]
        elif t >= self.t[-1]:
            out = self.v[-1]
        else:
            out = self._interp(*self._segment(t))
        return float(out[0]) if self.scalar else out.copy()


class Spline5(Spline):
    """The same keys and clamped tangents, as a quintic Hermite with zero second derivative at
    every key: C2, so a move never starts, turns or stops with a jolt of acceleration (from and to
    rest it is a smootherstep). The tangent limit is lower: a quintic bulges more between keys."""

    LIMIT = 2.0

    def _interp(self, i: int, h: float, s: float) -> np.ndarray:
        s3, s4, s5 = s ** 3, s ** 4, s ** 5
        h0 = 1 - 10 * s3 + 15 * s4 - 6 * s5
        h1 = s - 6 * s3 + 8 * s4 - 3 * s5
        h4 = -4 * s3 + 7 * s4 - 3 * s5
        h5 = 10 * s3 - 15 * s4 + 6 * s5
        return h0 * self.v[i] + h5 * self.v[i + 1] + h * (h1 * self.m[i] + h4 * self.m[i + 1])


_SPRINGS: dict = {}


def pop(u: float, up: float, down: float) -> float:
    """1 -> 1 + up -> 1 - down -> 1: the landing pop."""
    return _SPRINGS.setdefault(("pop", up, down), Spline(
        ((0.0, 1.0), (0.3, 1.0 + up), (0.64, 1.0 - down), (1.0, 1.0))))(clamp01(u))


def eased_keys(keys, t: float) -> float:
    """Smoothstep transitions between consecutive (t, value) keys, holding outside."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * smoothstep(span(t, t0, t1))
    return keys[-1][1]


def bezier(p0, p1, p2, p3, u: float) -> Vector:
    a = 1.0 - u
    return p0 * a ** 3 + p1 * (3 * a * a * u) + p2 * (3 * a * u * u) + p3 * u ** 3


_ARC_TABLES: dict = {}


def arc_bezier(p0, p1, p2, p3, s: float) -> Vector:
    """The cubic Bezier's point at arc-length fraction s (0..1): an eased s gives an eased speed
    along the path, however unevenly its control points are spread."""
    key = tuple(round(c, 9) for p in (p0, p1, p2, p3) for c in p)
    table = _ARC_TABLES.get(key)
    if table is None:
        us = np.linspace(0.0, 1.0, 513)
        pts = np.array([list(bezier(p0, p1, p2, p3, u)) for u in us])
        cum = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
        table = _ARC_TABLES[key] = (us, cum / cum[-1])
    return bezier(p0, p1, p2, p3, float(np.interp(clamp01(s), table[1], table[0])))


def rot_z(deg: float) -> Quaternion:
    return Quaternion((0.0, 0.0, 1.0), math.radians(deg))


def trs(loc, quat: Quaternion, scale: float) -> Matrix:
    return Matrix.LocRotScale(Vector(loc), quat, Vector((scale, scale, scale)))


# ---------------------------------------------------------------------------------------------
# Motion (analytic, world space). Everything below is a pure function of the story time t.
# ---------------------------------------------------------------------------------------------

class Motion:
    """The story's poses at any time t (seconds), from the parameters above and the built card,
    phone and heart."""

    # heart flight progress: a quick launch out of the dip, a long soft arrival
    _FLY = None
    # card travel progress (arc length) over T_TRAVEL: it lifts off gently, glides, arrives softly
    # just in front of the glass; then it sinks the last millimetres (T_SINK)
    _TRAVEL = None

    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        if Motion._FLY is None:     # C2 (quintic): no jolt of acceleration anywhere on the way
            Motion._FLY = Spline5(((0.0, 0.0), (0.45, 0.5), (1.0, 1.0)))
            # faster along the straight first leg, slower through the turn onto the screen
            Motion._TRAVEL = Spline5(((0.0, 0.0), (0.45, 0.57), (1.0, 1.0)))
        self.card_yaw = Spline(CARD_YAW)
        self.heart_pop = Spline(HEART_POP)
        dock = ctx.objects["Phone_ScreenDock"]
        self.dock_local = dock.matrix_local.copy()
        self.dock_scale = dock.matrix_local.to_scale().x
        self.phone_end = self._phone_pose(PHONE_END_XY, PHONE_END_YAW, PHONE_END_LEAN, 1.0)
        self.dock_end = self.phone_end @ self.dock_local
        # the V's bisector (card space) at the open angle: the heart leaves the fold along it
        a = math.radians(PHI_OPEN)
        b = Vector((0.0, -1.0, 0.0)) + Vector((math.sin(a), math.cos(a), 0.0))
        self.bisector = b.normalized()
        self.card_centre_local = Vector((build_card.L / 2, 0.0, build_card.H / 2))
        self._anchor = None

    # --- card -------------------------------------------------------------------------------
    @staticmethod
    def phi(t: float) -> float:
        if t <= T_OPEN[0]:
            return PHI_TENT
        if t <= T_OPEN[1]:
            return PHI_TENT + (PHI_OVER - PHI_TENT) * smootherstep(span(t, *T_OPEN))
        if t <= T_CLOSE[0]:
            return PHI_OVER + (PHI_OPEN - PHI_OVER) * smootherstep(span(t, T_OPEN[1], T_SETTLE))
        return PHI_OPEN * (1.0 - smootherstep(span(t, *T_CLOSE)))

    def card_ground(self, t: float) -> Matrix:
        """The standing card (turning about its fold line), until it lifts off."""
        return rot_z(self.card_yaw(min(t, T_TRAVEL[0]))).to_matrix().to_4x4()

    def card_anchor(self) -> Vector:
        """The closed card's top centre on its back face (Card space): it lands at the screen's top
        centre, the back towards the glass."""
        if self._anchor is None:
            pts = card_points_local(self.ctx, 0.0)
            self._anchor = Vector(((pts[:, 0].min() + pts[:, 0].max()) / 2, float(pts[:, 1].max()),
                                   float(pts[:, 2].max())))
        return self._anchor

    def card_screen(self, gap: float) -> Matrix:
        """The closed card lying on the screen: the phone's orientation (cover print out of the
        screen), CARD_END_SCALE, its top centre CARD_END_TOP below the display's top edge, its
        back `gap` in front of the glass."""
        target = Vector((0.0, -build_phone.HD - gap, build_phone.DISPLAY_H / 2 - CARD_END_TOP))
        return (self.phone_end @ Matrix.Translation(target) @ Matrix.Scale(CARD_END_SCALE, 4)
                @ Matrix.Translation(-self.card_anchor()))

    def card(self, t: float) -> Matrix:
        if t <= T_TRAVEL[0]:
            return self.card_ground(t)
        c_local = self.card_centre_local
        m0 = self.card_ground(T_TRAVEL[0])
        c0 = m0 @ c_local
        q0 = m0.to_quaternion()
        q3 = self.phone_end.to_quaternion()
        c3 = self.card_screen(CARD_ARRIVE_GAP) @ c_local
        c4 = self.card_screen(CARD_END_GAP) @ c_local
        n = q3 @ Vector((0.0, -1.0, 0.0))                 # out of the screen
        right = q3 @ Vector((1.0, 0.0, 0.0))
        # up off the ground and towards the viewer (along the line of sight, right of the phone),
        # then in from the front right and above (clear of the landed heart) to just in front of
        # the glass; after that it sinks the last millimetres straight into it
        p1 = c0 + Vector(CARD_TRAVEL_P1)
        p2 = c3 + n * CARD_TRAVEL_FRONT + UP * CARD_TRAVEL_UP + right * CARD_TRAVEL_RIGHT
        if t < T_TRAVEL[1]:
            c = arc_bezier(c0, p1, p2, c3, self._TRAVEL(span(t, *T_TRAVEL)))
        else:
            c = c3 + (c4 - c3) * smootherstep(span(t, *T_SINK))
        q = q0.slerp(q3, smootherstep(span(t, T_TRAVEL[0] + 0.08, T_TRAVEL[1] - 0.04)))
        s = 1.0 + (CARD_END_SCALE - 1.0) * smootherstep(
            span(t, T_TRAVEL[0] + 0.03, T_TRAVEL[0] + T_CARD_SHRINK))
        return trs(c, q, 1.0) @ Matrix.Scale(s, 4) @ Matrix.Translation(-c_local)

    # --- phone ------------------------------------------------------------------------------
    @staticmethod
    def _phone_rot(yaw: float, lean: float) -> Quaternion:
        return rot_z(yaw) @ Quaternion((1.0, 0.0, 0.0), math.radians(-lean))

    def _phone_pose(self, xy, yaw: float, lean: float, s: float) -> Matrix:
        """Upright + lean, uniform scale s, its lowest point PHONE_HOVER above the ground."""
        q = self._phone_rot(yaw, lean)
        lowest = min((q @ Vector(c)).z for c in _box_corners(build_phone.BODY_W / 2,
                                                              build_phone.DEPTH / 2,
                                                              build_phone.BODY_H / 2))
        return trs((xy[0], xy[1], PHONE_HOVER - s * lowest), q, s)

    @staticmethod
    def phone_scale(t: float) -> float:
        return max(1e-3, smootherstep(span(t, T_PHONE[0], T_PHONE[1] - 0.12)))

    @staticmethod
    def phone_yaw(t: float) -> float:
        return PHONE_END_YAW + PHONE_TURN * (1.0 - smootherstep(span(t, *T_PHONE)))

    def phone(self, t: float) -> Matrix:
        """Rises screen first: grows out of the ground (its bottom hovering), comes forward from a
        little behind its rest place and turns PHONE_TURN deg to the front."""
        w = smootherstep(span(t, *T_PHONE))
        xy = (PHONE_END_XY[0] + PHONE_START_OFFSET[0] * (1.0 - w),
              PHONE_END_XY[1] + PHONE_START_OFFSET[1] * (1.0 - w))
        return self._phone_pose(xy, self.phone_yaw(t), PHONE_END_LEAN * w, self.phone_scale(t))

    def dock(self, t: float) -> Matrix:
        return self.phone(t) @ self.dock_local

    # --- gift slot ----------------------------------------------------------------------------
    def heart_stand(self, t: float) -> Vector:
        """Out of the fold along the V's bisector, then standing in front of it like a pop-up
        element, floating gently (card space -> world)."""
        m = self.card_ground(t)
        e = smootherstep(span(t, *T_EMERGE))
        r = HEART_R0 + (HEART_OUT - HEART_R0) * e
        local = Vector((0.0015, 0.0, 0.0)) + self.bisector * r
        local.z = HEART_Z0 + (HEART_Z - HEART_Z0) * e
        bob = HOVER_BOB * math.sin(2 * math.pi * (t - T_EMERGE[1]) / BOB_PERIOD)
        bob *= smoothstep(span(t, T_EMERGE[1], T_EMERGE[1] + 0.6))
        bob *= 1.0 - smootherstep(span(t, T_DIP[0] - 0.45, T_DIP[0]))
        # anticipation: sinks a little and is at rest at the bottom when the flight starts
        dip = -DIP * smootherstep(span(t, *T_DIP))
        return m @ local + UP * (bob + dip)

    def heart_rot_stand(self, t: float) -> Quaternion:
        """Facing out of the V (the bisector), i.e. towards the viewer."""
        yaw = self.card_yaw(t) + math.degrees(math.atan2(self.bisector.x, -self.bisector.y))
        return rot_z(yaw)

    def gift(self, t: float) -> Matrix:
        t_pop = HEART_POP[0][0]
        if t < t_pop:
            return trs(self.heart_stand(t_pop), self.heart_rot_stand(t), 1e-5)
        if t <= T_FLY[0]:
            s = HEART_SCALE * max(1e-5, self.heart_pop(t))
            return trs(self.heart_stand(t), self.heart_rot_stand(t), s)
        d = self.dock(t)
        d_loc, d_rot, d_scale = d.decompose()
        if t >= T_LAND:
            p = pop(span(t, *T_LAND_POP), 0.06, 0.015)
            return trs(d_loc, d_rot, d_scale.x * p)
        h0 = self.heart_stand(T_FLY[0])
        n = d_rot @ Vector((0.0, -1.0, 0.0))
        right = d_rot @ Vector((1.0, 0.0, 0.0))
        # up and towards the viewer out of the dip, then in from the front right of the screen,
        # below the message banner
        p1 = h0 + Vector(FLY_P1)
        p2 = d_loc + n * FLY_FRONT + right * FLY_RIGHT + UP * FLY_UP
        pos = arc_bezier(h0, p1, p2, d_loc, self._FLY(span(t, *T_FLY)))
        q = self.heart_rot_stand(T_FLY[0]).slerp(
            d_rot, smootherstep(span(t, T_FLY[0] + 0.05, T_FLY[1] - 0.04)))
        s = HEART_SCALE + (d_scale.x - HEART_SCALE) * smootherstep(span(t, T_FLY[0] + 0.1, T_FLY[1]))
        return trs(pos, q, s)

    # --- shadows, Fx --------------------------------------------------------------------------
    def shadow(self, name: str, t: float) -> Matrix:
        spec = SHADOWS[name]
        cx, cy = spec["centre"]
        if spec["follows"] == "card":
            return self.card_ground(t) @ Matrix.Translation((cx, cy, SHADOW_Z))
        loc = self.phone(t).translation
        return (Matrix.Translation((loc.x, loc.y, SHADOW_Z))
                @ Matrix.Rotation(math.radians(self.phone_yaw(t)), 4, "Z")
                @ Matrix.Scale(self.phone_scale(t), 4) @ Matrix.Translation((cx, cy, 0.0)))

    @staticmethod
    def fx(name: str, t: float) -> float:
        return eased_keys(FX[name], t)


def _box_corners(hx, hy, hz):
    return [(sx * hx, sy * hy, sz * hz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]


# ---------------------------------------------------------------------------------------------
# Projection (the runtime camera: position Cam, lookAt CamTarget, up +Z, square, FOV_DEG)
# ---------------------------------------------------------------------------------------------

def camera_basis(pos: Vector, target: Vector):
    f = (target - pos).normalized()
    r = f.cross(UP).normalized()
    u = r.cross(f)
    return np.array(r), np.array(u), np.array(f)


def project(points: np.ndarray, pos: Vector, target: Vector, fov_deg: float = FOV_DEG) -> np.ndarray:
    """Frame coordinates (x from the left, y from the top, 0..1) and depth of world points."""
    r, u, f = camera_basis(pos, target)
    rel = np.asarray(points, dtype=np.float64) - np.array(pos)
    z = rel @ f
    k = math.tan(math.radians(fov_deg) / 2)
    x = (rel @ r) / (z * k)
    y = (rel @ u) / (z * k)
    return np.stack([0.5 + 0.5 * x, 0.5 - 0.5 * y, z], axis=1)


def view_from(target: Vector, az: float, el: float, dist: float) -> Vector:
    return target + common.view_direction(az, el) * dist


def fit_view(points: np.ndarray, az: float, el: float, fill: float, bias: float = 0.0,
             fill_points: np.ndarray | None = None, vertical_only: bool = False,
             max_extent: float = 0.9) -> tuple[Vector, float]:
    """(target, distance): the points' projected box is centred (lifted by `bias` NDC) and the
    larger half extent of fill_points (default: the points; the vertical one with vertical_only)
    equals `fill`; the camera backs off if any point would then pass max_extent."""
    pts = np.asarray(points, dtype=np.float64)
    fpts = pts if fill_points is None else np.asarray(fill_points, dtype=np.float64)
    target = Vector(((pts.min(0) + pts.max(0)) / 2).tolist())
    dist = 0.5
    k = math.tan(math.radians(FOV_DEG) / 2)

    def extent(p_all, d, height_only):
        """height_only: the points' own height (frame fraction); else the largest distance from
        the frame centre (NDC half extent)."""
        p = project(p_all, view_from(target, az, el, d), target)
        if height_only:
            return p[:, 1].max() - p[:, 1].min()
        ndc = np.abs(np.stack([p[:, 0] - 0.5, p[:, 1] - 0.5 - bias / 2], 1)) * 2
        return ndc.max()

    for _ in range(8):
        lo, hi = 0.05, 5.0
        for _ in range(50):
            dist = 0.5 * (lo + hi)
            too_big = (extent(fpts, dist, vertical_only) > fill
                       or extent(pts, dist, False) > max_extent)
            if too_big:
                lo = dist
            else:
                hi = dist
        dist = hi
        p = project(pts, view_from(target, az, el, dist), target)
        cx = (p[:, 0].min() + p[:, 0].max()) / 2 - 0.5
        cy = (p[:, 1].min() + p[:, 1].max()) / 2 - 0.5 + bias / 2
        r, u, _f = camera_basis(view_from(target, az, el, dist), target)
        target = target + Vector((r * (cx * 2 * dist * k) - u * (cy * 2 * dist * k)).tolist())
    return target, dist


# ---------------------------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------------------------

def build_story(ctx: Ctx) -> None:
    scene = ctx.scene
    scene.name = SCENE_NAME
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.frame_start = 0
    scene.frame_end = FRAME_END
    story = common.collection(STORY_COLL)
    preview = common.collection(PREVIEW_COLL)

    _real_prints(ctx)
    heart = _import_heart(ctx, preview)
    ctx.info["heart_objs"] = heart
    scene.frame_start, scene.frame_end = 0, FRAME_END  # whatever the importer did
    motion = Motion(ctx)
    ctx.info["motion"] = motion
    geo = _geometry(ctx, heart)
    ctx.info["geo"] = geo

    frames = np.arange(FRAME_END + 1)
    times = frames / FPS

    # --- runtime camera -------------------------------------------------------------------------
    cam = common.new_empty("Cam", story, "CONE", 0.02)
    target = common.new_empty("CamTarget", story, "SPHERE", 0.006)
    key_camera(ctx)
    cam["fovDeg"] = FOV_DEG
    cam["aspect"] = ASPECT
    cam["heroFrameRange"] = [0, FRAME_END]
    cam["heroFps"] = FPS
    cam["heroCamera"] = ("runtime camera: position = Cam, lookAt = CamTarget, up = +Z (three.js "
                         "+Y); vertical FOV fovDeg over a square frame (aspect)")

    # --- card, hinge, phone, gift slot -------------------------------------------------------------
    card, hinge = ctx.objects["Card"], ctx.objects["Card_Hinge"]
    _key_matrices(card, frames, [motion.card(t) for t in times])
    hinge.rotation_mode = "XYZ"
    common.key_channel(hinge, "rotation_euler", 2, frames,
                       np.array([-math.radians(motion.phi(t)) for t in times]))
    phone = ctx.objects["Phone"]
    _key_matrices(phone, frames, [motion.phone(t) for t in times])
    slot = common.new_empty("GiftSlot", story, "ARROWS", 1.0)
    slot["heroGiftSlot"] = ("gift pose: up = local +Z, front = local -Y (three.js +Y / +Z); world "
                            "scale s shows the gift s times its billet-unit size")
    _key_matrices(slot, frames, [motion.gift(t) for t in times])
    ctx.objects["GiftSlot"] = slot
    heart["spin"].parent = slot
    heart["spin"].matrix_parent_inverse = Matrix.Identity(4)

    # --- Fx -------------------------------------------------------------------------------------
    fx_objs = {}
    for name in FX:
        e = common.new_empty(f"Fx_{name}", story, "SINGLE_ARROW", 0.02)
        common.key_channel(e, "location", 0, frames, np.array([motion.fx(name, t) for t in times]))
        fx_objs[name] = e
        ctx.objects[e.name] = e

    # --- shadow patches ------------------------------------------------------------------------------
    for name, spec in SHADOWS.items():
        patch = _shadow_patch(ctx, story, name, spec, fx_objs[f"Shadow_{name}"])
        _key_matrices(patch, frames, [motion.shadow(name, t) for t in times])

    # --- materials: card fade, preview screen ----------------------------------------------------------
    _card_fade_drivers(ctx, fx_objs["CardFade"])
    _screen_preview(ctx, fx_objs)

    # --- markers, meta, preview rig ------------------------------------------------------------------
    scene.timeline_markers.clear()
    for beat, t in BEATS:
        scene.timeline_markers.new(f"beat:{beat}", frame=int(round(t * FPS)))
    scene.timeline_markers.new("gate:screens", frame=int(round(T_GATE_SCREENS * FPS)))
    scene.timeline_markers.new("mark:land", frame=int(round(T_LAND * FPS)))
    scene["heroStory"] = json.dumps(story_meta(scene))
    _render_rig(ctx, preview, cam, target)
    scene.frame_set(0)
    log(f"story built: {FRAME_END + 1} frames, {len(scene.timeline_markers)} markers")


def key_camera(ctx: Ctx) -> None:
    """(Re)fits the camera compositions (they include the baked shadows) and keys Cam/CamTarget."""
    motion, geo = ctx.info["motion"], ctx.info["geo"]
    cam_fn = _camera_track(ctx, motion, geo)
    ctx.info["camera"] = cam_fn
    frames = np.arange(FRAME_END + 1)
    poses = [cam_fn(f / FPS) for f in frames]
    common.key_transform(bpy.data.objects["Cam"], frames, loc=np.array([p[0] for p in poses]))
    common.key_transform(bpy.data.objects["CamTarget"], frames, loc=np.array([p[1] for p in poses]))


def _key_matrices(obj, frames, mats) -> None:
    locs, quats, scales = [], [], []
    for m in mats:
        loc, q, s = m.decompose()
        locs.append(loc[:])
        quats.append(q[:])
        scales.append(s[:])
    common.key_transform(obj, frames, np.array(locs), np.array(quats), np.array(scales))


def story_meta(scene) -> dict:
    """scene['heroStory'] from the timeline markers (docs/hero-story.md, 'Scene extras')."""
    fps = scene.render.fps / scene.render.fps_base
    if scene.frame_start != 0:
        raise ValueError("the story must start at frame 0")
    duration = scene.frame_end / fps
    marks = {m.name: m.frame / fps for m in scene.timeline_markers}
    starts = [(b, marks[f"beat:{b}"]) for b, _t in BEATS]
    beats = [{"id": b, "start": round(s, 4),
              "end": round(starts[i + 1][1] if i + 1 < len(starts) else duration, 4)}
             for i, (b, s) in enumerate(starts)]
    cam = bpy.data.objects["Cam"]
    return {"version": 1, "fps": fps, "duration": round(duration, 4), "clip": scene.name,
            "aspect": float(cam["aspect"]), "fovDeg": float(cam["fovDeg"]), "beats": beats,
            "gates": {"screens": round(marks["gate:screens"], 4)},
            "marks": {"land": round(marks["mark:land"], 4)},
            "gift": {"templateId": GIFT_TEMPLATE}}


# ---------------------------------------------------------------------------------------------
# Geometry for framing and checks
# ---------------------------------------------------------------------------------------------

def _geometry(ctx: Ctx, heart: dict) -> dict:
    """Local point sets: card (Card space, per open angle, cached), phone (Phone space), heart
    (GiftSlot space, union of HEART_PHASES poses of its beat loop)."""
    phone_local = np.concatenate([common.mesh_vertices(ctx.objects[n], world=False)
                                  for n in PHONE_MESHES])
    return {"phone": phone_local, "heart": heart["points"], "heart_phases": heart["phases"],
            "heart_tris": heart["tris"], "card_cache": {}}


def card_points_local(ctx: Ctx, phi: float) -> np.ndarray:
    """Card vertices (Card space) at open angle phi (evaluated with the spine), cached per 0.5 deg.
    Needs the Card at identity, i.e. before the story keys (or with them muted)."""
    cache = ctx.info["geo"]["card_cache"]
    key = round(phi * 2) / 2
    if key not in cache:
        hinge = ctx.objects["Card_Hinge"]
        card = ctx.objects["Card"]
        saved = (hinge.rotation_euler.z, card.matrix_world.copy())
        hinge.rotation_euler.z = -math.radians(key)
        bpy.context.view_layer.update()
        inv = card.matrix_world.inverted()
        pts = np.concatenate([common.evaluated_vertices(ctx.objects[n]) for n in CARD_MESHES])
        pts = pts @ np.array(inv.to_3x3()).T + np.array(inv.translation)
        cache[key] = pts
        hinge.rotation_euler.z = saved[0]
        bpy.context.view_layer.update()
    return cache[key]


def _apply(m: Matrix, pts: np.ndarray) -> np.ndarray:
    a = np.array(m)
    return pts @ a[:3, :3].T + a[:3, 3]


def subject_points(ctx: Ctx, motion: Motion, geo: dict, names, t: float) -> np.ndarray:
    out = []
    for n in names:
        if n == "card":
            out.append(_apply(motion.card(t), card_points_local(ctx, motion.phi(t))[::3]))
        elif n == "heart":
            out.append(_apply(motion.gift(t), geo["heart"]))
        elif n == "phone":
            out.append(_apply(motion.phone(t), geo["phone"][::2]))
        elif n == "phone_end":
            out.append(_apply(motion.phone_end, geo["phone"][::2]))
        elif n == "heart_end":
            out.append(_apply(motion.dock_end, geo["heart"]))
        elif n == "shadows":
            for name in SHADOWS:
                pts = shadow_points(name, motion.fx(f"Shadow_{name}", t))
                if len(pts) and shadow_alpha(name) is not None:
                    out.append(_apply(motion.shadow(name, t), pts))
    return np.concatenate(out)


def visible_points(ctx: Ctx, motion: Motion, geo: dict, t: float) -> np.ndarray:
    """World points of everything the runtime shows at time t (subsampled): the card while it has
    not faded, the heart once it popped, the phone once it rises, the visible part of every
    shadow."""
    out = []
    if motion.phone_scale(t) > PHONE_VISIBLE:
        out.append(_apply(motion.phone(t), geo["phone"][::4]))
    if motion.fx("CardFade", t) > 0.001:
        out.append(_apply(motion.card(t), card_points_local(ctx, motion.phi(t))[::3]))
    g = motion.gift(t)
    if g.to_scale().x > 1e-4:
        out.append(_apply(g, geo["heart"][::3]))
    for name in SHADOWS:
        pts = shadow_points(name, motion.fx(f"Shadow_{name}", t))
        if len(pts) and shadow_alpha(name) is not None:
            out.append(_apply(motion.shadow(name, t), pts[::4]))
    return np.concatenate(out)


def _gauss(a: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian smoothing along axis 0, edge values held (sigma in samples)."""
    r = int(math.ceil(4 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    a2 = a.reshape(len(a), -1)
    pad = np.concatenate([np.repeat(a2[:1], r, 0), a2, np.repeat(a2[-1:], r, 0)])
    out = np.stack([np.convolve(pad[:, j], k, mode="valid") for j in range(a2.shape[1])], 1)
    return out.reshape(a.shape)


def _distance_for(pts: np.ndarray, target: Vector, az: float, el: float, extent: float) -> float:
    """Smallest camera distance at which every point lies within `extent` (NDC) of the centre."""
    lo, hi = 0.05, 5.0
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        p = project(pts, view_from(target, az, el, mid), target)
        if p[:, 2].min() > 0 and np.abs(np.stack([p[:, 0], p[:, 1]], 1) - 0.5).max() * 2 <= extent:
            hi = mid
        else:
            lo = mid
    return hi


def camera_composition(ctx: Ctx, motion: Motion, geo: dict, key: dict) -> np.ndarray:
    """A CAMERA_KEYS entry -> (target x, y, z, az, el, log distance)."""
    t, az, el, fill = key["t"], key["az"], key["el"], key["fill"]
    if fill == "rest":
        t = DURATION
    pts = subject_points(ctx, motion, geo, key["subjects"], t)
    if fill in ("rest", "phone_h"):
        phone = subject_points(ctx, motion, geo, ("phone_end",), t)
        target, dist = fit_view(pts, az, el, REST_FILL if fill == "rest" else key["phone_h"],
                                fill_points=phone, vertical_only=True, max_extent=CAMERA_SAFE)
    else:
        target, dist = fit_view(pts, az, el, fill, max_extent=CAMERA_SAFE)
    return np.array([target.x, target.y, target.z, az, el, math.log(dist)])


def _camera_track(ctx: Ctx, motion: Motion, geo: dict):
    """The camera (see CAMERA_KEYS): per-frame params (target xyz, az, el, distance), keyed per
    frame by key_camera."""
    n = FRAME_END + 1
    times = np.arange(n) / FPS
    comps = np.array([camera_composition(ctx, motion, geo, k) for k in CAMERA_KEYS])
    key_t = [k["t"] for k in CAMERA_KEYS]
    splines = [Spline5(list(zip(key_t, comps[:, j]))) for j in range(comps.shape[1])]
    params = np.array([[sp(t) for sp in splines] for t in times])
    params[:, 5] = np.exp(params[:, 5])
    rest = params[-1].copy()
    # safety: never closer than a smooth envelope of the distance that keeps everything visible
    # inside CAMERA_SAFE with this target and angle (dilated, then smoothed; smooth max, no kinks).
    # The keys are composed so that it stays inactive; it only guards the in-betweens.
    pts = [visible_points(ctx, motion, geo, t) for t in times]
    d_safe = np.array([_distance_for(pts[i], Vector(params[i, :3]), params[i, 3], params[i, 4],
                                     CAMERA_SAFE) for i in range(n)])
    sigma_e = CAMERA_ENVELOPE * FPS
    w = int(round(1.5 * sigma_e))
    env = np.array([d_safe[max(0, i - w):i + w + 1].max() for i in range(n)])
    d_e = _gauss(env, sigma_e) * 1.004
    d_c = params[:, 5].copy()
    eps = 0.006                 # m: a soft hand-over between the planned distance and the envelope
    soft = 0.5 * (d_c + d_e + np.sqrt((d_c - d_e) ** 2 + eps ** 2))
    # only where the envelope comes near the plan (elsewhere the soft max would still add up to
    # eps / 2 and shift the composed shots)
    near = np.clip((d_e - (d_c - 3 * eps)) / (3 * eps), 0.0, 1.0)
    near = np.array([smoothstep(x) for x in near])
    params[:, 5] = d_c + (soft - d_c) * near
    ctx.info["camera_keys"] = {
        "keys": [{"t": k["t"], "target": comps[i, :3].tolist(), "az": comps[i, 3],
                  "el": comps[i, 4], "dist": math.exp(comps[i, 5]),
                  "subjects": list(k["subjects"]), "fill": k["fill"]}
                 for i, k in enumerate(CAMERA_KEYS)],
        "rest": {"target": rest[:3].tolist(), "az": rest[3], "el": rest[4], "dist": rest[5]},
        "envelope_active_s": round(float((near > 1e-3).sum()) / FPS, 3),
        "every_second": [{"t": float(times[i]), "target": params[i, :3].tolist(), "az": params[i, 3],
                          "el": params[i, 4], "dist": params[i, 5], "d_planned": float(d_c[i]),
                          "d_safe": float(d_safe[i])} for i in range(0, n, FPS)]}

    def cam(t: float):
        f = t * FPS
        i = int(min(max(math.floor(f), 0), n - 2))
        a = f - i
        v = params[i] * (1 - a) + params[i + 1] * a
        target = Vector(v[:3].tolist())
        return list(view_from(target, v[3], v[4], v[5])), list(target)
    return cam


# ---------------------------------------------------------------------------------------------
# Heart stand-in (the light hero GLB, fitted like the runtime)
# ---------------------------------------------------------------------------------------------

def _heart_glb() -> str:
    found = sorted(glob.glob(os.path.join(FRONTEND_PUBLIC, "hero", "gifts", "beating-heart.*.glb")))
    if len(found) != 1:
        raise FileNotFoundError(f"expected exactly one beating-heart.*.glb in public/hero/gifts, got {found}")
    return found[0]


def _gift_entry() -> dict:
    with open(HERO_GIFTS_JSON, encoding="utf-8") as fh:
        gifts = json.load(fh)["gifts"]
    return next(g for g in gifts if g["templateId"] == GIFT_TEMPLATE)


def _compensate_exposure(mat: bpy.types.Material, factor: float) -> None:
    """The runtime's gift exposure (hero-rig.ts compensate): the material's whole outgoing light -
    diffuse, specular, the glossy rim - times exposure / heroExposure, as a mix with black (a
    Principled BSDF's base colour alone would leave the highlights and the Fresnel rim at full
    strength: a bright halo round the glossy heart). Opaque and dithered like the GLB's OPAQUE
    material, so Eevee sorts nothing."""
    tree = mat.node_tree
    out = common.find_node(tree, "OUTPUT_MATERIAL")
    surf = common.socket(out.inputs, "Surface")
    if surf.is_linked and factor != 1.0:
        src = surf.links[0].from_socket
        black = tree.nodes.new("ShaderNodeEmission")
        common.socket(black.inputs, "Color").default_value = (0.0, 0.0, 0.0, 1.0)
        common.socket(black.inputs, "Strength").default_value = 0.0
        mix = tree.nodes.new("ShaderNodeMixShader")
        mix.name = "HeroExposure"
        mix.inputs[0].default_value = 1.0 - factor
        tree.links.new(src, mix.inputs[1])
        tree.links.new(black.outputs[0], mix.inputs[2])
        tree.links.new(mix.outputs[0], surf)
    for attr, val in (("surface_render_method", "DITHERED"), ("blend_method", "OPAQUE")):
        try:
            setattr(mat, attr, val)
        except (AttributeError, TypeError):
            pass


def _import_heart(ctx: Ctx, coll) -> dict:
    """Imports the light heart under HeartPreview_Spin -> HeartPreview_Fit (collection
    HeroPreview). The fit is the runtime's fitTransform(box, fitSize, yOffset) in billet units:
    largest edge of the rest-pose box -> fitSize, centred, then yOffset along +Z (three.js +Y).
    Its light is scaled by exposure / heroExposure (0.6 / 1) like the runtime's clones
    (_compensate_exposure). Its own animation (beat + half turn) loops. Returns the preview objects
    and the heart's points in GiftSlot space (union of HEART_PHASES poses of the loop) for the
    checks."""
    path = _heart_glb()
    entry = _gift_entry()
    fit_size, y_offset, exposure = (entry["scene"][k] for k in ("fitSize", "yOffset", "exposure"))
    lc = common.layer_collection(coll.name)
    bpy.context.view_layer.active_layer_collection = lc
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    if len(roots) != 1:
        raise RuntimeError(f"heart import: expected one root, got {[o.name for o in roots]}")
    root = roots[0]
    meshes = [o for o in new if o.type == "MESH"]
    names = {root: "HeartPreview_Root"}
    for o in new:
        if o is not root:
            names[o] = "HeartPreview_Mesh" if o.type == "MESH" else f"HeartPreview_{o.name.replace(' ', '_').replace('#', '')}"
    for o, n in names.items():
        o.name = n
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection
    for o in new:  # the importer may add them to the active collection only
        if coll not in o.users_collection:
            coll.objects.link(o)

    # loop the heart's own animation (beat + half turn, 1.625 s)
    loop = None
    for o in new:
        ad = o.animation_data
        if ad and ad.action:
            for fc in common.action_fcurves(ad.action):
                if not any(m.type == "CYCLES" for m in fc.modifiers):
                    fc.modifiers.new("CYCLES")
            loop = ad.action.frame_range[1] - ad.action.frame_range[0]
    if not loop:
        raise RuntimeError("heart import: no animation found")

    # rest-pose box at the loop start (= the glTF rest pose) in the root's space
    ctx.scene.frame_set(0)
    bpy.context.view_layer.update()
    inv_root = root.matrix_world.inverted()
    pts = np.concatenate([_apply(inv_root, common.evaluated_vertices(m)) for m in meshes])
    lo, hi = pts.min(0), pts.max(0)
    size = hi - lo
    centre = (lo + hi) / 2
    max_dim = float(size.max())
    scale = fit_size / max_dim

    spin = common.new_empty("HeartPreview_Spin", coll, "PLAIN_AXES", 0.5)
    fit = common.new_empty("HeartPreview_Fit", coll, "PLAIN_AXES", 0.5, parent=spin)
    fit.location = Vector((-centre * scale).tolist()) + Vector((0.0, 0.0, y_offset))
    fit.scale = (scale, scale, scale)
    root.parent = fit
    root.matrix_parent_inverse = Matrix.Identity(4)
    for mat in {m for o in meshes for m in o.data.materials if m}:
        _compensate_exposure(mat, exposure)
        mat.name = "M_HeartPreview"
    bpy.context.view_layer.update()

    # heart points / triangles in GiftSlot space (spin = identity) for HEART_PHASES loop phases
    phases, all_pts = [], []
    for k in range(HEART_PHASES):
        ctx.scene.frame_set(0, subframe=0.0)
        f = k * loop / HEART_PHASES
        ctx.scene.frame_set(int(f), subframe=f - int(f))
        bpy.context.view_layer.update()
        inv_spin = spin.matrix_world.inverted()
        verts, tris = [], []
        off = 0
        for m in meshes:
            v = _apply(inv_spin, common.evaluated_vertices(m))
            me = m.data
            me.calc_loop_triangles()
            t = np.zeros(len(me.loop_triangles) * 3, dtype=np.int64)
            me.loop_triangles.foreach_get("vertices", t)
            tris.append(t.reshape(-1, 3) + off)
            verts.append(v)
            off += len(v)
        v = np.concatenate(verts)
        phases.append(v)
        all_pts.append(v[::4])
        tri_all = np.concatenate(tris)
    ctx.scene.frame_set(0)
    info = {"file": os.path.relpath(path, FRONTEND_PUBLIC).replace(os.sep, "/"),
            "fitSize": fit_size, "yOffset": y_offset, "exposure": exposure,
            "rest_box_size_blender": size.tolist(), "rest_box_centre_blender": centre.tolist(),
            "max_dim": max_dim, "fit_scale": scale, "loop_frames": loop,
            "fitted_size_billet_units": (size * scale).tolist()}
    ctx.info["heart"] = info
    log(f"heart stand-in: {info['file']}, fit scale {scale:.5f}, loop {loop:.2f} frames")
    return {"spin": spin, "fit": fit, "root": root, "meshes": meshes,
            "points": np.concatenate(all_pts), "phases": phases, "tris": tri_all}


# ---------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------

def _real_prints(ctx: Ctx) -> None:
    """The real Valentinstag DE prints on the card (export.py swaps in 16 x 16 placeholders)."""
    for mat_name, path in (("M_Print_Front", PRINT_FRONT_PNG), ("M_Print_Inside", PRINT_INSIDE_PNG)):
        if not os.path.isfile(path):
            raise FileNotFoundError(f"print capture missing (npm run hero:capture): {path}")
        img = common.load_image(path, "sRGB", os.path.basename(path))
        tex = next(n for n in ctx.materials[mat_name].node_tree.nodes
                   if n.type == "TEX_IMAGE" and n.image is not None and "normal" not in n.image.name)
        tex.image = img


def _fx_driver(socket_owner, prop: str, fx_obj, index: int = -1, expr: str = "clamp(v, 0.0, 1.0)"):
    """Driver: the Fx empty's local X (by ID, simple expression - no Python auto-run needed)."""
    fc = socket_owner.driver_add(prop) if index < 0 else socket_owner.driver_add(prop, index)
    drv = fc.driver
    drv.type = "SCRIPTED"
    for v in list(drv.variables):
        drv.variables.remove(v)
    var = drv.variables.new()
    var.name = "v"
    var.type = "TRANSFORMS"
    var.targets[0].id = fx_obj
    var.targets[0].transform_type = "LOC_X"
    var.targets[0].transform_space = "LOCAL_SPACE"
    drv.expression = expr
    return fc


def _card_fade_drivers(ctx: Ctx, fx) -> None:
    """Preview of the runtime's card fade: Alpha of every card material <- Fx_CardFade (dithered
    in Eevee). export.py removes the drivers and restores alpha 1."""
    for name in build_card.MAT_NAMES:
        mat = ctx.materials[name]
        bsdf = common.find_node(mat.node_tree, "BSDF_PRINCIPLED")
        _fx_driver(common.socket(bsdf.inputs, "Alpha"), "default_value", fx)
        try:
            mat.surface_render_method = "DITHERED"
        except (AttributeError, TypeError):
            pass


def _shadow_image_path(name: str) -> str:
    return common.generated_image_path(f"shadow_{name.lower()}.png")


def shadow_material(name: str, fx_obj=None) -> bpy.types.Material:
    """M_Shadow_<Name>: black, alpha = the baked patch texture (x Fx_Shadow_<Name> in the
    preview, through a driver; export.py links the texture alpha directly)."""
    spec = SHADOWS[name]
    mat, tree, bsdf = common.new_material(f"M_Shadow_{name}")
    for n in list(tree.nodes):
        if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
            tree.nodes.remove(n)
    common.socket(bsdf.inputs, "Base Color").default_value = (0.0, 0.0, 0.0, 1.0)
    common.socket(bsdf.inputs, "Roughness").default_value = 1.0
    common.socket(bsdf.inputs, "Metallic").default_value = 0.0
    path = _shadow_image_path(name)
    if os.path.isfile(path):
        img = common.load_image(path, "sRGB", f"shadow_{name.lower()}")
        img.reload()
    else:
        img = bpy.data.images.get(f"shadow_{name.lower()}") or bpy.data.images.new(
            f"shadow_{name.lower()}", spec["res"][0], spec["res"][1], alpha=True)
        img.generated_color = (0.0, 0.0, 0.0, 0.0)
        log(f"shadow {name}: no baked texture yet (run --stage bake)")
    img.alpha_mode = "STRAIGHT"
    uv = tree.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    uv.location = (-700, 0)
    tex = tree.nodes.new("ShaderNodeTexImage")
    tex.name = "ShadowImage"
    tex.image = img
    tex.extension = "EXTEND"
    tex.location = (-450, 0)
    tree.links.new(common.socket(uv.outputs, "UV"), common.socket(tex.inputs, "Vector"))
    alpha_in = common.socket(bsdf.inputs, "Alpha")
    if fx_obj is not None:
        mul = tree.nodes.new("ShaderNodeMath")
        mul.name = "FxFade"
        mul.operation = "MULTIPLY"
        mul.location = (-150, -150)
        tree.links.new(common.socket(tex.outputs, "Alpha"), mul.inputs[0])
        _fx_driver(mul.inputs[1], "default_value", fx_obj)
        tree.links.new(mul.outputs[0], alpha_in)
    else:
        tree.links.new(common.socket(tex.outputs, "Alpha"), alpha_in)
    try:
        mat.surface_render_method = "BLENDED"
    except (AttributeError, TypeError):
        pass
    mat.use_backface_culling = True
    return mat


def _shadow_patch(ctx: Ctx, coll, name: str, spec: dict, fx_obj) -> bpy.types.Object:
    w, d = spec["size"]
    me = bpy.data.meshes.new(f"Shadow_{name}")
    me.from_pydata([(-w / 2, -d / 2, 0.0), (w / 2, -d / 2, 0.0), (w / 2, d / 2, 0.0),
                    (-w / 2, d / 2, 0.0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    uv.data.foreach_set("uv", np.array([0, 0, 1, 0, 1, 1, 0, 1], dtype=np.float32))
    me.materials.append(shadow_material(name, fx_obj))
    obj = common.new_mesh_object(f"Shadow_{name}", me, coll)
    obj["heroShadow"] = {"fx": f"Fx_Shadow_{name}", "follows": spec["follows"],
                         "bakedPoseTime": spec["ref_t"]}
    ctx.objects[obj.name] = obj
    return obj


def _screen_preview(ctx: Ctx, fx: dict) -> None:
    """M_ScreenPreview on Phone_Screen: the runtime's screen shader rebuilt with nodes, driven by
    Fx_Wake / Fx_Notif / Fx_Billet (hero-screen-material.ts): lock -> banner sliding down from
    above the top edge (358 x 120 CSS px, 16 px below the top) -> billet crossfade, x wake.
    Blender v = 1 is the top of the screen; the screen capture runs past the 844 px window, the
    mapping shows its top window only. M_Screen (the placeholder) stays for the export."""
    screen = ctx.objects["Phone_Screen"]
    placeholder = ctx.materials[build_phone.SCREEN_MAT]
    placeholder.use_fake_user = True
    mat, tree, bsdf = common.new_material("M_ScreenPreview")
    common.socket(bsdf.inputs, "Base Color").default_value = (0.0, 0.0, 0.0, 1.0)
    common.socket(bsdf.inputs, "Roughness").default_value = 0.06
    common.socket(bsdf.inputs, "Emission Strength").default_value = 1.0
    mat.use_backface_culling = True
    N = tree.nodes
    L = tree.links

    def node(kind, x, y, **props):
        n = N.new(kind)
        n.location = (x, y)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def math_node(op, a, b, x, y):
        n = node("ShaderNodeMath", x, y, operation=op)
        for i, v in enumerate((a, b)):
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]

    uvn = node("ShaderNodeUVMap", -1800, 0, uv_map="UVMap")
    sep = node("ShaderNodeSeparateXYZ", -1600, 0)
    L.new(common.socket(uvn.outputs, "UV"), sep.inputs[0])
    u, vb = sep.outputs[0], sep.outputs[1]

    values = {}
    for i, name in enumerate(("Wake", "Notif", "Billet")):
        val = node("ShaderNodeValue", -1600, -400 - 120 * i, name=f"Fx_{name}", label=f"Fx_{name}")
        _fx_driver(val.outputs[0], "default_value", fx[name])
        values[name] = val.outputs[0]

    def image_node(path, name, x, y, extension):
        img = common.load_image(path, "sRGB", name)
        img.alpha_mode = "STRAIGHT"
        return node("ShaderNodeTexImage", x, y, image=img, extension=extension, name=name, label=name)

    # lock screen: exactly the 390 x 844 window
    lock = image_node(LOCK_PNG, "screen_lock", -600, 300, "EXTEND")
    L.new(common.socket(uvn.outputs, "UV"), common.socket(lock.inputs, "Vector"))

    # billet screen: the capture's top 844 px window (v_img = 1 - (1 - vb) * k)
    bil_img = common.load_image(SCREEN_PNG, "sRGB", "screen_billet")
    w_px, h_px = bil_img.size
    k = (build_phone.CSS_H * w_px / build_phone.CSS_W) / h_px
    vimg = math_node("MULTIPLY_ADD", math_node("SUBTRACT", 1.0, vb, -1300, -100), -k, -1100, -100)
    vimg.node.inputs[2].default_value = 1.0
    comb = node("ShaderNodeCombineXYZ", -900, -100)
    L.new(u, comb.inputs[0])
    L.new(vimg, comb.inputs[1])
    billet = image_node(SCREEN_PNG, "screen_billet", -600, -100, "EXTEND")
    L.new(comb.outputs[0], common.socket(billet.inputs, "Vector"))

    # banner: bu = (u - bx) / bw, bv = (vg - (by - slide)) / bh, slide = (1 - notif) (by + bh),
    # vg = 1 - vb; sampled at (bu, 1 - bv), CLIP = transparent outside
    bw = BANNER_CSS[0] / build_phone.CSS_W
    bh = BANNER_CSS[1] / build_phone.CSS_H
    bx = (1 - bw) / 2
    by = BANNER_CSS[2] / build_phone.CSS_H
    bu = math_node("DIVIDE", math_node("SUBTRACT", u, bx, -1300, -600), bw, -1100, -600)
    slide = math_node("MULTIPLY", math_node("SUBTRACT", 1.0, values["Notif"], -1300, -800),
                      by + bh, -1100, -800)
    vg = math_node("SUBTRACT", 1.0, vb, -1300, -950)
    top = math_node("SUBTRACT", by, slide, -900, -850)
    bv = math_node("DIVIDE", math_node("SUBTRACT", vg, top, -750, -900), bh, -600, -900)
    bv_img = math_node("SUBTRACT", 1.0, bv, -450, -900)
    comb2 = node("ShaderNodeCombineXYZ", -300, -700)
    L.new(bu, comb2.inputs[0])
    L.new(bv_img, comb2.inputs[1])
    notif = image_node(NOTIF_PNG, "screen_notification", -100, -600, "CLIP")
    L.new(comb2.outputs[0], common.socket(notif.inputs, "Vector"))

    # lock' = mix(lock, banner, banner.a * notif); screen = mix(lock', billet, billet fx) * wake
    fac = math_node("MULTIPLY", common.socket(notif.outputs, "Alpha"), values["Notif"], 150, -500)
    mix1 = node("ShaderNodeMix", 350, 200, data_type="RGBA", blend_type="MIX")
    L.new(fac, mix1.inputs["Factor"])
    L.new(common.socket(lock.outputs, "Color"), mix1.inputs[6])
    L.new(common.socket(notif.outputs, "Color"), mix1.inputs[7])
    mix2 = node("ShaderNodeMix", 550, 100, data_type="RGBA", blend_type="MIX")
    L.new(values["Billet"], mix2.inputs["Factor"])
    L.new(mix1.outputs[2], mix2.inputs[6])
    L.new(common.socket(billet.outputs, "Color"), mix2.inputs[7])
    wake = node("ShaderNodeMix", 750, 0, data_type="RGBA", blend_type="MULTIPLY")
    wake.inputs["Factor"].default_value = 1.0
    L.new(mix2.outputs[2], wake.inputs[6])
    wcol = node("ShaderNodeCombineColor", 550, -250)
    for i in range(3):
        L.new(values["Wake"], wcol.inputs[i])
    L.new(wcol.outputs[0], wake.inputs[7])

    # + the runtime's faint glass sheen, after the wake (the black glass shows it too):
    # band = u 0.7 + v_top 0.3 + view.x 0.8 - 0.5; sheen = 0.03 exp(-band^2 / 0.02) +
    # 0.05 (1 - |n.view|)^4, view = towards the camera in view space
    geom = node("ShaderNodeNewGeometry", 150, -1100)
    incoming = common.socket(geom.outputs, "Incoming")
    vt = node("ShaderNodeVectorTransform", 350, -1100, vector_type="VECTOR",
              convert_from="WORLD", convert_to="CAMERA")
    L.new(incoming, vt.inputs[0])
    view = node("ShaderNodeSeparateXYZ", 550, -1100)
    L.new(vt.outputs[0], view.inputs[0])
    band = math_node("ADD", math_node("MULTIPLY", u, 0.7, 350, -1300),
                     math_node("MULTIPLY", vg, 0.3, 350, -1400), 550, -1300)
    band = math_node("ADD", band, math_node("MULTIPLY", view.outputs[0], 0.8, 750, -1200), 750, -1300)
    band = math_node("SUBTRACT", band, 0.5, 900, -1300)
    glow = math_node("EXPONENT", math_node("MULTIPLY", math_node("MULTIPLY", band, band, 1050, -1300),
                                           -50.0, 1200, -1300), 0.0, 1350, -1300)
    dot = node("ShaderNodeVectorMath", 350, -1550, operation="DOT_PRODUCT")
    L.new(common.socket(geom.outputs, "Normal"), dot.inputs[0])
    L.new(incoming, dot.inputs[1])
    grazing = math_node("SUBTRACT", 1.0, math_node("ABSOLUTE", dot.outputs["Value"], 0.0, 550, -1550),
                        750, -1550)
    grazing = math_node("POWER", grazing, 4.0, 900, -1550)
    sheen = math_node("ADD", math_node("MULTIPLY", glow, 0.03, 1500, -1300),
                      math_node("MULTIPLY", grazing, 0.05, 1050, -1550), 1650, -1400)
    scol = node("ShaderNodeCombineColor", 1800, -1400)
    for i in range(3):
        L.new(sheen, scol.inputs[i])
    lit = node("ShaderNodeMix", 950, 0, data_type="RGBA", blend_type="ADD")
    lit.inputs["Factor"].default_value = 1.0
    L.new(wake.outputs[2], lit.inputs[6])
    L.new(scol.outputs[0], lit.inputs[7])
    L.new(lit.outputs[2], common.socket(bsdf.inputs, "Emission Color"))
    bsdf.location = (1200, 0)
    screen.data.materials[0] = mat
    ctx.materials["M_ScreenPreview"] = mat


# ---------------------------------------------------------------------------------------------
# Preview rig: render camera, studio lights, world
# ---------------------------------------------------------------------------------------------

def _render_rig(ctx: Ctx, coll, cam_empty, target_empty) -> None:
    """RenderCam follows Cam / CamTarget (Copy Location + Track To, up = +Z, like the runtime's
    lookAt with up +Y) with the authored vertical FOV. A soft product-film studio: a warm key
    softbox from the upper right front (where the runtime's key light comes from), a cool fill
    from the left, a rim strip behind, a soft top light and a gradient world for reflections."""
    scene = ctx.scene
    cd = bpy.data.cameras.new("RenderCam")
    cd.sensor_fit = "VERTICAL"
    cd.sensor_height = 24.0
    cd.angle_y = math.radians(FOV_DEG)
    cd.clip_start = 0.01
    cd.clip_end = 20.0
    rc = bpy.data.objects.new("RenderCam", cd)
    coll.objects.link(rc)
    c1 = rc.constraints.new("COPY_LOCATION")
    c1.target = cam_empty
    c2 = rc.constraints.new("TRACK_TO")
    c2.target = target_empty
    c2.track_axis = "TRACK_NEGATIVE_Z"
    c2.up_axis = "UP_Y"
    scene.camera = rc
    ctx.objects["RenderCam"] = rc

    centre = Vector((0.0, -0.06, 0.1))

    def area(name, offset, size, size_y, power, color, shape="RECTANGLE"):
        ld = bpy.data.lights.new(name, "AREA")
        ld.shape = shape
        ld.size = size
        if shape == "RECTANGLE":
            ld.size_y = size_y
        ld.energy = power
        ld.color = color
        if hasattr(ld, "use_shadow_jitter"):
            ld.use_shadow_jitter = True
        ob = bpy.data.objects.new(name, ld)
        coll.objects.link(ob)
        ob.location = centre + Vector(offset)
        common.look_at(ob, centre)
        return ob

    # white paper under ~1 unit of irradiance shows its own colour: a W area light at d metres
    # gives about W / (pi d^2); key + fill + top + world stay near that on the front faces. The key
    # dominates (the open card's two pages differ in value, its fold and edges catch light); a
    # strip behind and a low kicker from the left rim the card's top edge and the phone's frame.
    area("Story_Key", (0.55, -0.62, 0.62), 1.0, 0.75, 13.5, (1.0, 0.975, 0.95))
    area("Story_Fill", (-0.75, -0.45, 0.22), 0.9, 0.7, 2.3, (0.95, 0.97, 1.0))
    area("Story_Rim", (-0.15, 0.7, 0.5), 1.1, 0.14, 9.0, (1.0, 1.0, 1.0))
    area("Story_Kicker", (-0.42, 0.2, 0.14), 0.5, 0.1, 4.0, (0.96, 0.97, 1.0))
    area("Story_Top", (0.05, 0.05, 0.95), 0.9, 0.9, 2.0, (1.0, 1.0, 1.0), shape="DISK")

    world = bpy.data.worlds.new("StoryWorld")
    scene.world = world
    try:
        world.use_nodes = True
    except (AttributeError, TypeError):
        pass
    tree = world.node_tree
    bg = common.find_node(tree, "BACKGROUND")
    tc = tree.nodes.new("ShaderNodeTexCoord")
    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    tree.links.new(tc.outputs["Generated"], sep.inputs[0])
    mr = tree.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -0.3
    mr.inputs["From Max"].default_value = 0.8
    tree.links.new(sep.outputs[2], mr.inputs["Value"])
    tree.links.new(mr.outputs[0], ramp.inputs[0])
    ramp.color_ramp.elements[0].color = common.hex_to_linear("#5c5e66")
    ramp.color_ramp.elements[1].color = common.hex_to_linear("#f3f3f6")
    tree.links.new(ramp.outputs[0], common.socket(bg.inputs, "Color"))
    common.socket(bg.inputs, "Strength").default_value = 0.4


# ---------------------------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------------------------

_SHADOW_ALPHA: dict = {}


def shadow_alpha(name: str) -> np.ndarray | None:
    """The baked patch's alpha [rows bottom-up = v up, cols], None when nothing is baked yet."""
    path = _shadow_image_path(name)
    if not os.path.isfile(path):
        return None
    stamp = os.path.getmtime(path)
    cached = _SHADOW_ALPHA.get(name)
    if cached is None or cached[0] != stamp:
        img = bpy.data.images.load(path, check_existing=False)
        a = common.image_to_numpy(img)[:, :, 3].astype(np.float64)
        bpy.data.images.remove(img)
        _SHADOW_ALPHA[name] = cached = (stamp, a)
    return cached[1]


def shadow_points(name: str, fx: float) -> np.ndarray:
    """Patch-local points of the part of the shadow that is visible at strength fx (alpha x fx >
    SHADOW_VISIBLE); the quad's corners when nothing is baked yet."""
    w, d = SHADOWS[name]["size"]
    a = shadow_alpha(name)
    if a is None:
        return np.array([(-w / 2, -d / 2, 0), (w / 2, -d / 2, 0), (w / 2, d / 2, 0), (-w / 2, d / 2, 0)])
    if fx <= SHADOW_VISIBLE:
        return np.zeros((0, 3))
    rows, cols = np.nonzero(a * fx > SHADOW_VISIBLE)
    if not len(rows):
        return np.zeros((0, 3))
    h, wpx = a.shape
    u = (cols + 0.5) / wpx
    v = (rows + 0.5) / h
    sel = np.linspace(0, len(u) - 1, min(len(u), 3000)).astype(int)
    return np.stack([(u[sel] - 0.5) * w, (v[sel] - 0.5) * d, np.zeros(len(sel))], 1)


def _world_tris(objs) -> tuple[np.ndarray, np.ndarray]:
    verts, tris, off = [], [], 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        try:
            co = np.zeros(len(me.vertices) * 3)
            me.vertices.foreach_get("co", co)
            co = _apply(ev.matrix_world, co.reshape(-1, 3))
            me.calc_loop_triangles()
            t = np.zeros(len(me.loop_triangles) * 3, dtype=np.int64)
            me.loop_triangles.foreach_get("vertices", t)
        finally:
            ev.to_mesh_clear()
        verts.append(co)
        tris.append(t.reshape(-1, 3) + off)
        off += len(co)
    return np.concatenate(verts), np.concatenate(tris)


def _bvh(verts: np.ndarray, tris: np.ndarray) -> BVHTree:
    return BVHTree.FromPolygons(verts.tolist(), tris.tolist(), epsilon=0.0)


def _min_dist(a_pts: np.ndarray, b_bvh: BVHTree, limit: float) -> float:
    best = limit
    for p in a_pts:
        hit = b_bvh.find_nearest(Vector(p), best)
        if hit[0] is not None and hit[3] < best:
            best = hit[3]
    return best


def _hull(p: np.ndarray) -> np.ndarray:
    """Convex hull (counter-clockwise, monotone chain) of 2D points."""
    pts = np.unique(np.round(p, 9), axis=0)
    pts = pts[np.lexsort((pts[:, 1], pts[:, 0]))]
    if len(pts) < 3:
        return pts

    def turn(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def half(seq):
        out = []
        for q in seq:
            while len(out) >= 2 and turn(out[-2], out[-1], q) <= 0:
                out.pop()
            out.append(q)
        return out
    lower, upper = half(pts), half(pts[::-1])
    return np.array(lower[:-1] + upper[:-1])


def _outside(poly: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """How far each 2D point lies outside a convex counter-clockwise polygon (0 inside)."""
    a, b = poly, np.roll(poly, -1, axis=0)
    e = b - a
    ln = np.linalg.norm(e, axis=1)
    # signed distance to each edge's line, positive outside (the interior is on the left)
    d = ((pts[:, None, 0] - a[None, :, 0]) * e[None, :, 1]
         - (pts[:, None, 1] - a[None, :, 1]) * e[None, :, 0]) / ln[None, :]
    return np.clip(d.max(axis=1), 0.0, None)


def heart_facing_deg(pts: np.ndarray, cam_pos: Vector) -> float:
    """How far the heart is turned from face-on, seen from the camera (0 = its broad side faces
    the camera, 90 = edge-on): the angle between the horizontal view direction and the normal of
    the heart's width axis (the major axis of its vertices in the ground plane)."""
    xy = pts[:, :2] - pts[:, :2].mean(0)
    w = np.linalg.eigh(xy.T @ xy)[1][:, -1]
    c = np.array(cam_pos)[:2] - pts[:, :2].mean(0)
    c /= np.linalg.norm(c)
    return float(math.degrees(math.asin(min(1.0, abs(float(c @ w))))))


def _banner_local() -> np.ndarray:
    """The message banner's corners on the display (Phone space, the glass plane)."""
    bw, bh = BANNER_CSS[0] / build_phone.CSS_W, BANNER_CSS[1] / build_phone.CSS_H
    bx, by = (1 - bw) / 2, BANNER_CSS[2] / build_phone.CSS_H
    W, H = build_phone.DISPLAY_W, build_phone.DISPLAY_H
    return np.array([(-W / 2 + u * W, -build_phone.HD, H / 2 - v * H)
                     for u, v in ((bx, by), (bx + bw, by), (bx + bw, by + bh), (bx, by + bh))])


def check_story(ctx: Ctx) -> tuple[bool, dict]:
    """Per frame: every visible exported mesh and the heart stand-in inside FRAME_RULE of the
    runtime frame (Cam / CamTarget, FOV_DEG, square); no interpenetration and the minimum distances
    between card, heart and phone; the message banner unobstructed until the billet crossfade; the
    card inside the display outline while it dissolves and never behind the phone while it
    covers it; the heart's facing and headroom; the camera's speed. Then the landing (GiftSlot ==
    Phone_ScreenDock), the rest pose (phone 70-80 % of the frame height, the heart centred on the
    display with a margin), the message beat's phone size, the gate, smoothness, markers."""
    scene = ctx.scene
    motion: Motion = ctx.info["motion"]
    geo = ctx.info["geo"]
    fails: list[str] = []
    res: dict = {}

    def expect(cond, msg):
        if not cond:
            fails.append(msg)

    objs = ctx.objects
    cam, target, slot, phone = (bpy.data.objects[n] for n in ("Cam", "CamTarget", "GiftSlot", "Phone"))
    dock = objs["Phone_ScreenDock"]
    phone_local = {n: common.mesh_vertices(objs[n], world=False) for n in PHONE_MESHES}
    screen_local = phone_local["Phone_Screen"]
    banner_local = _banner_local()
    heart_pts = geo["heart"]
    heart_meshes = ctx.info["heart_objs"]["meshes"]
    lo_rule, hi_rule = FRAME_RULE
    t_fade_end = T_CARD_FADE[1]

    per_frame = []
    worst = {"margin": 1.0, "frame": None, "object": None}
    violations = []
    dist_min = {"card_heart": (math.inf, None), "card_phone": (math.inf, None),
                "heart_phone": (math.inf, None)}
    overlaps = []
    track = {n: [] for n in ("Cam", "CamTarget", "GiftSlot", "Phone", "Card")}
    heart_tris = geo["heart_tris"]
    banner_hits, card_out, card_behind, facing, heart_top, phone_h = [], [], [], [], [], []
    card_clear = False
    for f in range(FRAME_END + 1):
        scene.frame_set(f)
        t = f / FPS
        cpos, tpos = cam.matrix_world.translation.copy(), target.matrix_world.translation.copy()
        for n, o in (("Cam", cam), ("CamTarget", target), ("GiftSlot", slot), ("Phone", phone)):
            track[n].append(np.array(o.matrix_world.translation))
        track["Card"].append(np.array(objs["Card"].matrix_world @ motion.card_centre_local))
        fade = objs["Fx_CardFade"].location.x
        slot_scale = slot.matrix_world.to_scale().x
        phone_scale = phone.matrix_world.to_scale().x
        pm = phone.matrix_world
        groups = {}
        if fade > 0.001:
            groups["card"] = np.concatenate([common.evaluated_vertices(objs[n]) for n in CARD_MESHES])
        if phone_scale > PHONE_VISIBLE:
            groups["phone"] = np.concatenate([_apply(pm, phone_local[n]) for n in PHONE_MESHES])
        if slot_scale > 1e-4:
            groups["heart"] = _apply(slot.matrix_world, heart_pts)
        for n in SHADOWS:
            pts = shadow_points(n, objs[f"Fx_Shadow_{n}"].location.x)
            if len(pts):
                groups[f"shadow_{n}"] = _apply(objs[f"Shadow_{n}"].matrix_world, pts)
        entry = {"t": round(t, 3)}
        proj = {}
        for g, pts in groups.items():
            p = project(pts, cpos, tpos)
            if (p[:, 2] <= 0).any():
                violations.append({"frame": f, "object": g, "behind_camera": True})
                continue
            proj[g] = p
            b = [float(p[:, 0].min()), float(p[:, 1].min()), float(p[:, 0].max()), float(p[:, 1].max())]
            margin = min(b[0] - lo_rule, b[1] - lo_rule, hi_rule - b[2], hi_rule - b[3])
            entry[g] = [round(x, 4) for x in b]
            if margin < worst["margin"]:
                worst = {"margin": margin, "frame": f, "t": round(t, 3), "object": g}
            if margin < 0:
                violations.append({"frame": f, "t": round(t, 3), "object": g, "bounds": entry[g]})
        per_frame.append(entry)

        # --- composition: headroom, the phone's size, the heart's facing -------------------------
        if "heart" in proj:
            heart_top.append((round(t, 3), float(proj["heart"][:, 1].min())))
            hp = np.concatenate([common.evaluated_vertices(m) for m in heart_meshes])
            facing.append((round(t, 3), heart_facing_deg(hp, cpos)))
        if "phone" in proj:
            body = project(_apply(pm, phone_local["Phone_Body"]), cpos, tpos)
            phone_h.append((round(t, 3), float(body[:, 1].max() - body[:, 1].min())))

        # --- the phone's display: banner, card landing, depth order ------------------------------
        if "phone" in groups:
            n_out = pm.to_quaternion() @ Vector((0.0, -1.0, 0.0))
            plane = pm @ Vector((0.0, -build_phone.HD, 0.0))

            def in_front(pts):
                return (pts - np.array(plane)) @ np.array(n_out) > 0.0
            if T_NOTIF[1] - 1e-6 <= t < T_BILLET[0]:
                quad = _hull(project(_apply(pm, banner_local), cpos, tpos)[:, :2])
                for g in ("heart", "card"):
                    if g in proj:
                        hit = (_outside(quad, proj[g][:, :2]) <= 0.0) & in_front(groups[g])
                        if hit.any():
                            banner_hits.append({"t": round(t, 3), "object": g, "points": int(hit.sum())})
            if "card" in proj and t >= T_TRAVEL[0]:
                # the open card stands partly behind the phone until its cover has swung away; once
                # it has been clear of the phone, it may only cover it from in front (no depth flip)
                hull = _hull(project(_apply(pm, np.concatenate(list(phone_local.values()))),
                                     cpos, tpos)[:, :2])
                covered = _outside(hull, proj["card"][:, :2]) <= 0.0
                behind = covered & ~in_front(groups["card"])
                if not covered.any():
                    card_clear = True
                elif behind.any() and card_clear:
                    card_behind.append({"t": round(t, 3), "points": int(behind.sum())})
                if t >= T_CARD_FADE[0] - 0.2:
                    scr = _hull(project(_apply(pm, screen_local), cpos, tpos)[:, :2])
                    out = float(_outside(scr, proj["card"][:, :2]).max())
                    card_out.append((round(t, 3), out))

        # --- distances / interpenetration where things come close ---------------------------------
        need = []
        if "card" in groups and "heart" in groups:
            need.append(("card_heart", "card", "heart"))
        if "card" in groups and "phone" in groups:
            need.append(("card_phone", "card", "phone"))
        if "heart" in groups and "phone" in groups:
            need.append(("heart_phone", "heart", "phone"))
        for key, a, b in need:
            pa, pb = groups[a], groups[b]
            ca, cb = (pa.min(0) + pa.max(0)) / 2, (pb.min(0) + pb.max(0)) / 2
            ra = np.linalg.norm(pa - ca, axis=1).max()
            rb = np.linalg.norm(pb - cb, axis=1).max()
            gap = np.linalg.norm(ca - cb) - ra - rb
            if gap > 0.03:
                continue
            meshes = {}
            if "card" in (a, b):
                meshes["card"] = _world_tris([objs[n] for n in CARD_MESHES])
            if "phone" in (a, b):
                meshes["phone"] = _world_tris([objs[n] for n in PHONE_MESHES])
            heart_list = []
            if "heart" in (a, b):
                m = np.array(slot.matrix_world)
                heart_list = [(ph @ m[:3, :3].T + m[:3, 3], heart_tris) for ph in geo["heart_phases"]]
            sets_a = heart_list if a == "heart" else [meshes[a]]
            sets_b = heart_list if b == "heart" else [meshes[b]]
            best = dist_min[key][0]
            for va, ta in sets_a:
                bvh_a = _bvh(va, ta)
                for vb_, tb in sets_b:
                    bvh_b = _bvh(vb_, tb)
                    ov = bvh_a.overlap(bvh_b)
                    if ov:
                        overlaps.append({"frame": f, "t": round(t, 3), "pair": key, "triangle_pairs": len(ov)})
                        best = -1.0
                        continue
                    d = min(_min_dist(va[::3], bvh_b, 0.05), _min_dist(vb_[::3], bvh_a, 0.05))
                    if d < best:
                        best = d
            if best < dist_min[key][0]:
                dist_min[key] = (best, round(t, 3))

    res["frame_rule"] = {"range": list(FRAME_RULE), "fovDeg": FOV_DEG, "aspect": ASPECT,
                         "worst": {**worst, "margin": round(worst["margin"], 4)},
                         "violations": violations[:40], "violation_count": len(violations),
                         "every_half_second": [e for i, e in enumerate(per_frame) if i % 15 == 0]}
    expect(not violations, f"frame rule: {len(violations)} frame/object(s) outside {FRAME_RULE}")
    res["distances_mm"] = {k: {"min": None if v[0] == math.inf else round(v[0] * 1000, 3), "t": v[1]}
                           for k, v in dist_min.items()}
    res["overlaps"] = {"count": len(overlaps), "first": overlaps[:20]}
    expect(not overlaps, f"interpenetration in {len(overlaps)} frame(s)")
    for k, v in dist_min.items():
        expect(v[0] > 0, f"{k} touching or intersecting (min distance {v[0]})")

    # --- the message beat ----------------------------------------------------------------------
    res["banner"] = {"window": [T_NOTIF[1], T_BILLET[0]], "hits": banner_hits[:20],
                     "hit_frames": len(banner_hits),
                     "unobstructed_before_launch_s": round(T_FLY[0] - T_NOTIF[1], 3)}
    expect(not banner_hits, f"heart or card over the message banner before the billet ({len(banner_hits)})")
    expect(T_FLY[0] - T_NOTIF[1] >= 0.5 - 1e-6, "the message is held less than 0.5 s before the heart launches")
    ph = dict(phone_h)
    res["phone_height_fraction"] = {str(k): round(ph[k], 4) for k in sorted(ph) if abs(k * 10 - round(k * 10)) < 1e-6}
    t_msg = 7.8
    expect(ph.get(t_msg, 0.0) >= 0.6, f"the phone is only {ph.get(t_msg, 0.0):.3f} of the frame height at {t_msg} s")

    # --- the card's landing ----------------------------------------------------------------------
    res["card_landing"] = {"outside_display_max": round(max((o for _t, o in card_out), default=0.0), 5),
                           "from_t": round(T_CARD_FADE[0] - 0.2, 3), "samples": card_out[::3],
                           "behind_phone_while_covering": card_behind[:20]}
    expect(max((o for _t, o in card_out), default=0.0) <= 0.0015,
           "the card leaves the display outline while it dissolves")
    expect(not card_behind, f"the card passes behind the phone while it covers it ({len(card_behind)})")

    # --- heart: facing at its two moments, headroom -------------------------------------------------
    fac = dict(facing)
    t_peak = max(HEART_POP, key=lambda k: k[1])[0]
    moments = {"pop_peak": round(t_peak, 3), "land": round(T_LAND, 3)}
    near = {k: min(fac, key=lambda x: abs(x - v)) for k, v in moments.items()}
    res["heart_facing_deg"] = {"moments": {k: {"t": near[k], "deg": round(fac[near[k]], 2)}
                                           for k in moments},
                               "every_tenth": [(t, round(a, 1)) for t, a in facing[::3]]}
    for k in moments:
        expect(fac[near[k]] <= 30.0, f"the heart is {fac[near[k]]:.0f} deg from face-on at its {k}")
    pop_window = (HEART_POP[1][0], HEART_POP[3][0])
    tops = [(t, y) for t, y in heart_top if not pop_window[0] <= t <= pop_window[1]]
    top_min = min(tops, key=lambda x: x[1]) if tops else (None, 1.0)
    res["heart_headroom"] = {"min_top": round(top_min[1], 4), "t": top_min[0],
                             "outside_pop": list(pop_window)}
    expect(top_min[1] >= 0.09, f"the heart comes within {top_min[1]:.3f} of the frame top")

    # --- landing: GiftSlot's world transform equals the dock's from the end of the pop on ---------
    land_err = {"pos_mm": 0.0, "rot_deg": 0.0, "scale_rel": 0.0}
    for f in range(int(math.ceil(T_LAND_POP[1] * FPS)), FRAME_END + 1):
        scene.frame_set(f)
        a, b = slot.matrix_world, dock.matrix_world
        la, qa, sa = a.decompose()
        lb, qb, sb = b.decompose()
        land_err["pos_mm"] = max(land_err["pos_mm"], (la - lb).length * 1000)
        land_err["rot_deg"] = max(land_err["rot_deg"], math.degrees(qa.rotation_difference(qb).angle))
        land_err["scale_rel"] = max(land_err["scale_rel"], abs(sa.x / sb.x - 1))
    scene.frame_set(int(round(T_LAND * FPS)))
    at_land = (slot.matrix_world.translation - dock.matrix_world.translation).length * 1000
    res["landing"] = {"land_t": T_LAND, "slot_to_dock_at_land_mm": round(at_land, 4),
                      "after_pop_max_error": rnd(land_err, 6),
                      "dock_scale": round(dock.matrix_world.to_scale().x, 6)}
    expect(land_err["pos_mm"] < 1e-3 and land_err["rot_deg"] < 1e-3 and land_err["scale_rel"] < 1e-5,
           "GiftSlot != Phone_ScreenDock after the landing")
    expect(at_land < 0.01, "the heart is not at the dock at mark:land")

    # --- rest pose (the idle composition) -------------------------------------------------------
    scene.frame_set(FRAME_END)
    cpos, tpos = cam.matrix_world.translation, target.matrix_world.translation
    body = project(_apply(phone.matrix_world, phone_local["Phone_Body"]), cpos, tpos)
    scr = project(_apply(phone.matrix_world, screen_local), cpos, tpos)
    yaw = math.degrees(phone.matrix_world.to_euler("ZXY").z)
    sm = np.array(slot.matrix_world)
    heart_in = {}
    for label, pts in (("rest_scale", geo["heart_phases"][0]), ("beat_union", heart_pts)):
        hp = project(pts @ sm[:3, :3].T + sm[:3, 3], cpos, tpos)
        margins = {"left": hp[:, 0].min() - scr[:, 0].min(), "right": scr[:, 0].max() - hp[:, 0].max(),
                   "top": hp[:, 1].min() - scr[:, 1].min(), "bottom": scr[:, 1].max() - hp[:, 1].max()}
        heart_in[label] = {"margins": rnd(margins, 4), "min": round(min(margins.values()), 4),
                           "centre_dx": round(float((hp[:, 0].min() + hp[:, 0].max()) / 2
                                                    - (scr[:, 0].min() + scr[:, 0].max()) / 2), 4)}
    rest = {"phone_height_fraction": round(float(body[:, 1].max() - body[:, 1].min()), 4),
            "phone_bounds": [round(float(x), 4) for x in (body[:, 0].min(), body[:, 1].min(),
                                                          body[:, 0].max(), body[:, 1].max())],
            "phone_centre": [round(float((body[:, 0].min() + body[:, 0].max()) / 2), 4),
                             round(float((body[:, 1].min() + body[:, 1].max()) / 2), 4)],
            "phone_yaw_deg": round(yaw, 3), "phone_lean_deg": PHONE_END_LEAN,
            "camera_relative_yaw_deg": round(CAMERA_KEYS[-1]["az"] - PHONE_END_YAW, 3),
            "camera_relative_elevation_deg": round(CAMERA_KEYS[-1]["el"] - PHONE_END_LEAN, 3),
            "phone_hover_mm": PHONE_HOVER * 1000,
            "heart_on_display": heart_in,
            "camera_distance_m": round((cpos - tpos).length, 4)}
    res["rest_pose"] = rest
    expect(0.70 <= rest["phone_height_fraction"] <= 0.80, "phone not 70..80 % of the frame height at rest")
    expect(heart_in["rest_scale"]["min"] >= 0.02, "the heart is not inside the display with a 2 % margin at rest")
    expect(heart_in["beat_union"]["min"] >= 0.0, "the beating heart leaves the display outline at rest")
    expect(abs(heart_in["rest_scale"]["centre_dx"]) <= 0.02, "the heart is off the display's centre at rest")

    # --- smoothness: no jumps, calm at rest ----------------------------------------------------------
    smooth = {}
    for n, arr in track.items():
        a = np.array(arr)
        v = np.diff(a, axis=0) * FPS                  # m/s
        acc = np.diff(v, axis=0) * FPS                # m/s^2
        jerk = np.linalg.norm(np.diff(acc, axis=0), axis=1) * FPS          # m/s^3
        jerk_frames = np.nonzero(jerk > 60.0)[0]
        sp = np.linalg.norm(v, axis=1)
        smooth[n] = {"max_speed_mm_s": round(float(sp.max() * 1000), 1),
                     "max_speed_t": round((int(sp.argmax()) + 0.5) / FPS, 3),
                     "max_accel_m_s2": round(float(np.linalg.norm(acc, axis=1).max()), 3),
                     "end_speed_mm_s": round(float(np.linalg.norm(v[-1]) * 1000), 3),
                     "max_jerk_m_s3": round(float(jerk.max()), 1),
                     "max_jerk_t": round((int(jerk.argmax()) + 2) / FPS, 3),
                     "jerk_spike_frames": [int(i) + 2 for i in jerk_frames[:10]]}
        expect(smooth[n]["end_speed_mm_s"] < 1.0, f"{n} still moving at the end")
    for n in ("Cam", "CamTarget", "Phone", "Card"):
        expect(not smooth[n]["jerk_spike_frames"], f"{n}: jerk spikes {smooth[n]['jerk_spike_frames']}")
    expect(smooth["Cam"]["max_speed_mm_s"] <= CAMERA_MAX_SPEED,
           f"camera faster than {CAMERA_MAX_SPEED} mm/s ({smooth['Cam']['max_speed_mm_s']})")
    res["motion"] = smooth
    res["camera_keys"] = rnd(ctx.info.get("camera_keys"), 5)
    # the camera's speed over time (a stop-and-go would show as a dip between two humps)
    cam_p, tgt_p = np.array(track["Cam"]), np.array(track["CamTarget"])
    view = tgt_p - cam_p
    view /= np.linalg.norm(view, axis=1)[:, None]
    ang = np.degrees(np.arccos(np.clip((view[1:] * view[:-1]).sum(1), -1, 1))) * FPS
    sp_c = np.linalg.norm(np.diff(cam_p, axis=0), axis=1) * FPS * 1000
    sp_t = np.linalg.norm(np.diff(tgt_p, axis=0), axis=1) * FPS * 1000
    res["camera_profile"] = [{"t": round((i + 0.5) / FPS, 3), "cam_mm_s": round(float(sp_c[i]), 1),
                              "target_mm_s": round(float(sp_t[i]), 1), "turn_deg_s": round(float(ang[i]), 2),
                              "dist": round(float(np.linalg.norm(cam_p[i] - tgt_p[i])), 4)}
                             for i in range(0, len(sp_c), 3)]
    # the screens gate: the display shows nothing that needs its textures before it
    gi = int(round(T_GATE_SCREENS * FPS))
    early = max(motion.fx(k, f / FPS) for k in ("Wake", "Notif", "Billet") for f in range(gi + 1))
    res["gate"] = {"t": T_GATE_SCREENS, "screen_fx_max_before": early,
                   "speeds_mm_s": {n: round(float(np.linalg.norm(np.array(track[n][min(gi + 1, FRAME_END)])
                                                                 - np.array(track[n][max(gi - 1, 0)]))
                                                  * FPS / 2 * 1000), 3) for n in track}}
    expect(early == 0.0, "the display needs its screen textures before gates.screens")

    # --- reference poses for the three.js check (glTF axes: x, z, -y) -------------------------------
    ref = []
    for i in range(int(DURATION / CONTACT_STEP) + 1):
        t = round(i * CONTACT_STEP, 3)
        scene.frame_set(int(round(t * FPS)))
        entry = {"t": t}
        for n in ("Cam", "CamTarget", "GiftSlot", "Phone", "Card", "Phone_ScreenDock"):
            p = bpy.data.objects[n].matrix_world.translation
            entry[n] = [round(p.x, 6), round(p.z, 6), round(-p.y, 6)]
        entry["GiftSlotScale"] = round(slot.matrix_world.to_scale().x, 6)
        entry["fx"] = {k: round(objs[f"Fx_{k}"].location.x, 6) for k in FX}
        ref.append(entry)
    res["gltf_reference"] = ref

    # --- timeline / meta ---------------------------------------------------------------------------
    meta = story_meta(scene)
    res["heroStory"] = meta
    expect(abs(meta["duration"] - DURATION) < 1e-6 and meta["clip"] == SCENE_NAME, "timeline")
    expect(meta["beats"][0]["start"] == 0 and meta["beats"][-1]["end"] == meta["duration"], "beats")
    res["heart"] = ctx.info.get("heart")
    res["fx_keys"] = {k: [list(x) for x in v] for k, v in FX.items()}
    scene.frame_set(0)
    res["passed"] = not fails
    res["failures"] = fails
    common.write_json(os.path.join(ctx.stage_renders("story"), "checks.json"), rnd(res, 6))
    for msg in fails:
        log(f"CHECK FAILED: {msg}")
    log(f"story checks {'passed' if not fails else 'FAILED'}")
    return not fails, res


# ---------------------------------------------------------------------------------------------
# Check renders
# ---------------------------------------------------------------------------------------------

CONTACT_STEP = 0.5
FULL_TIMES = (0.0, 2.4, 4.6, 7.2, 8.8, 10.0)


def _beat_at(t: float) -> str:
    name = BEATS[0][0]
    for b, s in BEATS:
        if t >= s - 1e-9:
            name = b
    return name


def _compensated_screens(ctx: Ctx) -> dict:
    """Float copies of the preview screen images, compensated for the view transform, so the
    renders show the captures 1:1 like the runtime's toneMapped = false shader (render only)."""
    vt = ctx.scene.view_settings.view_transform
    out = {}
    for name, path in (("screen_lock", LOCK_PNG), ("screen_billet", SCREEN_PNG),
                       ("screen_notification", NOTIF_PNG)):
        src = bpy.data.images.load(path, check_existing=False)
        px = common.image_to_numpy(src)
        w, h = src.size
        bpy.data.images.remove(src)
        lin, _info = build_phone._display_compensate(px[..., :3], vt)
        arr = np.concatenate([lin, px[..., 3:4]], axis=2).astype(np.float32)
        img = bpy.data.images.new(f"{name}_comp", w, h, alpha=True, float_buffer=True)
        for cs in ("Linear Rec.709", "Linear"):
            try:
                img.colorspace_settings.name = cs
                break
            except TypeError:
                continue
        img.alpha_mode = "STRAIGHT"
        img.pixels.foreach_set(arr.ravel())
        out[name] = img
    return out


def render_story(ctx: Ctx) -> None:
    out = ctx.stage_renders("story")
    for old in glob.glob(os.path.join(out, "*.png")):
        os.remove(old)
    scene = ctx.scene
    common.setup_eevee(scene, 768, 64)
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.camera = ctx.objects["RenderCam"]
    tree = ctx.materials["M_ScreenPreview"].node_tree
    comp = _compensated_screens(ctx)
    swapped = []
    for n in tree.nodes:
        if n.type == "TEX_IMAGE" and n.name in comp:
            swapped.append((n, n.image))
            n.image = comp[n.name]
    tmp = os.path.join(out, "_rgba.png")
    items = []
    times = [round(i * CONTACT_STEP, 3) for i in range(int(DURATION / CONTACT_STEP) + 1)]
    try:
        for t in times:
            scene.frame_set(int(round(t * FPS)))
            common.render_still(scene, scene.camera, tmp)
            path = os.path.join(out, f"t_{t:05.2f}.png")
            common.composite_on_page(tmp, path)
            items.append((f"T{t:.1f} {_beat_at(t)}", path))
        common.contact_sheet(items, os.path.join(out, "contact.png"), cols=5, tile=384,
                             legend_path=os.path.join(out, "contact.json"))
        scene.render.resolution_x = scene.render.resolution_y = 1536
        scene.eevee.taa_render_samples = 128
        for t in FULL_TIMES:
            scene.frame_set(int(round(t * FPS)))
            common.render_still(scene, scene.camera, tmp)
            common.composite_on_page(tmp, os.path.join(out, f"full_{t:05.2f}.png"))
    finally:
        for n, img in swapped:
            n.image = img
        for img in comp.values():
            bpy.data.images.remove(img)
        if os.path.isfile(tmp):
            os.remove(tmp)
        scene.frame_set(0)
