"""
Prompt text for the AI Jewellery Assistant's two provider calls. Kept as plain string
constants in one place so the actual instructions given to whichever model is
configured are easy to review/audit without hunting through provider code.
"""

# --- Image preparation (ImageGenerationProvider) ---
# The governing principle (spec): "CUSTOMER'S JEWELLERY -> CLEAN CATALOGUE
# REPRESENTATION", never "AI INVENTS A NEW JEWELLERY DESIGN." Every instruction below is
# a preservation or removal instruction, never a redesign instruction.
#
# Deliberately explicit and repetitive about what to EXCLUDE (face/hair/skin/neck/
# clothes/hands/background), not just what to preserve -- a real failure mode this
# addresses: given a photo of a person WEARING jewellery, a softer "remove the
# background" instruction alone was observed to leave the model free to treat the
# whole photo (person included) as the subject, rather than isolating the jewellery
# item specifically worn somewhere on that person.
def build_image_preparation_prompt(category: str | None = None) -> str:
    category_line = f"\n\nCATEGORY: {category}" if category else ""
    return f"""You are processing a jewellery catalogue photograph.

The uploaded image may show the jewellery alone, or a person wearing it. Your task is \
to extract ONLY the jewellery item -- never the person.{category_line}

Do NOT return the person.
Do NOT return the person's face.
Do NOT return hair.
Do NOT return skin.
Do NOT return the neck, hands, or any other body part.
Do NOT return clothes or fabric.
Do NOT return the original background.

Identify the jewellery item itself and isolate it from everything else in the photo.

PRESERVE THE ORIGINAL JEWELLERY EXACTLY:
- exact jewellery structure and silhouette
- exact stone arrangement, color, and cut
- exact pendant/chain/clasp design
- exact metal color and finish (gold, silver, polish, antique tone, etc.)
- exact proportions and scale
- every visible decorative detail (engraving, filigree, enamel work, etc.)

Do not redesign it. Do not simplify it. Do not replace stones. Do not change stone or \
metal colors. Do not invent additional jewellery. Do not remove genuine jewellery \
components. Do not add decorative elements. Do not beautify or reinterpret the \
jewellery.

The final image must contain ONLY the jewellery, placed on a completely pure white \
background (#FFFFFF), centered, with sufficient white margin around it. Keep the \
complete item visible -- do not crop any part of it out.

Output an isolated jewellery catalogue product image. Nothing else from the original \
photograph should be visible."""


# --- Metadata suggestion (MetadataLLMProvider) ---
# Categories must match the existing catalogue exactly (apps/api/v1/schemas/category.py
# has no fixed enum -- categories are DB rows -- so the caller interpolates the live
# list of slugs here rather than this prompt hard-coding them, keeping this prompt
# correct even if an admin adds a new category later).
METADATA_SUGGESTION_PROMPT_TEMPLATE = """Look at this jewellery product photo and suggest catalogue details for it. \
Respond with ONLY a JSON object (no markdown, no commentary) with exactly these keys:

{{
  "name": "a short, descriptive product name (e.g. 'Lakshmi Temple Haaram')",
  "category_slug": "one of: {category_slugs}",
  "size": "one of: Small, Medium, Large",
  "style": "a short style descriptor (e.g. 'Temple', 'Kundan', 'Polki'), or null if unclear",
  "material": "primary material (e.g. 'Gold', 'Silver', 'Oxidized metal'), or null if unclear",
  "stone": "primary stone/gem type if visible (e.g. 'Emerald', 'Ruby', 'Cubic Zirconia'), or null if none visible",
  "description": "one or two factual sentences describing what is visible in the photo",
  "tags": ["short", "lowercase", "descriptive", "tags"]
}}

Base every field only on what is actually visible in the photo. Never invent a specific \
gemstone, material, or provenance claim you cannot see evidence of -- use null instead \
of guessing when something is genuinely unclear. "size" is a coarse display-size \
label, not a physical measurement -- never report a number of millimeters here."""
