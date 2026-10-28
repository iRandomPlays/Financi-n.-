import math, subprocess, sys, functools
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

S = sys.argv[1]            # scratch dir
OUT = sys.argv[2]
PREVIEW = len(sys.argv) > 3  # render only stills at given times
W, H, FPS, DUR = 1080, 1920, 30, 28.0
NF = int(DUR * FPS)
SRC_W, SRC_H, NSRC = 1280, 720, 744

# ---------- palette (from the menu card) ----------
CREAM = (250, 244, 233)
COPPER = (164, 94, 48)
COPPER_D = (128, 70, 34)
GOLD = (201, 160, 92)
ORANGE = (226, 128, 52)

FD = S + '/fonts/'
def font(name, size, var=None):
    f = ImageFont.truetype(FD + name, size)
    if var: f.set_variation_by_name(var)
    return f
TITLE = font('PlayfairDisplay%5Bwght%5D.ttf', 70, 'SemiBold')
TITLE_BIG = font('PlayfairDisplay%5Bwght%5D.ttf', 74, 'SemiBold')
DATE = font('CormorantGaramond-Italic%5Bwght%5D.ttf', 74, 'SemiBold Italic')
ITEM = font('CormorantGaramond-Italic%5Bwght%5D.ttf', 61, 'SemiBold Italic')
TAG = font('CormorantGaramond-Italic%5Bwght%5D.ttf', 56, 'SemiBold Italic')

def ease(x):
    x = min(1, max(0, x)); return x * x * (3 - 2 * x)
def ease_out(x):
    x = min(1, max(0, x)); return 1 - (1 - x) ** 3

# ---------- source frames ----------
@functools.lru_cache(maxsize=48)
def src(i):
    i = int(min(NSRC - 1, max(0, i)))
    return Image.open(f'{S}/slow/f{i + 1:04d}.jpg').convert('RGB')

# segments: out start, out end, src start frame (slowed timeline @30fps), keyframes (cx, cy, h) start->end
XF = 0.5
SEGS = [
    (0.0, 4.25, 0,   (870, 360, 720), (900, 330, 640)),     # opening through the doorway
    (3.75, 10.25, 120, (560, 380, 720), (880, 380, 660)),   # pan along the table
    (9.75, 17.25, 300, (640, 450, 580), (720, 440, 520)),   # close on the food
    (16.75, 22.25, 465, (760, 420, 620), (860, 430, 560)),  # juice & drinks side
    (21.75, 28.0, 562, (660, 380, 720), (640, 360, 720)),   # closing wide shot
]

def seg_frame(seg, t):
    a, b, s0, k0, k1 = seg
    u = ease((t - a) / (b - a))
    cx = k0[0] + (k1[0] - k0[0]) * u; cy = k0[1] + (k1[1] - k0[1]) * u; h = k0[2] + (k1[2] - k0[2]) * u
    w = h * 9 / 16
    cx = min(SRC_W - w / 2, max(w / 2, cx)); cy = min(SRC_H - h / 2, max(h / 2, cy))
    im = src(s0 + (t - a) * FPS)
    return im.resize((W, H), Image.LANCZOS, box=(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2))

# cinematic warm grade
def make_lut():
    x = np.arange(256) / 255.0
    s = x + 0.10 * np.sin(2 * np.pi * x) * (x * (1 - x)) * 4 * 0.35   # gentle S-curve
    s = 0.5 + (s - 0.5) * 1.13 - 0.01
    r = np.clip(s * 1.03 + 0.012, 0, 1); g = np.clip(s * 1.0 + 0.004, 0, 1); b = np.clip(s * 0.92 + 0.02, 0, 1)
    return [int(v * 255 + .5) for v in np.concatenate([r, g, b])]
LUT = make_lut()
yy, xx = np.mgrid[0:H, 0:W]
d = np.sqrt(((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H * 0.47) / (H * 0.62)) ** 2)
VIG = np.clip(1 - 0.38 * np.clip(d - 0.45, 0, 1) ** 1.6, 0, 1)[..., None].astype(np.float32)
GLOW = np.exp(-(((xx - W * 0.18) / 520.0) ** 2 + ((yy - H * 0.12) / 620.0) ** 2))[..., None].astype(np.float32)
GLOWC = np.array([255, 196, 120], np.float32)

def base(t):
    segs = [sg for sg in SEGS if sg[0] <= t < sg[1] or (sg is SEGS[-1] and t >= sg[0])]
    im = seg_frame(segs[0], t)
    if len(segs) > 1:
        im2 = seg_frame(segs[1], t)
        im = Image.blend(im, im2, ease((t - segs[1][0]) / XF))
    im = im.point(LUT)
    a = np.asarray(im).astype(np.float32)
    lum = a.mean(axis=2, keepdims=True)
    a = (lum + (a - lum) * 1.12) * VIG
    g = 0.10 + 0.04 * math.sin(t * 1.3)        # soft breathing light leak
    a = a + (GLOWC - a) * (GLOW * g)
    if t < 0.6: a *= ease(t / 0.6) * 0.9 + 0.1   # fade from dark-warm
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert('RGBA')

# ---------- graphics sprites ----------
def pumpkin(size, body=ORANGE, stem=(110, 80, 45), seed=0):
    ss = 4; P = size * ss
    im = Image.new('RGBA', (P, int(P * 1.05)), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    cy = int(P * 0.62); rh = int(P * 0.40)
    dark = tuple(int(c * 0.78) for c in body); light = tuple(min(255, int(c * 1.12)) for c in body)
    lobes = [(-0.30, 0.26, dark), (0.30, 0.26, dark), (-0.16, 0.30, body), (0.16, 0.30, body), (0, 0.27, light)]
    for ox, rw, col in lobes:
        x = P / 2 + ox * P
        d.ellipse([x - rw * P, cy - rh, x + rw * P, cy + rh], fill=col + (255,))
    for ox in (-0.22, -0.08, 0.08, 0.22):   # ribs
        x = P / 2 + ox * P
        d.arc([x - 0.07 * P, cy - rh * 0.95, x + 0.07 * P, cy + rh * 0.95], 100 if ox < 0 else -80, 260 if ox < 0 else 80,
              fill=dark + (180,), width=max(2, P // 90))
    d.polygon([(P * .47, cy - rh * .9), (P * .53, cy - rh * .9), (P * .57, cy - rh * 1.45), (P * .51, cy - rh * 1.5)], fill=stem + (255,))
    d.ellipse([P * .58, cy - rh * 1.42, P * .74, cy - rh * 1.18], fill=(122, 140, 74, 255))  # little leaf
    hl = Image.new('RGBA', im.size, (0, 0, 0, 0)); ImageDraw.Draw(hl).ellipse(
        [P * .33, cy - rh * .75, P * .45, cy - rh * .2], fill=(255, 240, 210, 70))
    im = Image.alpha_composite(im, hl.filter(ImageFilter.GaussianBlur(P // 40)))
    return im.resize((size, int(size * 1.05)), Image.LANCZOS)

def leaf(size, col):
    ss = 4; P = size * ss
    im = Image.new('RGBA', (P, P), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    pts = []
    for k in range(200):   # maple-ish outline
        a = 2 * math.pi * k / 200
        r = 0.36 + 0.10 * math.cos(5 * a) + 0.03 * math.cos(15 * a)
        r *= 1 - 0.25 * max(0, math.sin(a)) ** 6
        pts.append((P / 2 + r * P * math.cos(a - math.pi / 2), P / 2 + r * P * math.sin(a - math.pi / 2)))
    d.polygon(pts, fill=col + (255,))
    vc = tuple(int(c * 0.8) for c in col) + (255,)
    for a in (-90, -18, -162, 54, 126):
        rad = math.radians(a)
        d.line([(P / 2, P / 2), (P / 2 + 0.33 * P * math.cos(rad), P / 2 + 0.33 * P * math.sin(rad))], fill=vc, width=P // 70)
    d.line([(P / 2, P / 2), (P / 2, P * 0.95)], fill=vc, width=P // 45)
    return im.resize((size, size), Image.LANCZOS)

LEAF_COLS = [(196, 112, 48), (214, 150, 66), (168, 86, 42), (224, 170, 90), (186, 128, 70)]
rng = np.random.default_rng(3)
LEAVES = []
for i in range(9):
    sz = int(rng.uniform(46, 78))
    LEAVES.append(dict(img=leaf(sz, LEAF_COLS[i % 5]), x0=rng.uniform(40, 1040), t0=rng.uniform(-14, 28),
                       sp=rng.uniform(70, 110), sway=rng.uniform(30, 70), fr=rng.uniform(0.4, 0.8),
                       rot=rng.uniform(-60, 60), a=rng.uniform(0.55, 0.85)))

PUMPKIN_ICON = pumpkin(96)
P_BIG = pumpkin(270, ORANGE)
P_MID = pumpkin(225, (222, 182, 138))
P_SM = pumpkin(195, (238, 222, 180))

def paste(canvas, sprite, x, y, alpha=1.0, rot=0.0, scale=1.0):
    if alpha <= 0.01: return
    s = sprite
    if scale != 1.0:
        s = s.resize((max(1, int(s.width * scale)), max(1, int(s.height * scale))), Image.LANCZOS)
    if rot: s = s.rotate(rot, resample=Image.BICUBIC, expand=True)
    if alpha < 1:
        a = s.getchannel('A').point(lambda v: int(v * alpha)); s = s.copy(); s.putalpha(a)
    canvas.alpha_composite(s, (int(x - s.width / 2), int(y - s.height / 2)))

def text_sprite(txt, fnt, fill, spacing=0, shadow=True):
    # letter-spaced text with a soft warm glow behind it for legibility
    asc, desc = fnt.getmetrics()
    widths = [fnt.getlength(c) for c in txt]
    tw = int(sum(widths) + spacing * (len(txt) - 1)) + 2
    th = asc + desc
    pad = 30
    im = Image.new('RGBA', (tw + 2 * pad, th + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(im); x = pad
    for c, wch in zip(txt, widths):
        d.text((x, pad), c, font=fnt, fill=fill); x += wch + spacing
    if shadow:
        sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
        sh.putalpha(im.getchannel('A').filter(ImageFilter.GaussianBlur(10)).point(lambda v: min(255, int(v * 1.1))))
        tint = Image.new('RGBA', im.size, (255, 248, 236, 0)); tint.putalpha(sh.getchannel('A'))
        im = Image.alpha_composite(tint, im)
    return im

def card(w, h, alpha=226):
    ss = 2
    im = Image.new('RGBA', (w * ss, h * ss), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, w * ss - 1, h * ss - 1], radius=36 * ss, fill=CREAM + (alpha,))
    d.rounded_rectangle([14 * ss, 14 * ss, w * ss - 14 * ss, h * ss - 14 * ss], radius=26 * ss, outline=GOLD + (220,), width=2 * ss)
    im = im.resize((w, h), Image.LANCZOS)
    sh = Image.new('RGBA', (w + 80, h + 80), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([40, 50, w + 40, h + 50], radius=36, fill=(60, 35, 15, 70))
    sh = sh.filter(ImageFilter.GaussianBlur(18)); sh.alpha_composite(im, (40, 40))
    return sh

def ornament(w):
    im = Image.new('RGBA', (w, 30), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.line([(0, 15), (w / 2 - 22, 15)], fill=GOLD + (230,), width=2)
    d.line([(w / 2 + 22, 15), (w, 15)], fill=GOLD + (230,), width=2)
    d.polygon([(w / 2, 5), (w / 2 + 10, 15), (w / 2, 25), (w / 2 - 10, 15)], fill=GOLD + (255,))
    return im

# text content (taken from the menu card)
ITEMS = {
    1: (4.15, ['Verschillende soorten broodjes', 'Verse croissants', 'Hartig & zoet beleg', 'Huisgemaakte eiersalade']),
    2: (10.15, ['Huisgemaakte granola & yoghurt', 'Vers bereide zoetigheden', 'Vers fruit']),
    3: (17.15, ['Verse jus d’orange', 'Verfrissend smaakwater']),
}
ENDS = {1: 9.85, 2: 16.85, 3: 21.85}
CX = 505          # content centre x: kept left of the Reels action buttons
CARD_W = 850
ITEM_SPR = {k: [text_sprite(s, ITEM, COPPER, 0, shadow=False) for s in v[1]] for k, v in ITEMS.items()}
for k, v in ITEM_SPR.items():
    mw = max(s.width for s in v) - 60
    if mw > CARD_W - 90:
        raise SystemExit(f'item too wide {mw}')
CARDS = {k: card(CARD_W, 70 + 92 * len(v) + 40) for k, v in ITEM_SPR.items()}
ORN = ornament(300)

T_TITLE = text_sprite('HALLOWEEN ONTBIJT', TITLE, COPPER_D, 4)
T_DATE = text_sprite('Zaterdag 31 oktober', DATE, COPPER, 1)
T_TITLE_B = text_sprite('HALLOWEEN ONTBIJT', TITLE_BIG, COPPER_D, 4)
T_TAG1 = text_sprite('Geniet van een heerlijk en', TAG, COPPER, 0, shadow=False)
T_TAG2 = text_sprite('gezellig herfstontbijt!', TAG, COPPER, 0, shadow=False)
for s in (T_TITLE, T_TITLE_B):
    assert s.width - 60 < 880, s.width
TITLE_CARD = card(960, 310, 214)
END_CARD = card(960, 440, 214)
TAG_CARD = card(800, 210, 226)

def overlay(t, cv):
    # falling leaves (sparser while text is shown)
    for L in LEAVES:
        age = t - L['t0']
        y = -80 + age * L['sp']
        if y < -80 or y > H + 80: continue
        x = L['x0'] + L['sway'] * math.sin(age * L['fr'] * 2)
        paste(cv, L['img'], x, y, L['a'], rot=L['rot'] + 25 * math.sin(age * L['fr'] * 1.7))

    # scene 1 - opening title
    if t < 4.0:
        a_in = ease_out((t - 0.5) / 0.9); a_out = 1 - ease((t - 3.55) / 0.4)
        a = a_in * a_out
        if a > 0:
            y0 = 215 + (1 - a_in) * 40
            paste(cv, TITLE_CARD, 540, y0 + 165, a)
            paste(cv, PUMPKIN_ICON, 540, y0 + 66 + 6 * math.sin(t * 3), a, rot=6 * math.sin(t * 2.2))
            paste(cv, T_TITLE, 540, y0 + 155, a)
            paste(cv, ORN, 540, y0 + 212, a * ease((t - 1.0) / 0.6))
            ad = ease_out((t - 1.0) / 0.8) * a_out
            paste(cv, T_DATE, 540 + (1 - ad) * 30, y0 + 265, ad)

    # scenes 2-4 - menu items
    for k, (t0, lines) in ITEMS.items():
        t1 = ENDS[k]
        if not (t0 <= t < t1 + 0.1): continue
        a_card = ease_out((t - t0) / 0.6) * (1 - ease((t - (t1 - 0.45)) / 0.45))
        cardim = CARDS[k]
        top = 1500 - cardim.height + 40
        paste(cv, cardim, CX, top + cardim.height / 2 + (1 - a_card) * 50, a_card)
        paste(cv, ORN, CX, top + 75 + (1 - a_card) * 50, a_card)
        step = (t1 - 0.6 - (t0 + 0.4)) / (len(lines) + 1.2)
        step = min(step, 1.0)
        for j, spr in enumerate(ITEM_SPR[k]):
            ts = t0 + 0.4 + j * step
            ai = ease_out((t - ts) / 0.55) * (1 - ease((t - (t1 - 0.45)) / 0.45))
            y = top + 140 + j * 92 + (1 - a_card) * 50
            paste(cv, spr, CX - (1 - ai) * 60, y, ai)

    # scene 5 - closing
    if t >= 22.0:
        a = ease_out((t - 22.2) / 0.9)
        y0 = 360 + (1 - a) * 40
        paste(cv, END_CARD, 540, y0 + 170, a)
        sc = 1 + 0.02 * math.sin((t - 22) * 2.5)
        paste(cv, T_TITLE_B, 540, y0 + 110, a, scale=sc)
        paste(cv, ORN, 540, y0 + 190, a * ease((t - 22.8) / 0.6))
        ad = ease_out((t - 23.0) / 0.8)
        paste(cv, T_DATE, 540, y0 + 260 + (1 - ad) * 20, ad)
        at = ease_out((t - 24.0) / 0.9)
        paste(cv, TAG_CARD, CX, 1240 + (1 - at) * 40, at)
        paste(cv, T_TAG1, CX, 1210 + (1 - at) * 40, at)
        paste(cv, T_TAG2, CX, 1278 + (1 - at) * 40, at)
        # pumpkins pop in one by one with a soft bounce, then wobble gently
        for i, (spr, x, y, td) in enumerate([(P_MID, 330, 1500, 24.8), (P_BIG, 190, 1555, 25.1), (P_SM, 480, 1570, 25.4)]):
            u = (t - td) / 0.6
            if u <= 0: continue
            s = 1 + 0.18 * math.sin(min(u, 1) * math.pi) * (1 - min(u, 1)) if u < 1 else 1
            s *= ease_out(u)
            wob = 4 * math.sin((t - td) * 3 + i)
            paste(cv, spr, x, y - 10 * math.sin(min(u, 1) * math.pi), min(1, u * 2), rot=wob, scale=max(0.05, s))
    return cv

def frame(t):
    return overlay(t, base(t)).convert('RGB')

if PREVIEW:
    for ts in sys.argv[3].split(','):
        frame(float(ts)).save(f'{S}/prev_{ts}.jpg', quality=90)
    sys.exit()

ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS),
                       '-i', '-', '-i', f'{S}/music.wav',
                       '-vf', 'unsharp=5:5:0.45:5:5:0,noise=alls=3:allf=t', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
                       '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
                       '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', OUT],
                      stdin=subprocess.PIPE)
for i in range(NF):
    ff.stdin.write(frame(i / FPS).tobytes())
    if i % 60 == 0: print(i, flush=True)
ff.stdin.close(); ff.wait()
print('done', ff.returncode)
