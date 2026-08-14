#!/usr/bin/env python3
"""Print bundled design-system documents required for one design task."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]


def unique(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


def main() -> int:
    parser = argparse.ArgumentParser(description="Route a design task to bundled Magene design rules.")
    parser.add_argument(
        "--target",
        required=True,
        action="append",
        choices=("onelap-app", "magene-c706", "low-design", "geoid"),
        help="Repeat for a cross-device flow.",
    )
    parser.add_argument("--task", required=True, choices=("screen", "flow", "system"))
    parser.add_argument("--tool", required=True, choices=("figma", "stitch", "pendev", "none"))
    parser.add_argument("--device", default="")
    parser.add_argument("--size", default="", help="Display size in pixels, for example 320x480.")
    parser.add_argument("--mode", default="n-a", choices=("dark", "light", "both", "n-a"))
    args = parser.parse_args()

    manifest_path = SKILL_ROOT / "references" / "design-manifest.json"
    with manifest_path.open(encoding="utf-8") as handle:
        manifest = json.load(handle)

    targets = unique(args.target)
    required = list(manifest["base"])
    blocking: list[str] = []
    notes: list[str] = []

    if args.task == "flow" and len(targets) < 2:
        blocking.append("flow is for cross-device work. Provide at least two different --target values.")

    for target in targets:
        profile = manifest["targets"][target]
        required.extend(profile["documents"])
        if target == "onelap-app":
            notes.append("顽鹿 App color preflight: page=#0A1011, card=#151E1E, primary=#C6FF00. Do not copy a conflicting reference color.")
        if target == "low-design":
            notes.append("LowDesign preflight: C706 frame=320x480, mode=Night Vector dark, primary=#C6FF00, route=#2D78FF. Do not replace the official C706 light system or add a bottom key-mapping bar.")
        if args.mode not in profile["mode"]:
            blocking.append(
                f"{profile['label']} does not have an approved {args.mode} mode. Choose one of: {', '.join(profile['mode'])}."
            )
        if profile.get("requires_device"):
            if not args.device:
                blocking.append("GEOID is a brand, not a device model. Confirm a device model before designing.")
            if not re.fullmatch(r"\d{2,5}[x×]\d{2,5}", args.size):
                blocking.append("Confirm GEOID display size as <width>x<height> pixels, for example 320x480, before designing.")

    required.extend(manifest["tasks"][args.task])
    tool_file = manifest["tools"][args.tool]
    if tool_file:
        required.append(tool_file)
    if {"geoid", "low-design"}.intersection(targets) and args.tool != "none":
        notes.append("Tool files define mechanics only. Visual tokens and components come only from the selected target system.")

    required = unique(required)
    paths = [SKILL_ROOT / item for item in required]
    missing = [path for path in paths if not path.is_file()]
    print("Design context")
    print(f"  Target system(s): {', '.join(targets)}")
    print(f"  Task: {args.task}")
    print(f"  Device: {args.device or 'not specified'}")
    print(f"  Size: {args.size or 'not specified'}")
    print(f"  Mode: {args.mode}")
    print(f"  Tool: {args.tool}")
    print("\nRequired reading")
    for path in required:
        print(f"  - {SKILL_ROOT / path}")

    if blocking:
        print("\nBlocking questions")
        for warning in blocking:
            print(f"  - {warning}")
    if notes:
        print("\nExecution notes")
        for note in notes:
            print(f"  - {note}")
    if missing:
        print("\nMissing required files")
        for path in missing:
            print(f"  - {path.relative_to(SKILL_ROOT)}")
        return 2
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
