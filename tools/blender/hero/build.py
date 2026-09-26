r"""Hero asset build - entry point (Blender headless).

    "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup ^
        -P tools/blender/hero/build.py -- --stage card|phone|story|bake|export [--render] [--textures DIR]

Every run starts from the factory-startup scene, builds from scratch and saves
tools/blender/hero/.work/hero.blend (only when every check passed). Exit code 0 = built and all
self-checks passed. story/bake/export: the hero story (build_story.py, bake.py, export.py;
contract docs/hero-story.md).
"""

import os
import sys
import traceback

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common  # noqa: E402


def _hygiene(ctx: common.Ctx) -> tuple[bool, dict]:
    """Generated images only in images/, nothing else written outside .work/.renders/images,
    no __pycache__ anywhere under tools/blender."""
    h = common.output_hygiene(ctx.info["run_start"])
    ok = not h["files_written_outside_output_dirs"] and not h["pycache_dirs"]
    if not ok:
        common.log(f"CHECK FAILED: output hygiene {h}")
    return ok, h


def stage_card(ctx: common.Ctx) -> bool:
    import build_card
    build_card.build_card(ctx)
    ok = build_card.check_card(ctx)
    if ok:  # the user's Blender reloads hero.blend on change: save successful builds only
        common.save_blend(ctx)
    if ctx.args.render:
        build_card.render_card(ctx)
    return ok and _hygiene(ctx)[0]


def stage_phone(ctx: common.Ctx) -> bool:
    """Card + phone in one scene (side by side), checks for both, optional check renders."""
    import build_card
    import build_phone
    build_card.build_card(ctx)
    card_ok = build_card.check_card(ctx)
    build_phone.build_phone(ctx)
    phone_ok, res = build_phone.check_phone(ctx)
    build_phone.write_checks(ctx, res)
    if card_ok and phone_ok:
        common.save_blend(ctx)
    if ctx.args.render:
        build_phone.render_phone(ctx)
        res["check_screen_compensation"] = ctx.info.get("check_screen")
    clean, hyg = _hygiene(ctx)
    res["output_hygiene"] = hyg
    res["card_checks_passed"] = card_ok
    if not clean:
        res["failures"].append("output hygiene")
        res["passed"] = False
    build_phone.write_checks(ctx, res)
    return card_ok and phone_ok and clean


def _build_all(ctx: common.Ctx) -> tuple[bool, dict]:
    """Card + phone (with their own checks) + the story (docs/hero-story.md)."""
    import build_card
    import build_phone
    import build_story
    build_card.build_card(ctx)
    card_ok = build_card.check_card(ctx)
    build_phone.build_phone(ctx)
    phone_ok, pres = build_phone.check_phone(ctx)
    build_phone.write_checks(ctx, pres)
    build_story.build_story(ctx)
    story_ok, sres = build_story.check_story(ctx)
    sres["card_checks_passed"] = card_ok
    sres["phone_checks_passed"] = phone_ok
    return card_ok and phone_ok and story_ok, sres


def _finish(ctx: common.Ctx, ok: bool, res: dict, stage: str) -> bool:
    clean, hyg = _hygiene(ctx)
    res["output_hygiene"] = hyg
    if not clean:
        res.setdefault("failures", []).append("output hygiene")
        res["passed"] = False
    common.write_json(os.path.join(ctx.stage_renders(stage), "checks.json"), common.rnd(res, 6))
    return ok and clean


def stage_story(ctx: common.Ctx) -> bool:
    """H4: card + phone + story, checks, hero.blend (only when every check passed), renders."""
    import build_story
    ok, res = _build_all(ctx)
    if ok:
        common.save_blend(ctx)
    if ctx.args.render:
        build_story.render_story(ctx)
    return _finish(ctx, ok, res, "story")


def stage_bake(ctx: common.Ctx) -> bool:
    """The story plus the Cycles bakes (contact-shadow patches -> images/shadow_*.png)."""
    import bake
    import build_story
    _ok, res = _build_all(ctx)
    bres = bake.bake_shadows(ctx)
    # the patches' visible regions changed with the new textures: the camera compositions include
    # them, so fit the camera again and check the story again
    build_story.key_camera(ctx)
    story_ok, sres = build_story.check_story(ctx)
    sres["card_checks_passed"] = res["card_checks_passed"]
    sres["phone_checks_passed"] = res["phone_checks_passed"]
    sres["bake"] = bres
    sres["failures"] = sres["failures"] + bres["failures"]
    ok = story_ok and bres["passed"] and res["card_checks_passed"] and res["phone_checks_passed"]
    sres["passed"] = ok
    res = sres
    if ok:
        common.save_blend(ctx)
    if ctx.args.render:
        build_story.render_story(ctx)
    return _finish(ctx, ok, res, "story")


def stage_export(ctx: common.Ctx) -> bool:
    """The story (baked shadows must exist), hero.blend, then in memory: constraints / drivers /
    the spine bones baked into keys, heroStory from the markers, export/hero-story.glb."""
    import export
    ok, res = _build_all(ctx)
    if ok:
        common.save_blend(ctx)
        eres = export.export_story(ctx)
        res["export"] = eres
        ok = eres["passed"]
        if not ok:
            res.setdefault("failures", []).extend(eres["failures"])
            res["passed"] = False
    return _finish(ctx, ok, res, "export")


STAGE_RUNNERS = {
    "card": stage_card,
    "phone": stage_phone,
    "story": stage_story,
    "bake": stage_bake,
    "export": stage_export,
}


def main() -> int:
    args = common.parse_args(sys.argv)
    runner = STAGE_RUNNERS.get(args.stage)
    if runner is None:
        common.log(f"stage '{args.stage}' not implemented yet")
        return 0
    ctx = common.make_context(args)
    common.reset_scene(ctx)
    return common.exit_code_from(runner(ctx))


if __name__ == "__main__":
    try:
        code = main()
    except Exception:  # any build error must fail the CLI run
        traceback.print_exc()
        code = 1
    sys.stdout.flush()
    sys.stderr.flush()
    sys.exit(code)
