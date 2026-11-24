import os
import math
from PIL import Image, ImageDraw, ImageFont

def render_logo(size, high_contrast=False):
    # Renders logo mark with transparent background at (size x size)
    # 4x supersampling
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    k = s / 64.0

    def draw_rounded_rect(xy, rx, fill=None, outline=None, width=1):
        x0, y0, x1, y1 = xy
        draw.rounded_rectangle([x0, y0, x1, y1], radius=rx, fill=fill, outline=outline, width=width)

    # Glass blocks (top-right, bottom-left)
    if high_contrast:
        glass_fill = (255, 255, 255, 55)
        glass_outline = (255, 255, 255, 180)
        solid_fill = (255, 255, 255, 255)
        w_out = max(2, int(2.2 * k))
    else:
        glass_fill = (255, 255, 255, 30)
        glass_outline = (255, 255, 255, 90)
        solid_fill = (245, 245, 247, 255)
        w_out = max(2, int(1.5 * k))

    rx = int(8 * k)

    # Top-right
    draw_rounded_rect([32*k, 6*k, 58*k, 32*k], rx, fill=glass_fill, outline=glass_outline, width=w_out)
    # Bottom-left
    draw_rounded_rect([6*k, 32*k, 32*k, 58*k], rx, fill=glass_fill, outline=glass_outline, width=w_out)

    # Solid blocks (top-left, bottom-right)
    # Top-left
    draw_rounded_rect([6*k, 6*k, 32*k, 32*k], rx, fill=solid_fill)
    # Bottom-right
    draw_rounded_rect([32*k, 32*k, 58*k, 58*k], rx, fill=solid_fill)

    # Highlight stripes on solid blocks
    hi_fill = (255, 255, 255, 140 if high_contrast else 90)
    hi_rx = max(1, int(2 * k))
    draw_rounded_rect([10*k, 9*k, 28*k, 13*k], hi_rx, fill=hi_fill)
    draw_rounded_rect([36*k, 35*k, 54*k, 39*k], hi_rx, fill=hi_fill)

    return img.resize((size, size), Image.Resampling.LANCZOS)

def create_splash(width, height):
    # Create background image in #121211
    scale = 2
    sw, sh = width * scale, height * scale
    img = Image.new('RGBA', (sw, sh), (18, 18, 17, 255))
    draw = ImageDraw.Draw(img)

    cx, cy = sw // 2, int(sh * 0.44)

    # Draw subtle radial glow behind logo
    glow_r = int(min(sw, sh) * 0.38)
    glow = Image.new('RGBA', (glow_r * 2, glow_r * 2), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    for r in range(glow_r, 0, -4):
        alpha = int(18 * (1.0 - r / glow_r) ** 2)
        gdraw.ellipse([glow_r - r, glow_r - r, glow_r + r, glow_r + r], fill=(255, 255, 255, alpha))
    img.alpha_composite(glow, (cx - glow_r, cy - glow_r))

    # Render emblem
    logo_sz = int(min(sw, sh) * 0.28)
    logo_sz = max(64, min(logo_sz, 240 * scale))
    logo = render_logo(logo_sz)
    img.alpha_composite(logo, (cx - logo_sz // 2, cy - logo_sz // 2 - int(24 * scale)))

    # Text fonts
    font_main_sz = int(logo_sz * 0.22)
    font_sub_sz = int(logo_sz * 0.10)
    
    try:
        font_main = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', font_main_sz)
        font_sub = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', font_sub_sz)
    except:
        font_main = ImageFont.load_default()
        font_sub = ImageFont.load_default()

    # Draw Title: "BLOCK DREAMER"
    title_text = "BLOCK DREAMER"
    bbox = draw.textbbox((0, 0), title_text, font=font_main)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    ty = cy + logo_sz // 2 + int(12 * scale)
    draw.text((cx - tw // 2, ty), title_text, font=font_main, fill=(245, 245, 245, 255))

    # Draw Subtitle with tracked spacing: "A I   D R E A M S   A H E A D"
    sub_text = "A I   D R E A M S   A H E A D"
    s_bbox = draw.textbbox((0, 0), sub_text, font=font_sub)
    stw = s_bbox[2] - s_bbox[0]
    sty = ty + th + int(10 * scale)
    draw.text((cx - stw // 2, sty), sub_text, font=font_sub, fill=(140, 140, 140, 255))

    # Bottom badge: "OFFLINE RL NEURAL NETWORK"
    font_badge_sz = int(font_sub_sz * 0.85)
    try:
        font_badge = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', font_badge_sz)
    except:
        font_badge = font_sub
    b_text = "100% OFFLINE · ON-DEVICE INFERENCE"
    b_bbox = draw.textbbox((0, 0), b_text, font=font_badge)
    btw = b_bbox[2] - b_bbox[0]
    bty = sh - int(48 * scale)
    draw.text((cx - btw // 2, bty), b_text, font=font_badge, fill=(90, 90, 90, 255))

    return img.resize((width, height), Image.Resampling.LANCZOS)

def create_app_icon(size):
    # App launcher icon with dark onyx squircle and centered emblem
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Squircle background (#161618 deep charcoal)
    rx = int(s * 0.22)
    draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=rx, fill=(22, 22, 24, 255))
    draw.rounded_rectangle([1, 1, s - 2, s - 2], radius=rx, outline=(255, 255, 255, 38), width=max(1, int(1.5 * scale)))

    # Emblem (high contrast)
    logo_sz = int(s * 0.62)
    logo = render_logo(logo_sz, high_contrast=True)
    img.alpha_composite(logo, ((s - logo_sz) // 2, (s - logo_sz) // 2))

    return img.resize((size, size), Image.Resampling.LANCZOS)

def create_app_icon_round(size):
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Circle background (#161618)
    draw.ellipse([0, 0, s - 1, s - 1], fill=(22, 22, 24, 255))
    draw.ellipse([1, 1, s - 2, s - 2], outline=(255, 255, 255, 38), width=max(1, int(1.5 * scale)))

    # Emblem (high contrast)
    logo_sz = int(s * 0.58)
    logo = render_logo(logo_sz, high_contrast=True)
    img.alpha_composite(logo, ((s - logo_sz) // 2, (s - logo_sz) // 2))

    return img.resize((size, size), Image.Resampling.LANCZOS)

def create_foreground_icon(size):
    # Adaptive icon foreground (transparent background)
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    
    # Emblem centered in the safe zone (around 52% of canvas to fit comfortably inside all launcher masks)
    logo_sz = int(s * 0.52)
    logo = render_logo(logo_sz, high_contrast=True)
    img.alpha_composite(logo, ((s - logo_sz) // 2, (s - logo_sz) // 2))

    return img.resize((size, size), Image.Resampling.LANCZOS)

def main():
    base_res = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res'))
    
    # Splash screens
    splash_targets = [
        ('drawable/splash.png', 480, 800),
        ('drawable-port-mdpi/splash.png', 320, 480),
        ('drawable-port-hdpi/splash.png', 480, 800),
        ('drawable-port-xhdpi/splash.png', 720, 1280),
        ('drawable-port-xxhdpi/splash.png', 960, 1600),
        ('drawable-port-xxxhdpi/splash.png', 1280, 1920),
        ('drawable-land-mdpi/splash.png', 480, 320),
        ('drawable-land-hdpi/splash.png', 800, 480),
        ('drawable-land-xhdpi/splash.png', 1280, 720),
        ('drawable-land-xxhdpi/splash.png', 1600, 960),
        ('drawable-land-xxxhdpi/splash.png', 1920, 1280),
    ]

    print("Generating splash screens...")
    for rel_path, w, h in splash_targets:
        out_path = os.path.join(base_res, rel_path.replace('/', os.sep))
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        img = create_splash(w, h)
        img.save(out_path, format='PNG')
        print(f"Saved {rel_path} ({w}x{h})")

    # App icons
    icon_densities = [
        ('mipmap-mdpi', 48, 108),
        ('mipmap-hdpi', 72, 162),
        ('mipmap-xhdpi', 96, 216),
        ('mipmap-xxhdpi', 144, 324),
        ('mipmap-xxxhdpi', 192, 432),
    ]

    print("Generating app icons...")
    for folder, icon_sz, fg_sz in icon_densities:
        folder_path = os.path.join(base_res, folder)
        os.makedirs(folder_path, exist_ok=True)
        
        # ic_launcher.png
        ic = create_app_icon(icon_sz)
        ic.save(os.path.join(folder_path, 'ic_launcher.png'), format='PNG')
        
        # ic_launcher_round.png
        ic_round = create_app_icon_round(icon_sz)
        ic_round.save(os.path.join(folder_path, 'ic_launcher_round.png'), format='PNG')
        
        # ic_launcher_foreground.png
        fg = create_foreground_icon(fg_sz)
        fg.save(os.path.join(folder_path, 'ic_launcher_foreground.png'), format='PNG')
        print(f"Saved icons for {folder}")

    print("Done!")

if __name__ == '__main__':
    main()
