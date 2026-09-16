"""
Generates the Milestone 3 synthetic evaluation dataset under evaluation/users/.

Per the spec: "create a small controlled evaluation dataset organized by scenario...
Do NOT commit private/customer images — use synthetic (programmatically generated,
e.g. simple PIL-drawn face-like shapes / solid color images / noise images ...) or
appropriately licensed test images, and document their source/generation method and
license in the evaluation folder." This script IS that documentation (its own
docstrings + comments describe exactly how each image is built) plus the generator
itself — every image under evaluation/users/ is either produced by this script or is
the one real, separately-licensed OpenCV sample documented in
evaluation/data/test_images/SOURCES.md.

HONESTY NOTE, read before assuming these images will make MediaPipe "detect a face":
these are simple geometric/PIL-drawn shapes, not photographs. Real MediaPipe face/hand/
pose detection is a real neural network trained on real photographs and, correctly,
mostly does NOT classify a crude drawn oval as a face — that is documented as an actual
observed result in docs/milestone-3-verification.md §9, not hidden or worked around.
These images are still useful for exercising this project's OWN code paths end-to-end
(the full worker pipeline, quality checks, honest "no face detected" handling,
readiness logic) against real image bytes flowing through the real pipeline, which is
a genuine and useful thing to test even when the underlying detector correctly reports
"nothing found." Where the scenario specifically needs a real per-scenario finding
(e.g. "does our code correctly report ears as not visible"), the corresponding unit
tests in ai/tests/ construct realistic MediaPipe-shaped landmark data directly instead
of depending on a drawn image being detected — see those test files' own docstrings.

Run with: python evaluation/scripts/generate_synthetic_dataset.py
"""
import os
import random

from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "users")

SKIN = (222, 184, 135)
HAIR = (60, 40, 30)
SHIRT = (90, 110, 160)
BG = (235, 235, 235)


def _base_canvas(w=640, h=800):
    img = Image.new("RGB", (w, h), BG)
    return img, ImageDraw.Draw(img)


def _draw_body(draw, w, h, shoulder_width_ratio=0.55):
    shoulder_y = int(h * 0.55)
    shoulder_half = int(w * shoulder_width_ratio / 2)
    cx = w // 2
    draw.polygon(
        [
            (cx - shoulder_half, h),
            (cx - shoulder_half, shoulder_y + 40),
            (cx - int(shoulder_half * 0.4), shoulder_y),
            (cx + int(shoulder_half * 0.4), shoulder_y),
            (cx + shoulder_half, shoulder_y + 40),
            (cx + shoulder_half, h),
        ],
        fill=SHIRT,
    )


def _draw_face(draw, cx, cy, face_w, face_h, hide_left_ear=False, hide_right_ear=False, offset_x=0):
    draw.ellipse([cx - face_w / 2 + offset_x, cy - face_h / 2, cx + face_w / 2 + offset_x, cy + face_h / 2], fill=SKIN)
    # Ears: small ovals on either side of the face.
    ear_w, ear_h = face_w * 0.14, face_h * 0.22
    left_ear_box = [cx - face_w / 2 - ear_w * 0.5 + offset_x, cy - ear_h / 2, cx - face_w / 2 + ear_w * 0.5 + offset_x, cy + ear_h / 2]
    right_ear_box = [cx + face_w / 2 - ear_w * 0.5 + offset_x, cy - ear_h / 2, cx + face_w / 2 + ear_w * 0.5 + offset_x, cy + ear_h / 2]
    draw.ellipse(left_ear_box, fill=SKIN)
    draw.ellipse(right_ear_box, fill=SKIN)
    # Eyes, nose, mouth for visual completeness (not relied upon for detection).
    eye_y = cy - face_h * 0.08
    draw.ellipse([cx - face_w * 0.22 + offset_x, eye_y, cx - face_w * 0.1 + offset_x, eye_y + face_h * 0.06], fill=(40, 30, 20))
    draw.ellipse([cx + face_w * 0.1 + offset_x, eye_y, cx + face_w * 0.22 + offset_x, eye_y + face_h * 0.06], fill=(40, 30, 20))
    draw.line([cx + offset_x, cy, cx + offset_x, cy + face_h * 0.15], fill=(170, 130, 100), width=3)
    draw.arc([cx - face_w * 0.15 + offset_x, cy + face_h * 0.18, cx + face_w * 0.15 + offset_x, cy + face_h * 0.32], 0, 180, fill=(120, 60, 60), width=3)
    # Hair covering ears, when requested (drawn OVER the ear ellipses).
    if hide_left_ear:
        draw.rectangle([cx - face_w / 2 - ear_w * 1.2 + offset_x, cy - ear_h, cx - face_w * 0.15 + offset_x, cy + ear_h], fill=HAIR)
    if hide_right_ear:
        draw.rectangle([cx + face_w * 0.15 + offset_x, cy - ear_h, cx + face_w / 2 + ear_w * 1.2 + offset_x, cy + ear_h], fill=HAIR)
    # Hair cap on top, always.
    draw.pieslice([cx - face_w / 2 + offset_x, cy - face_h * 0.75, cx + face_w / 2 + offset_x, cy + face_h * 0.05], 180, 360, fill=HAIR)


def _draw_hand(draw, cx, cy, scale=1.0):
    palm_w, palm_h = 60 * scale, 80 * scale
    draw.ellipse([cx - palm_w / 2, cy - palm_h / 2, cx + palm_w / 2, cy + palm_h / 2], fill=SKIN)
    for i in range(5):
        fx = cx - palm_w / 2 + i * (palm_w / 4)
        draw.rectangle([fx, cy - palm_h / 2 - 35 * scale, fx + 10 * scale, cy - palm_h / 2 + 5], fill=SKIN)


def generate_front(path):
    img, draw = _base_canvas()
    w, h = img.size
    _draw_body(draw, w, h)
    _draw_face(draw, w / 2, h * 0.28, 180, 220)
    img.save(path)


def generate_45_degree(path):
    img, draw = _base_canvas()
    w, h = img.size
    _draw_body(draw, w, h)
    # A turned head is approximated by an asymmetric ellipse + shifted features.
    _draw_face(draw, w / 2, h * 0.28, 140, 220, hide_right_ear=True, offset_x=20)
    img.save(path)


def generate_side(path):
    img, draw = _base_canvas()
    w, h = img.size
    _draw_body(draw, w, h)
    _draw_face(draw, w / 2, h * 0.28, 100, 220, hide_right_ear=True, offset_x=60)
    img.save(path)


def generate_ear_visible(path):
    img, draw = _base_canvas()
    w, h = img.size
    _draw_body(draw, w, h)
    _draw_face(draw, w / 2, h * 0.28, 180, 220)
    img.save(path)


def generate_ear_hidden(path):
    img, draw = _base_canvas()
    w, h = img.size
    _draw_body(draw, w, h)
    _draw_face(draw, w / 2, h * 0.28, 180, 220, hide_left_ear=True, hide_right_ear=True)
    img.save(path)


def generate_hand_visible(path):
    img, draw = _base_canvas()
    w, h = img.size
    _draw_body(draw, w, h)
    _draw_face(draw, w / 2, h * 0.22, 150, 190)
    _draw_hand(draw, w * 0.25, h * 0.75, scale=1.3)
    _draw_hand(draw, w * 0.75, h * 0.75, scale=1.3)
    img.save(path)


def generate_hand_hidden(path):
    img, draw = _base_canvas()
    w, h = img.size
    _draw_body(draw, w, h)
    _draw_face(draw, w / 2, h * 0.22, 150, 190)
    img.save(path)


def generate_low_light(path):
    img, draw = _base_canvas()
    w, h = img.size
    _draw_body(draw, w, h)
    _draw_face(draw, w / 2, h * 0.28, 180, 220)
    # Real, measured darkening: multiply every pixel down (not just relabeled).
    dark = Image.eval(img, lambda p: int(p * 0.12))
    dark.save(path)


def generate_blurred(path):
    img, draw = _base_canvas()
    w, h = img.size
    _draw_body(draw, w, h)
    _draw_face(draw, w / 2, h * 0.28, 180, 220)
    blurred = img.filter(ImageFilter.GaussianBlur(radius=18))
    blurred.save(path)


def generate_multiple_faces(path):
    img, draw = _base_canvas()
    w, h = img.size
    _draw_body(draw, w, h)
    _draw_face(draw, w * 0.32, h * 0.28, 130, 160)
    _draw_face(draw, w * 0.68, h * 0.28, 130, 160)
    img.save(path)


def generate_no_face(path, seed=42):
    random.seed(seed)
    img = Image.effect_noise((640, 800), 60).convert("RGB")
    img.save(path)


SCENARIOS = {
    "front": generate_front,
    "45_degree": generate_45_degree,
    "side": generate_side,
    "ear_visible": generate_ear_visible,
    "ear_hidden": generate_ear_hidden,
    "hand_visible": generate_hand_visible,
    "hand_hidden": generate_hand_hidden,
    "low_light": generate_low_light,
    "blurred": generate_blurred,
    "multiple_faces": generate_multiple_faces,
    "no_face": generate_no_face,
}


def main():
    for scenario, fn in SCENARIOS.items():
        scenario_dir = os.path.join(OUT_DIR, scenario)
        os.makedirs(scenario_dir, exist_ok=True)
        out_path = os.path.join(scenario_dir, f"{scenario}_01.jpg" if scenario != "no_face" else f"{scenario}_01.png")
        fn(out_path)
        print(f"generated {out_path}")


if __name__ == "__main__":
    main()
