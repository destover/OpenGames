#!/usr/bin/env python3
"""Generate cover art for 'Последний костёр' survival game."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math
import random

WIDTH, HEIGHT = 1920, 1080

def create_gradient_bg(draw, width, height):
    """Create a cold night gradient background."""
    for y in range(height):
        ratio = y / height
        # Dark cold blues to near black
        r = int(10 + ratio * 5)
        g = int(15 + ratio * 10)
        b = int(35 + ratio * 25)
        draw.line([(0, y), (width, y)], fill=(r, g, b))

def draw_stars(draw, width, height, count=200):
    """Draw subtle stars in the night sky."""
    random.seed(42)
    for _ in range(count):
        x = random.randint(0, width)
        y = random.randint(0, height // 2)  # Only upper half
        size = random.choice([1, 1, 1, 2, 2, 3])
        brightness = random.randint(100, 200)
        draw.ellipse([x, y, x + size, y + size], fill=(brightness, brightness, brightness, 180))

def draw_mountain_silhouette(draw, width, height):
    """Draw jagged mountain silhouettes."""
    # Far mountains (darker)
    points_far = [(0, height * 0.65)]
    for x in range(0, width + 1, 40):
        y = height * 0.65 + math.sin(x * 0.008) * 40 + math.sin(x * 0.02) * 20
        points_far.append((x, y))
    points_far.append((width, height))
    points_far.append((0, height))
    draw.polygon(points_far, fill=(15, 20, 35))
    
    # Mid mountains
    points_mid = [(0, height * 0.75)]
    for x in range(0, width + 1, 30):
        y = height * 0.75 + math.sin(x * 0.012) * 60 + math.sin(x * 0.03) * 25
        points_mid.append((x, y))
    points_mid.append((width, height))
    points_mid.append((0, height))
    draw.polygon(points_mid, fill=(20, 25, 45))
    
    # Near mountains/rocks
    points_near = [(0, height * 0.85)]
    for x in range(0, width + 1, 25):
        y = height * 0.85 + math.sin(x * 0.015) * 80 + math.sin(x * 0.04) * 35
        points_near.append((x, y))
    points_near.append((width, height))
    points_near.append((0, height))
    draw.polygon(points_near, fill=(25, 30, 50))

def draw_snow_particles(draw, width, height, count=500):
    """Draw blowing snow particles."""
    random.seed(123)
    for _ in range(count):
        x = random.randint(0, width)
        y = random.randint(height // 2, height)
        size = random.choice([1, 1, 2, 2, 3])
        opacity = random.randint(60, 180)
        # Horizontal streak for wind effect
        length = random.randint(2, 8)
        draw.line([(x, y), (x + length, y + random.randint(-1, 1))], 
                 fill=(200, 210, 230, opacity), width=1)

def draw_campfire(draw, cx, cy):
    """Draw a campfire with glow effect."""
    # Fire glow layers (outer to inner)
    for i, (radius, color) in enumerate([
        (120, (60, 20, 5, 30)),
        (90, (100, 35, 10, 50)),
        (60, (180, 60, 15, 80)),
        (40, (230, 100, 20, 120)),
        (25, (255, 160, 40, 180)),
        (15, (255, 220, 100, 220)),
    ]):
        draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], 
                    fill=color)
    
    # Fire core
    draw.ellipse([cx - 12, cy - 12, cx + 12, cy + 12], fill=(255, 240, 180))
    
    # Flames
    flame_color = (255, 140, 30, 200)
    for i in range(8):
        angle = i * (2 * math.pi / 8) + random.uniform(-0.3, 0.3)
        length = random.randint(25, 45)
        wobble = random.randint(-8, 8)
        x1 = cx + math.cos(angle) * 15
        y1 = cy + math.sin(angle) * 15
        x2 = cx + math.cos(angle) * (15 + length) + wobble
        y2 = cy - length * 0.7 + math.sin(angle) * length * 0.3
        x3 = cx + math.cos(angle + 0.3) * 10
        y3 = cy + math.sin(angle + 0.3) * 10
        draw.polygon([(x1, y1), (x2, y2), (x3, y3)], fill=flame_color)
    
    # Embers/sparks
    random.seed(999)
    for _ in range(30):
        angle = random.uniform(0, 2 * math.pi)
        dist = random.uniform(15, 50)
        x = cx + math.cos(angle) * dist
        y = cy - random.uniform(0, 40) + math.sin(angle) * dist * 0.3
        size = random.randint(1, 3)
        draw.ellipse([x, y, x + size, y + size], fill=(255, 180, 50, 200))

def draw_rocks_foreground(draw, width, height):
    """Draw rocks/boulders in foreground."""
    # Large boulder left
    draw.ellipse([50, height - 180, 220, height - 20], fill=(30, 35, 50), outline=(45, 50, 70))
    # Rock right
    draw.ellipse([width - 250, height - 150, width - 50, height - 30], fill=(35, 40, 55), outline=(50, 55, 75))
    # Small rocks near fire
    for x, y, r in [(350, height - 60, 25), (380, height - 45, 15), (width - 400, height - 70, 20)]:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(40, 45, 60))

def draw_footprints(draw, width, height, fire_x, fire_y):
    """Draw footprints in snow leading to/from fire."""
    # Footprints radiating from fire
    for angle in [0.3, 0.8, 2.2, 2.8, 3.5, 4.2, 5.0, 5.7]:
        for step in range(1, 6):
            dist = 60 + step * 35
            x = fire_x + math.cos(angle) * dist
            y = fire_y + math.sin(angle) * dist * 0.5 + height * 0.15
            if y > height - 100:
                continue
            # Footprint shape
            fp_w, fp_h = 18, 30
            opacity = max(80, 180 - step * 20)
            draw.ellipse([x - fp_w//2, y - fp_h//2, x + fp_w//2, y + fp_h//2], 
                        fill=(60, 70, 100, opacity), outline=(80, 90, 120, opacity))

def draw_trees(draw, width, height):
    """Draw silhouetted pine trees."""
    tree_positions = [
        (150, height * 0.7, 60),
        (300, height * 0.65, 80),
        (width - 200, height * 0.68, 70),
        (width - 350, height * 0.72, 55),
    ]
    for tx, ty, h in tree_positions:
        # Trunk
        draw.rectangle([tx - 4, ty, tx + 4, ty + h // 3], fill=(20, 22, 30))
        # Foliage layers
        for i in range(3):
            layer_h = h // 3
            layer_w = 25 + i * 8
            y_pos = ty + i * layer_h
            draw.polygon([
                (tx, y_pos - layer_h),
                (tx - layer_w, y_pos + layer_h // 2),
                (tx + layer_w, y_pos + layer_h // 2)
            ], fill=(25, 30, 40))

def add_text_overlay(img, width, height):
    """Add title text to the image."""
    draw = ImageDraw.Draw(img, 'RGBA')
    
    # Try to load a font, fallback to default
    try:
        title_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 72)
        subtitle_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 32)
    except:
        try:
            title_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 72)
            subtitle_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
        except:
            title_font = ImageFont.load_default()
            subtitle_font = ImageFont.load_default()
    
    # Title with glow effect
    title = "ВЫЖИВАНИЕ: ПОСЛЕДНИЙ КОСТЁР"
    subtitle = "survival"
    
    # Draw title glow
    for offset in range(8, 0, -1):
        alpha = 30 + offset * 20
        draw.text((width//2 + offset, height//2 - 180 + offset), title, 
                 font=title_font, fill=(255, 120, 30, alpha), anchor="mm")
    
    # Main title
    draw.text((width//2, height//2 - 180), title, font=title_font, 
             fill=(255, 230, 200), anchor="mm")
    
    # Subtitle
    draw.text((width//2, height//2 - 100), subtitle.upper(), font=subtitle_font,
             fill=(180, 190, 210), anchor="mm")
    
    # Tagline
    tagline = "холод • огонь • выбор"
    try:
        tag_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24)
    except:
        tag_font = subtitle_font
    draw.text((width//2, height - 120), tagline, font=tag_font,
             fill=(140, 150, 170), anchor="mm")

def main():
    # Create base image
    img = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 255))
    draw = ImageDraw.Draw(img, 'RGBA')
    
    # Background gradient
    create_gradient_bg(draw, WIDTH, HEIGHT)
    
    # Stars
    draw_stars(draw, WIDTH, HEIGHT)
    
    # Mountains
    draw_mountain_silhouette(draw, WIDTH, HEIGHT)
    
    # Trees
    draw_trees(draw, WIDTH, HEIGHT)
    
    # Snow particles
    draw_snow_particles(draw, WIDTH, HEIGHT)
    
    # Foreground rocks
    draw_rocks_foreground(draw, WIDTH, HEIGHT)
    
    # Campfire position (lower center)
    fire_x, fire_y = WIDTH // 2, HEIGHT - 120
    
    # Footprints
    draw_footprints(draw, WIDTH, HEIGHT, fire_x, fire_y)
    
    # Campfire (drawn last so it's on top)
    draw_campfire(draw, fire_x, fire_y)
    
    # Add text overlay
    add_text_overlay(img, WIDTH, HEIGHT)
    
    # Apply slight blur to background elements for depth
    # (skip - keep crisp for pixel art feel)
    
    # Save
    output_path = "assets/survival.png"
    img.save(output_path, "PNG")
    print(f"Saved cover art to {output_path}")
    print(f"Dimensions: {WIDTH}x{HEIGHT}")

if __name__ == "__main__":
    main()