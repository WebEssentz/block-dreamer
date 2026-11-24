import os
from PIL import Image, ImageDraw, ImageFont

def render_splash_logo(size, dark_mode=True):
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 4 blocks in virtual coordinate space:
    # 64x64 grid, emblem occupies 64x64 at center top
    k = (s * 0.55) / 64.0
    ox = (s - 64 * k) / 2
    oy = s * 0.12

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
        text_fg = (245, 245, 247, 255)
        text_mut = (140, 140, 142, 255)
    else:
        glass_fill = (18, 18, 17, 25)
        glass_outline = (18, 18, 17, 120)
        solid_fill = (18, 18, 17, 255)
        hi_fill = (255, 255, 255, 70)
        text_fg = (18, 18, 17, 255)
        text_mut = (120, 120, 122, 255)

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

    # Typography
    font_main_sz = int(s * 0.088)
    font_sub_sz = int(s * 0.042)
    try:
        font_main = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', font_main_sz)
        font_sub = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', font_sub_sz)
    except:
        font_main = ImageFont.load_default()
        font_sub = ImageFont.load_default()

    # Title
    t_text = "BLOCK DREAMER"
    bbox = draw.textbbox((0, 0), t_text, font=font_main)
    tw = bbox[2] - bbox[0]
    ty = oy + 64 * k + int(18 * k)
    draw.text(((s - tw) // 2, ty), t_text, font=font_main, fill=text_fg)

    # Subtitle
    s_text = "A I   D R E A M S   A H E A D"
    s_bbox = draw.textbbox((0, 0), s_text, font=font_sub)
    stw = s_bbox[2] - s_bbox[0]
    sty = ty + (bbox[3] - bbox[1]) + int(10 * k)
    draw.text(((s - stw) // 2, sty), s_text, font=font_sub, fill=text_mut)

    return img.resize((size, size), Image.Resampling.LANCZOS)

def main():
    base_res = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res'))
    
    # 512x512 square logo that is NEVER stretched
    logo_light = render_splash_logo(512, dark_mode=False)
    logo_dark = render_splash_logo(512, dark_mode=True)

    # Save to drawable, drawable-night, and xxhdpi folders
    for d in ['drawable', 'drawable-xxhdpi']:
        os.makedirs(os.path.join(base_res, d), exist_ok=True)
        logo_light.save(os.path.join(base_res, d, 'splash_logo.png'), format='PNG')

    for d in ['drawable-night', 'drawable-night-xxhdpi']:
        os.makedirs(os.path.join(base_res, d), exist_ok=True)
        logo_dark.save(os.path.join(base_res, d, 'splash_logo.png'), format='PNG')
    print("Saved splash_logo.png for light and dark modes!")

if __name__ == '__main__':
    main()
