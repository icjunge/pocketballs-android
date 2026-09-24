"""Create short, original, deterministic ball collision samples (PCM WAV)."""
from pathlib import Path
import math
import random
import struct
import wave

root = Path(__file__).resolve().parents[1] / 'app/src/main/assets/audio'
root.mkdir(parents=True, exist_ok=True)
rate = 22050
profiles = {'soccer': (172, .12, .21), 'tennis': (310, .075, .42),
            'basketball': (116, .17, .12), 'volleyball': (215, .115, .25)}
for index, (name, (hz, duration, noise)) in enumerate(profiles.items()):
    rng = random.Random(120 + index)
    samples, low, phase = [], 0., 0.
    for i in range(int(duration * rate)):
        t = i / rate
        phase += 2 * math.pi * hz * (.68 + .32 * math.exp(-t * 40)) / rate
        low += .28 * (rng.uniform(-1, 1) - low)
        body = math.sin(phase) + .22 * math.sin(phase * 1.62)
        attack = min(1., t / .0015)
        tail = min(1., (duration - t) / .008)
        value = attack * tail * (body * math.exp(-t * 34) * (1-noise) + low * noise * math.exp(-t * 80))
        samples.append(struct.pack('<h', round(max(-1, min(1, value*.56)) * 32767)))
    with wave.open(str(root / f'{name}.wav'), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(b''.join(samples))
    print(f'{name}.wav: {len(samples)} samples')
