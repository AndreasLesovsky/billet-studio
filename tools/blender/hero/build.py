r"""Hero asset build - entry point (Blender headless).

    "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup ^
        -P tools/blender/hero/build.py -- --stage card [--render] [--textures DIR]

Every run starts from the factory-startup scene, builds from scratch and saves
tools/blender/hero/.work/hero.blend. Exit code 0 = built and all self-checks passed.
"""

import os
import sys
import traceback

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common  # noqa: E402


def stage_card(ctx: common.Ctx) -> bool:
    import build_card
    build_card.build_card(ctx)
    common.save_blend(ctx)
    ok = build_card.check_card(ctx)
    if ctx.args.render:
        build_card.render_card(ctx)
    return ok


STAGE_RUNNERS = {
    "card": stage_card,
    # H3: "phone" (build_phone.py), H4: "story" (build_story.py), "bake" (bake.py),
    # "export" (export.py)
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
