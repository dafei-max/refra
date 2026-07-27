import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageStat


ROOT_DIR = Path(__file__).resolve().parents[1]
DOUYIN_SANS_BOLD = ROOT_DIR / "font" / "DouyinSansBold.otf"


def resized_logo_height(logo_path, target_width):
    with Image.open(logo_path) as logo:
        ratio = target_width / logo.width
        return max(1, round(logo.height * ratio))


def average_luminance(image, box):
    region = image.crop(box).convert("RGB")
    if not region.width or not region.height:
        return 0
    red, green, blue = ImageStat.Stat(region).mean
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def resize_layer(layer_path, target_width):
    layer = Image.open(layer_path).convert("RGBA")
    ratio = target_width / layer.width
    target_height = max(1, round(layer.height * ratio))
    return layer.resize((target_width, target_height), Image.Resampling.LANCZOS)


def load_title_font(size):
    candidates = [
        DOUYIN_SANS_BOLD,
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/SFNS.ttf",
    ]
    for font_path in candidates:
        try:
            return ImageFont.truetype(font_path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def text_width(draw, text, font):
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def fit_text(draw, text, font, max_width):
    if text_width(draw, text, font) <= max_width:
        return text
    ellipsis = "..."
    clipped = text
    while clipped and text_width(draw, clipped + ellipsis, font) > max_width:
        clipped = clipped[:-1]
    return clipped + ellipsis if clipped else ""


def draw_search_title(search, title):
    title = (title or "").strip()
    if not title:
        return search

    draw = ImageDraw.Draw(search)
    # White input pill area inside search_light/search_dark; leave the right icon
    # area empty and center text within the remaining oval.
    text_box = (
        round(search.width * 0.40),
        round(search.height * 0.68),
        round(search.width * 0.84),
        round(search.height * 0.95),
    )
    max_width = text_box[2] - text_box[0]
    max_height = text_box[3] - text_box[1]

    font_size = max(10, round(search.width * 0.052))
    font = load_title_font(font_size)
    fitted = fit_text(draw, title, font, max_width)
    while font_size > 10:
        box = draw.textbbox((0, 0), fitted, font=font)
        if box[3] - box[1] <= max_height and box[2] - box[0] <= max_width:
            break
        font_size -= 1
        font = load_title_font(font_size)
        fitted = fit_text(draw, title, font, max_width)

    box = draw.textbbox((0, 0), fitted, font=font)
    text_width_value = box[2] - box[0]
    text_height = box[3] - box[1]
    x = text_box[0] + (max_width - text_width_value) / 2 - box[0]
    y = text_box[1] + (max_height - text_height) / 2 - box[1]
    draw.text((x, y), fitted, fill=(18, 18, 18, 255), font=font)
    return search


def main():
    if len(sys.argv) not in (6, 7, 9, 13, 15):
        raise SystemExit(
            "usage: apply_logo.py <image> <dark-bg-logo> [light-bg-logo] <left> <top> <width> "
            "[search-light-bg search-dark-bg search-width search-right search-bottom title] "
            "[include-logo include-search]"
        )

    image_path = Path(sys.argv[1])
    dark_bg_logo_path = Path(sys.argv[2])
    has_search_config = len(sys.argv) in (13, 15)
    if len(sys.argv) == 6:
        light_bg_logo_path = dark_bg_logo_path
        left = int(sys.argv[3])
        top = int(sys.argv[4])
        target_width = int(sys.argv[5])
    else:
        light_bg_logo_path = Path(sys.argv[3])
        left = int(sys.argv[4])
        top = int(sys.argv[5])
        target_width = int(sys.argv[6])

    include_logo = True
    include_search = has_search_config
    if len(sys.argv) == 9:
        include_logo = sys.argv[7].lower() == "true"
        include_search = sys.argv[8].lower() == "true"
    elif len(sys.argv) == 15:
        include_logo = sys.argv[13].lower() == "true"
        include_search = sys.argv[14].lower() == "true"

    base = Image.open(image_path).convert("RGBA")
    logo_name = "-"
    logo_luminance = ""
    if include_logo:
        target_height = resized_logo_height(dark_bg_logo_path, target_width)
        sample_box = (
            max(0, left),
            max(0, top),
            min(base.width, left + target_width),
            min(base.height, top + target_height),
        )
        luminance = average_luminance(base, sample_box)
        logo_path = light_bg_logo_path if luminance >= 150 else dark_bg_logo_path
        logo = Image.open(logo_path).convert("RGBA")
        ratio = target_width / logo.width
        target_height = max(1, round(logo.height * ratio))
        logo = logo.resize((target_width, target_height), Image.Resampling.LANCZOS)
        base.alpha_composite(logo, (left, top))
        logo_name = logo_path.name
        logo_luminance = f"{luminance:.2f}"

    search_name = "-"
    search_luminance = ""
    if has_search_config and include_search:
        search_light_bg_path = Path(sys.argv[7])
        search_dark_bg_path = Path(sys.argv[8])
        search_width = int(sys.argv[9])
        search_right = int(sys.argv[10])
        search_bottom = int(sys.argv[11])
        search_title = sys.argv[12]

        search_height = resized_logo_height(search_light_bg_path, search_width)
        search_left = max(0, base.width - search_right - search_width)
        search_top = max(0, base.height - search_bottom - search_height)
        search_box = (
            search_left,
            search_top,
            min(base.width, search_left + search_width),
            min(base.height, search_top + search_height),
        )
        search_luminance_value = average_luminance(base, search_box)
        search_path = search_light_bg_path if search_luminance_value >= 150 else search_dark_bg_path
        search = resize_layer(search_path, search_width)
        search = draw_search_title(search, search_title)
        base.alpha_composite(search, (search_left, search_top))
        search_name = search_path.name
        search_luminance = f"{search_luminance_value:.2f}"

    base.save(image_path)
    print(f"{logo_name}\t{logo_luminance}\t{search_name}\t{search_luminance}")


if __name__ == "__main__":
    main()
