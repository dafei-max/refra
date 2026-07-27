import sys
from pathlib import Path

from PIL import Image


def distance(a, b):
    return sum((int(a[index]) - int(b[index])) ** 2 for index in range(3)) ** 0.5


def background_color(image):
    width, height = image.size
    points = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    pixels = [image.getpixel(point)[:3] for point in points]
    return tuple(round(sum(pixel[index] for pixel in pixels) / len(pixels)) for index in range(3))


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: make_title_transparent.py <input> <output>")

    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    image = Image.open(source).convert("RGBA")
    bg = background_color(image)
    output = []
    for red, green, blue, alpha in image.getdata():
        dist = distance((red, green, blue), bg)
        if dist < 26:
            output.append((red, green, blue, 0))
        elif dist < 90:
            output.append((red, green, blue, min(alpha, round((dist - 26) / 64 * 255))))
        else:
            output.append((red, green, blue, alpha))
    image.putdata(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target)
    print(target.name)


if __name__ == "__main__":
    main()
