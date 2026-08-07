#!/usr/bin/env python3
"""Contrast verification — FRONTEND.md §4.1.3.

Recomputes the WCAG 2.1 relative-luminance contrast ratio for every colour
pair the design system commits to, and fails the build if any pair drops
below its documented minimum. The ratios in FRONTEND.md's table are
themselves the *output* of this formula (the doc says "computed by WCAG 2.1
relative-luminance formula"); this script is what makes that a checked fact
rather than an assertion that could silently drift from the token values in
tokens.css.

Note on the pair count: FRONTEND §4.1.3's prose says "28 of 28 pairs pass",
but the table beneath it lists 27 rows. That is a pre-existing inconsistency
in the approved spec (found while writing this script, not introduced by
it) — this script checks the 27 pairs the table actually documents rather
than inventing a 28th to make the count match.

`--color-border` (`#D4D8DE` on white, 1.43:1) is deliberately excluded: the
spec states it is "decorative only and never the sole boundary of an
interactive control", so it carries no contrast requirement.
"""

import sys


def hex_to_rgb(value: str) -> tuple[float, float, float]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _channel_to_linear(channel: int) -> float:
    c = channel / 255.0
    if c <= 0.03928:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb: tuple[float, float, float]) -> float:
    r, g, b = (_channel_to_linear(int(c)) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(fg_hex: str, bg_hex: str) -> float:
    l1 = relative_luminance(hex_to_rgb(fg_hex))
    l2 = relative_luminance(hex_to_rgb(bg_hex))
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


# (label, foreground, background, minimum ratio) — transcribed verbatim from
# FRONTEND.md §4.1.3's table, in the same order.
PAIRS: list[tuple[str, str, str, float]] = [
    ("Body text on page", "#16191D", "#FFFFFF", 4.5),
    ("Body text on surface", "#16191D", "#F7F8F9", 4.5),
    ("Secondary text on page", "#5A626D", "#FFFFFF", 4.5),
    ("Secondary text on surface", "#5A626D", "#F7F8F9", 4.5),
    ("Muted text on page", "#6B737E", "#FFFFFF", 4.5),
    ("Input border", "#868D97", "#FFFFFF", 3.0),
    ("Input border on surface", "#868D97", "#F7F8F9", 3.0),
    ("Primary link/text", "#0B5FA5", "#FFFFFF", 4.5),
    ("Primary hover", "#094C84", "#FFFFFF", 4.5),
    ("Label on primary fill", "#FFFFFF", "#0B5FA5", 4.5),
    ("Label on primary hover fill", "#FFFFFF", "#094C84", 4.5),
    ("Focus ring", "#0B5FA5", "#FFFFFF", 3.0),
    ("Success on tint", "#0E6E3F", "#E8F5EE", 4.5),
    ("Success on page", "#0E6E3F", "#FFFFFF", 4.5),
    ("Warning on tint", "#8A5A00", "#FDF3E0", 4.5),
    ("Warning on page", "#8A5A00", "#FFFFFF", 4.5),
    ("Danger on tint", "#A32218", "#FDECEA", 4.5),
    ("Danger on page", "#A32218", "#FFFFFF", 4.5),
    ("Label on danger fill", "#FFFFFF", "#A32218", 4.5),
    ("Info on tint", "#0B5FA5", "#E8F1F9", 4.5),
    ("Neutral on tint", "#5A626D", "#EDEFF2", 4.5),
    ("Crisis text", "#6B1018", "#FDF2F3", 7.0),
    ("Crisis link", "#5C0E14", "#FDF2F3", 7.0),
    ("Crisis on white", "#6B1018", "#FFFFFF", 7.0),
    ("Kiosk text", "#F2F4F7", "#101418", 4.5),
    ("Kiosk serial", "#4FA3E3", "#101418", 4.5),
    ("Kiosk muted", "#A8B2BF", "#101418", 4.5),
]


def main() -> int:
    failures = 0
    for label, fg, bg, minimum in PAIRS:
        ratio = contrast_ratio(fg, bg)
        passed = ratio >= minimum
        if not passed:
            failures += 1
        status = "PASS" if passed else "FAIL"
        print(f"[{status}] {label:<30} {fg} on {bg}  {ratio:.2f}:1  (min {minimum:.1f}:1)")

    total = len(PAIRS)
    print(f"\n{total - failures} of {total} pairs pass.")
    if failures:
        print(f"{failures} pair(s) below the required minimum — see FRONTEND.md §4.1.3.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
