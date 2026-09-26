r"""Hero asset build - entry point (Blender headless).

    "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup ^
        -P tools/blender/hero/build.py -- --stage card|phone [--render] [--textures DIR]

Every run starts from the factory-startup scene, builds from scratch and saves
tools/blender/hero/.work/hero.blend. Exit code 0 = built and all self-checks passed.
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


STAGE_RUNNERS = {
    "card": stage_card,
    "phone": stage_phone,
    # H4: "story" (build_story.py), "bake" (bake.py), "export" (export.py)
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
