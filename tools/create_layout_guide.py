#!/usr/bin/env python3
import json
import sys

from PIL import Image, ImageDraw


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


def main():
    if len(sys.argv) != 5:
        raise SystemExit(
            "usage: create_layout_guide.py OUTPUT_PATH WIDTH HEIGHT METADATA_JSON"
        )

    output_path = sys.argv[1]
    width = max(1, int(sys.argv[2]))
    height = max(1, int(sys.argv[3]))
    metadata = json.loads(sys.argv[4] or "{}")

    protected = (28, 28, 28)
    allowed = (245, 245, 245)
    image = Image.new("RGB", (width, height), protected)
    draw = ImageDraw.Draw(image)

    visual_area = to_box(metadata.get("visual_area_bbox"), width, height)
    if visual_area:
        draw.rectangle(visual_area, fill=allowed)
    else:
        draw.rectangle((0, 0, width, height), fill=allowed)

    safe_zones = metadata.get("text_safe_zones") or []
    if not safe_zones and metadata.get("active_text_group_bbox"):
        safe_zones = [metadata["active_text_group_bbox"]]
    for zone in safe_zones:
        box = to_box(zone, width, height, padding=0.012)
        if box:
            draw.rectangle(box, fill=protected)

    image.save(output_path, "PNG")


if __name__ == "__main__":
    main()
