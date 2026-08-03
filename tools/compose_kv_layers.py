#!/usr/bin/env python3
import sys

from PIL import Image


def main():
    if len(sys.argv) != 4:
        raise SystemExit(
            "usage: compose_kv_layers.py SCENE_PATH TYPOGRAPHY_PATH OUTPUT_PATH"
        )

    scene_path, typography_path, output_path = sys.argv[1:4]
    scene = Image.open(scene_path).convert("RGBA")
    typography = Image.open(typography_path).convert("RGBA")
    if typography.size != scene.size:
        typography = typography.resize(scene.size, Image.Resampling.LANCZOS)

    composed = Image.alpha_composite(scene, typography)
    composed.save(output_path, "PNG")


if __name__ == "__main__":
    main()
