#!/usr/bin/env python3
import json
import sys

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageStat


def clamp(value, minimum=0.0, maximum=1.0):
    return max(minimum, min(maximum, float(value)))


def to_box(raw_box, width, height, padding=0.0):
    if isinstance(raw_box, dict):
        raw_box = raw_box.get("bbox")
    if not isinstance(raw_box, (list, tuple)) or len(raw_box) != 4:
        return None
    x, y, box_width, box_height = [float(value) for value in raw_box]
    x = clamp(x - padding)
    y = clamp(y - padding)
    box_width = clamp(box_width + padding * 2)
    box_height = clamp(box_height + padding * 2)
    return (
        round(x * width),
        round(y * height),
        round(clamp(x + box_width) * width),
        round(clamp(y + box_height) * height),
    )


def corner_color(image):
    width, height = image.size
    sample_width = max(1, round(width * 0.08))
    sample_height = max(1, round(height * 0.08))
    boxes = [
        (0, 0, sample_width, sample_height),
        (width - sample_width, 0, width, sample_height),
        (0, height - sample_height, sample_width, height),
        (width - sample_width, height - sample_height, width, height),
    ]
    means = [ImageStat.Stat(image.crop(box)).mean[:3] for box in boxes]
    return tuple(round(sum(channel) / len(means)) for channel in zip(*means))


def make_background(source):
    width, height = source.size
    rgb = source.convert("RGB")
    blur_radius = max(24, round(max(width, height) * 0.16))
    blurred = rgb.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    blurred = ImageEnhance.Contrast(blurred).enhance(0.35)
    blurred = ImageEnhance.Color(blurred).enhance(0.72)
    solid = Image.new("RGB", (width, height), corner_color(rgb))
    return Image.blend(blurred, solid, 0.34).convert("RGBA")


def feathered_box_mask(size, box, feather):
    width, height = size
    scale = 4
    mask = Image.new("L", (max(1, width // scale), max(1, height // scale)), 0)
    draw = ImageDraw.Draw(mask)
    scaled_box = tuple(round(value / scale) for value in box)
    draw.rectangle(scaled_box, fill=255)
    radius = max(1, round(feather / scale))
    mask = mask.filter(ImageFilter.GaussianBlur(radius=radius))
    return mask.resize((width, height), Image.Resampling.LANCZOS)


def main():
    if len(sys.argv) != 4:
        raise SystemExit(
            "usage: constrain_scene_to_layout.py INPUT_PATH OUTPUT_PATH METADATA_JSON"
        )

    input_path, output_path = sys.argv[1:3]
    metadata = json.loads(sys.argv[3] or "{}")
    source = Image.open(input_path).convert("RGBA")
    width, height = source.size
    background = make_background(source)
    result = background.copy()

    visual_box = to_box(metadata.get("visual_area_bbox"), width, height)
    if visual_box:
        feather = max(6, round(min(width, height) * 0.012))
        mask = feathered_box_mask(source.size, visual_box, feather)
        result = Image.composite(source, result, mask)
    else:
        result = source.copy()

    safe_zones = metadata.get("text_safe_zones") or []
    if not safe_zones and metadata.get("active_text_group_bbox"):
        safe_zones = [metadata["active_text_group_bbox"]]
    zone_padding = 0.018
    zone_feather = max(8, round(min(width, height) * 0.018))
    for zone in safe_zones:
        box = to_box(zone, width, height, padding=zone_padding)
        if not box:
            continue
        mask = feathered_box_mask(source.size, box, zone_feather)
        result = Image.composite(background, result, mask)

    result.convert("RGB").save(output_path, "PNG")


if __name__ == "__main__":
    main()
