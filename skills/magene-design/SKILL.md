---
name: magene-design
description: Route any Onelap App, Magene C706, GEOID, or cross-device prototype, screen, component, visual review, or design-system task to the bundled design rules before design work begins.
---

# Magene Design Gate

Use this self-contained Skill before creating, modifying, or reviewing a prototype, screen, component, visual rule, or App/device flow. Its `references/` directory is the authoritative rule set; it does not require a host project's `DESIGN.md`, `AGENTS.md`, or design-system directory.

## 1. Resolve the design context

Resolve these fields from the request and the confirmed product requirements:

```text
Target: onelap-app | magene-c706 | geoid
Task: screen | flow | system
Device: mandatory for GEOID
Size: mandatory for GEOID, in `<width>x<height>` pixels (for example `320x480`)
Mode: dark | light | both | n/a
Tool: figma | stitch | pendev | none
```

`flow` means a cross-device flow and requires at least two different targets. GEOID is a brand, not a device model. If the GEOID device, size, or mode is missing, ask the product owner before producing the final design.

Run the bundled route check from any working directory:

```bash
python3 <skill-dir>/scripts/design_route.py \
  --target <onelap-app|magene-c706|geoid> [--target <...>] \
  --task <screen|flow|system> --tool <figma|stitch|pendev|none> \
  [--device <model>] [--size <width>x<height>] [--mode <dark|light|both|n-a>]
```

Read every file returned under `Required reading`. They are bundled under `<skill-dir>/references/` and are the sole design-rule source for this Skill.

Before prototyping complex App, device, or accessory work, make sure the requirements define the relevant objects and fields, states, events, operations, page states, and transitions. If a gap changes scope, the main flow, interaction, device capability, or communication behavior, ask the product owner; otherwise record it as an open question. Do not convert an assumption into a confirmed rule.

Before generating a design, run the target system's token preflight. For `onelap-app`, explicitly state `page=#0A1011`, `card=#151E1E`, and `primary=#C6FF00`. Existing Figma references are layout references only; never copy a conflicting primary color from them.

## 2. Announce the context

Before generating or editing, report this concise card:

```text
Target system(s):
Task:
Device and size:
Mode:
Tool:
Required reading completed:
Hard constraints:
Open questions:
```

For `onelap-app`, add this line to the context card:

```text
顽鹿主色校验：#C6FF00 已确认并将用于主操作/选中态/品牌强调
```

## 3. Design and review

- Use the selected brand, device, surface, and tool rules; the route output and context card remain the working contract. Product requirements define page scope, allowed actions, and business states; this Skill defines the visual and interaction system.
- Complete the route-specific visual and interaction checks before delivery.

## 4. Report completion

State the target system(s), task, device, mode, rules used, and any unresolved assumptions. If a constraint could not be verified in the selected tool, report it instead of claiming compliance.
