import os
from PIL import Image, ImageDraw, ImageFont

def load_font(paths, size):
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

def render_splash_logo(size, dark_mode=True):
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Emblem + "BLOCK DREAMER" vertically centered inside 512x512 with generous padding
    k = (s * 0.48) / 64.0
    ox = (s - 64 * k) / 2
    oy = s * 0.16

    def draw_rounded_rect(xy, rx, fill=None, outline=None, width=1):
        x0, y0, x1, y1 = xy
        draw.rounded_rectangle([x0, y0, x1, y1], radius=rx, fill=fill, outline=outline, width=width)

    rx = int(8 * k)
    w_out = max(2, int(2.0 * k))

    if dark_mode:
        glass_fill = (255, 255, 255, 35)
        glass_outline = (255, 255, 255, 140)
        solid_fill = (255, 255, 255, 255)
        hi_fill = (255, 255, 255, 120)
        text_fg = (245, 245, 240, 255)
    else:
        glass_fill = (18, 18, 17, 25)
        glass_outline = (18, 18, 17, 120)
        solid_fill = (18, 18, 17, 255)
        hi_fill = (255, 255, 255, 70)
        text_fg = (18, 18, 17, 255)

    # Top-right (glass)
    draw_rounded_rect([ox + 32*k, oy + 6*k, ox + 58*k, oy + 32*k], rx, fill=glass_fill, outline=glass_outline, width=w_out)
    # Bottom-left (glass)
    draw_rounded_rect([ox + 6*k, oy + 32*k, ox + 32*k, oy + 58*k], rx, fill=glass_fill, outline=glass_outline, width=w_out)

    # Top-left (solid)
    draw_rounded_rect([ox + 6*k, oy + 6*k, ox + 32*k, oy + 32*k], rx, fill=solid_fill)
    # Bottom-right (solid)
    draw_rounded_rect([ox + 32*k, oy + 32*k, ox + 58*k, oy + 58*k], rx, fill=solid_fill)

    # Specular stripes
    hi_rx = max(1, int(2 * k))
    draw_rounded_rect([ox + 10*k, oy + 9*k, ox + 28*k, oy + 13*k], hi_rx, fill=hi_fill)
    draw_rounded_rect([ox + 36*k, oy + 35*k, ox + 54*k, oy + 39*k], hi_rx, fill=hi_fill)

    # Title: "BLOCK DREAMER" centered well inside the canvas
    font_main_sz = int(s * 0.086)
    font_main = load_font(['C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf'], font_main_sz)

    t_text = "BLOCK DREAMER"
    bbox = draw.textbbox((0, 0), t_text, font=font_main)
    tw = bbox[2] - bbox[0]
    ty = oy + 64 * k + int(22 * k)
    draw.text(((s - tw) // 2 - bbox[0], ty - bbox[1]), t_text, font=font_main, fill=text_fg)

    return img.resize((size, size), Image.Resampling.LANCZOS)

def render_splash_by(width, height, dark_mode=True):
    scale = 4
    sw, sh = width * scale, height * scale
    img = Image.new('RGBA', (sw, sh), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if dark_mode:
        by_fg = (145, 145, 140, 255)
        sig_fg = (238, 238, 232, 255)
    else:
        by_fg = (120, 120, 114, 255)
        sig_fg = (24, 24, 22, 255)

    font_by = load_font(['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf'], int(sh * 0.22))
    font_sig = load_font(['C:/Windows/Fonts/seguisb.ttf', 'C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf'], int(sh * 0.29))

    by_txt = "By"
    b1 = draw.textbbox((0, 0), by_txt, font=font_by)
    w1, h1 = b1[2] - b1[0], b1[3] - b1[1]

    sig_txt = "Onyerikam G.C"
    b2 = draw.textbbox((0, 0), sig_txt, font=font_sig)
    w2, h2 = b2[2] - b2[0], b2[3] - b2[1]

    gap = int(sh * 0.10)
    total_h = h1 + gap + h2
    y1 = (sh - total_h) // 2

    draw.text(((sw - w1) // 2 - b1[0], y1 - b1[1]), by_txt, font=font_by, fill=by_fg)
    draw.text(((sw - w2) // 2 - b2[0], y1 + h1 + gap - b2[1]), sig_txt, font=font_sig, fill=sig_fg)

    return img.resize((width, height), Image.Resampling.LANCZOS)

def main():
    base_res = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res'))

    logo_light = render_splash_logo(512, dark_mode=False)
    logo_dark = render_splash_logo(512, dark_mode=True)
    by_light = render_splash_by(512, 128, dark_mode=False)
    by_dark = render_splash_by(512, 128, dark_mode=True)

    for d in ['drawable', 'drawable-xxhdpi']:
        os.makedirs(os.path.join(base_res, d), exist_ok=True)
        logo_light.save(os.path.join(base_res, d, 'splash_logo.png'), format='PNG')
        by_light.save(os.path.join(base_res, d, 'splash_by.png'), format='PNG')

    for d in ['drawable-night', 'drawable-night-xxhdpi']:
        os.makedirs(os.path.join(base_res, d), exist_ok=True)
        logo_dark.save(os.path.join(base_res, d, 'splash_logo.png'), format='PNG')
        by_dark.save(os.path.join(base_res, d, 'splash_by.png'), format='PNG')

    print("Saved splash_logo.png and splash_by.png for light and dark modes!")

if __name__ == '__main__':
    main()
