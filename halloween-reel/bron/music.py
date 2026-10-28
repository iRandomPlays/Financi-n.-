# Original, self-composed music (no third-party samples) - 120 BPM, F major, 28 s.
import numpy as np, wave, sys

SR = 44100
BPM = 120
BEAT = 60 / BPM
DUR = 28.0
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)

def mtof(m): return 440 * 2 ** ((m - 69) / 12)

def add(sig, t, pan=0.0, gain=1.0):
    i = int(t * SR)
    if i >= N: return
    sig = sig[: N - i] * gain
    L[i:i + len(sig)] += sig * np.sqrt(0.5 * (1 - pan))
    R[i:i + len(sig)] += sig * np.sqrt(0.5 * (1 + pan))

def env(n, a=0.005, d=1.0):
    t = np.arange(n) / SR
    e = np.exp(-t / d)
    na = max(1, int(a * SR))
    e[:na] *= np.linspace(0, 1, na)
    e[-200:] *= np.linspace(1, 0, 200)
    return e

def celesta(m, dur=1.2):
    n = int(dur * SR); t = np.arange(n) / SR; f = mtof(m)
    s = (np.sin(2*np.pi*f*t) + 0.35*np.sin(2*np.pi*2*f*t)*np.exp(-t*6)
         + 0.15*np.sin(2*np.pi*4.01*f*t)*np.exp(-t*12))
    return s * env(n, 0.002, 0.45)

def pluck(m, dur=0.6, bright=0.5):
    # Karplus-Strong pizzicato
    f = mtof(m); n = int(dur * SR); p = int(SR / f)
    buf = rng.uniform(-1, 1, p)
    out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % p]
        buf[i % p] = 0.5 * (buf[i % p] + buf[(i + 1) % p]) * 0.996
    return out * env(n, 0.001, dur * 0.5)

def pad(ms, dur):
    n = int(dur * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for m in ms:
        f = mtof(m)
        for det in (-0.12, 0.0, 0.12):
            ff = f * 2 ** (det / 12)
            s += np.sin(2*np.pi*ff*t) + 0.3*np.sin(2*np.pi*2*ff*t) + 0.1*np.sin(2*np.pi*3*ff*t)
    a = np.minimum(1, t / 0.35); r = np.minimum(1, (dur - t) / 0.4)
    return s * a * np.clip(r, 0, 1) / (len(ms) * 3)

def noise_hit(dur, hp=0.0, decay=0.05):
    n = int(dur * SR); x = rng.normal(0, 1, n)
    if hp:  # crude high-pass via differencing
        x = np.diff(np.concatenate([[0], x]))
    return x * env(n, 0.001, decay)

def snap():
    n = int(0.12 * SR); t = np.arange(n) / SR
    x = rng.normal(0, 1, n)
    # band-ish: difference of two smoothed versions
    k1 = np.convolve(x, np.ones(3) / 3, 'same'); k2 = np.convolve(x, np.ones(14) / 14, 'same')
    return (k1 - k2) * np.exp(-t / 0.018) * 2.2

def kick():
    n = int(0.35 * SR); t = np.arange(n) / SR
    f = 50 + 70 * np.exp(-t / 0.04)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / 0.12)

F, Dm, Bb, C, Gm = [53, 57, 60], [50, 53, 57], [46, 50, 53], [48, 52, 55], [43, 46, 50]
prog = [F, Dm, Bb, C, F, Dm, Bb, C, Gm, C, F, F, Bb, F]   # 14 bars
roots = [41, 38, 46, 36, 41, 38, 46, 36, 43, 36, 41, 41, 46, 41]
bar = 4 * BEAT

# chord pad (warm bed)
for b, ch in enumerate(prog):
    dur = bar + 0.3 if b < 13 else 2.4
    if b == 12:  # Bb -> C in bar 12
        add(pad([m + 12 for m in Bb], 2 * BEAT + 0.2), b * bar, 0, 0.10)
        add(pad([m + 12 for m in C], 2 * BEAT + 0.2), b * bar + 2 * BEAT, 0, 0.10)
        continue
    add(pad([m + 12 for m in ch], dur), b * bar, 0, 0.10 if b >= 2 else 0.07)

# pizzicato walking bass (from bar 2 = 4 s)
for b in range(2, 13):
    r = roots[b]
    walk = [r, r + 7, r + 12, r + 7]
    if b == 12: walk = [46, 46 + 7, 48, 48 + 7]
    for k, m in enumerate(walk):
        add(pluck(m, 0.45), b * bar + k * BEAT, -0.1, 0.55)
add(pluck(41, 1.8), 13 * bar, -0.1, 0.6)

# music-box intro arpeggio (bars 0-1)
for b in range(2):
    ch = prog[b]
    pat = [ch[0] + 24, ch[1] + 24, ch[2] + 24, ch[1] + 24] * 2
    for k, m in enumerate(pat):
        add(celesta(m, 0.9), b * bar + k * BEAT / 2, 0.25, 0.20)

# playful melody (bars 2-12), (beat, midi, gain) per bar ; slight chromatic grace notes for a Halloween wink
mel = {
    2: [(0, 72), (0.5, 69), (1, 72), (1.5, 77), (2.5, 76), (3, 77)],
    3: [(0, 74), (1, 72), (1.5, 71), (2, 72), (3, 69)],
    4: [(0, 70), (0.5, 69), (1, 70), (1.5, 74), (2.5, 72), (3, 70)],
    5: [(0, 69), (1, 67), (1.5, 66), (2, 67), (3, 64)],
    6: [(0, 72), (0.5, 69), (1, 72), (1.5, 77), (2.5, 79), (3, 81)],
    7: [(0, 81), (0.5, 79), (1, 77), (1.5, 74), (2, 76), (3, 72)],
    8: [(0, 70), (0.5, 74), (1, 79), (2, 77), (2.5, 74), (3, 70)],
    9: [(0, 72), (0.5, 76), (1, 79), (2, 78), (2.5, 79), (3, 76)],
    10: [(0, 77), (0.5, 72), (1, 69), (1.5, 72), (2, 77), (3, 81)],
    11: [(0, 79), (1, 77), (1.5, 76), (2, 77), (3, 72)],
    12: [(0, 74), (0.5, 77), (1, 74), (1.5, 70), (2, 72), (2.5, 76), (3, 79)],
}
for b, notes in mel.items():
    for beat, m in notes:
        add(celesta(m, 1.1), b * bar + beat * BEAT, 0.2, 0.26)
        add(pluck(m - 12, 0.35), b * bar + beat * BEAT, -0.3, 0.12)
# final chime
for k, m in enumerate([65, 69, 72, 77, 81]):
    add(celesta(m, 2.5), 13 * bar + k * 0.06, 0.15, 0.22)

# light percussion: soft kick on 1&3, finger snaps on 2&4, shaker 8ths (bars 2-12)
for b in range(2, 13):
    for k in range(4):
        t = b * bar + k * BEAT
        if k in (0, 2): add(kick(), t, 0, 0.35)
        else: add(snap(), t, 0.3, 0.22)
        for h in range(2):
            add(noise_hit(0.08, hp=1, decay=0.02), t + h * BEAT / 2, -0.35, 0.05 if h else 0.035)
add(kick(), 13 * bar, 0, 0.3)

# simple stereo reverb
def reverb(x, seed):
    r = np.random.default_rng(seed)
    n = int(1.6 * SR); t = np.arange(n) / SR
    ir = r.normal(0, 1, n) * np.exp(-t / 0.35); ir[0] = 0
    ir /= np.sqrt(np.sum(ir ** 2))
    m = len(x) + n
    y = np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)[: len(x)]
    return y
L2 = L + 0.22 * reverb(L, 1); R2 = R + 0.22 * reverb(R, 2)

out = np.stack([L2, R2], 1)
t = np.arange(N) / SR
out *= np.clip((DUR - t) / 1.2, 0, 1)[:, None]          # fade-out at the end
out *= np.clip(t / 0.05, 0, 1)[:, None]
out = np.tanh(out / np.max(np.abs(out)) * 1.3) * 0.89   # gentle limiting
pcm = (out * 32767).astype(np.int16)
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('ok')
