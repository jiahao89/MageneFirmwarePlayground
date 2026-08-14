---
name: figma-lofi-prototype
description: Use when creating or revising structured Figma product-prototype maps, low-fidelity prototypes, wireflows, app or mini-program interaction flows, especially when the output should make all product links readable at a glance. Enforces the user's preferred style: Noto Sans SC, native Figma connector lines, provided decision components, native Sections that contain the related screens, solid positive flows, dashed negative flows, connector-label styling, and containment/overlap QA.
---

# Figma Low-Fidelity Prototype

Use this skill to turn a product idea, rough flow, or existing product prototype into a readable structured map in Figma. The goal is not visual polish. The goal is that the user can understand the product structure, page responsibilities, interaction paths, branch decisions, and section ownership at a glance.

## Required Tooling

- For all Figma write operations, load and follow the `figma:figma-use` skill before calling `use_figma`.
- If the product logic is unclear, first use the Product Design context workflow to restate the brief, user roles, key jobs, and core flows.
- Prefer existing Figma components, native connector lines, text styles, and variables from the target file over recreating them.

## Default Visual Rules

- Use `Noto Sans SC` for all prototype text.
- Use wireframe screens with simple black or dark-gray outlines and restrained fills.
- Use native Figma connector lines for flows. Do not fake connectors with ordinary line, vector, polygon, or path nodes unless the user explicitly approves an approximation.
- If the target file contains a connector template, clone it and restyle it instead of creating a manual line.
- Use a medium neutral gray close to `#8A94A6` for connector strokes so flow lines are distinct from screen wireframe strokes.
- Use the provided native shape-with-text decision component for decisions. Do not hand-draw decision diamonds.
- Decision text should use `Noto Sans SC`, usually bold, with a gray color close to the connector color.

## Structured Section Standard

When organizing existing product screens into a structured prototype map:

- Use native Figma `SECTION` nodes as containers. Do not simulate sections with detached rectangles, frames, or background blocks.
- Put each section's prototype screens, same-section connectors, and decision nodes inside that section as actual children.
- Use readable section names that describe the product link, such as `入口与基础能力`, `员工筛选链路`, or `商品图专员标准任务链路`.
- Keep the section name meaningful on its own. Avoid hiding critical meaning in internal prefixes or tiny labels.
- Same-section connectors should be children of the section and placed behind the screens/decisions in the child stack so the screens remain readable.
- Cross-section connectors may remain page-level when they link two different sections. Count and disclose them during QA instead of forcing them into the wrong section.
- Size each section from the absolute bounds of its contained screens and decision nodes, then add generous padding. A good default for dense mobile prototype maps is `padX = 260`, `padTop = 360`, and `padBottom = 260`.
- Keep enough space between sections that connectors, decision nodes, and prototype screens do not overlap.

## Flow Modeling First

Before drawing, identify these items:

1. The main object lifecycle or primary task path.
2. The root navigation pages, such as mini-program tab pages.
3. In-task pages that should not keep root tab navigation.
4. Decision points and branch conditions.
5. Positive paths, negative paths, recovery paths, and exits back to stable pages.
6. Direct-entry paths where the user bypasses the main orchestrator or planner.

For multi-agent products, model the orchestration clearly:

- The main planner or coordinator owns task intake, planning, routing, and final synthesis.
- Sub-agents each own a specific skill or domain.
- Users may either talk to a sub-agent directly or ask the planner to dispatch work across agents.
- The prototype should show both the planner-led path and the direct sub-agent path when both exist.

## Layout Rules

- Use a large section canvas and group screens by product state or flow lane.
- Put the primary lifecycle path in one clear direction, usually left-to-right.
- Put secondary or direct-entry paths in a separate lane below or beside the main path.
- Reserve whitespace corridors for connector lines before placing screens.
- Keep connectors outside screen bodies whenever possible.
- Avoid connector overlap with page frames, labels, screen content, decision nodes, and other connectors.
- Use long sparse connectors with readable labels rather than dense crisscrossing lines.
- If a negative or recovery path needs to return far backward, route it around the outside of the screen group.
- For structure-first handoff maps, prefer fewer larger sections over many tiny sections. The user should be able to scan every section and see the whole link without zooming into a knot of lines.

## Screen Rules

- Root tab pages may include the app tabbar.
- In-task execution pages, detail pages, modals, and focused chat/task pages should not keep the root tabbar unless the product explicitly supports switching tabs mid-task.
- Every in-task page must provide an obvious exit, such as back, close, return home, or view project.
- Keep each screen focused on one responsibility. Use annotations around the screen for explanation instead of crowding the screen UI.
- Use concise labels and page titles that describe user state, not implementation details.

## Connector Rules

- Positive or expected forward paths use solid native connectors.
- Negative, failed, cancelled, rejected, fallback, or backtracking paths use dashed native connectors.
- Do not over-classify neutral state labels as negative. For example, `筛选已失败` can be a filter/tab state rather than a failed branch, so keep it solid unless the actual interaction is a failure path.
- Connector labels should describe the trigger or condition, for example `确认拆解`, `需要多 Agent`, `取消`, `失败重试`, or `回首页`.
- Use the connector component's built-in text only. Do not create separate free-floating text nodes for connector labels.
- Remove connector-label background fills unless the user asks for a label chip. In the current preferred structured-map style, connector label text is white with no fill behind it.
- Place labels in whitespace and offset them away from page content.
- Do not allow connectors to pass through screen interiors except for short anchor segments at the edge.
- Do not let multiple connectors share the same exact route unless they are visually separated and labeled.
- Use different routes for positive and negative flows so the user can distinguish them quickly.
- Use `ELBOWED` connector paths for bent routes instead of composing a turn from multiple separate line segments.

## Replacing Existing Design Connectors

When the user asks to replace or repair connectors on an existing Figma design:

- Start from an existing native `CONNECTOR` in the target file or section. Copy/clone that connector as the style template instead of creating ordinary lines.
- If `figma.createConnector()` is unavailable in the current tool context, clone a same-style connector and retarget `connectorStart` / `connectorEnd`; do not fall back to manual line segments.
- Retarget connector endpoints to the outer screen/frame nodes and their magnets, usually `RIGHT` to `LEFT` for forward flow. Avoid anchoring to nested UI layers unless the user explicitly points to a specific control.
- Keep the connector's own label text as the source of truth. Rename the connector and update its internal connector text; do not add separate floating text.
- When replacing pasted screen frames, use the demonstrated Figma alignment pattern: Shift-select the reference frame and replacement frame, then use `Align right` and `Align top` to snap the replacement into the same position before deleting or reconnecting old elements.
- Use `Esc` to clear accidental deep selections, and use `Cmd+Z` immediately if dragging a connector endpoint or replacement frame snaps to the wrong layer.
- After replacement, inspect the actual selected node IDs or metadata to ensure connectors are attached to the intended frames, then screenshot the section to check that labels and routes do not cross screen interiors.

## Decision Nodes

- Clone the target file's approved decision component when one exists.
- Keep decision nodes between the pages they branch to, with enough whitespace on all sides.
- Use question-style labels for decision nodes, such as `是否需要多 Agent 协作？`.
- Branch labels should sit on the connector, not inside the decision node.

## Figma Implementation Notes

When using `use_figma`:

- Load `Noto Sans SC` font styles before creating or editing text.
- Import or clone existing connector and decision templates from the file when available.
- Return the page name, created frame IDs, connector IDs, and any reused template node IDs in the tool response.
- If a native connector cannot be created programmatically in the current file context, ask the user to paste one connector template into the file, then clone that template. Do not claim a manual line is a native connector.
- For connector replacement, prefer a script that clones a known-good connector and then sets `connectorStart`, `connectorEnd`, `connectorLineType`, stroke, dash pattern, and connector text. Preserve section parenting by appending the cloned connector to the same `SECTION`.
- Keep generated nodes named with stable prefixes, such as `P01`, `D01`, `F01`, and `L01`, so future edits can find and update them.
- When parenting existing nodes into a native `SECTION`, preserve absolute positions. `appendChild` changes the coordinate space, so first snapshot each node's `absoluteBoundingBox`, append it, then set `node.x = oldAbs.x - sectionAbs.x` and `node.y = oldAbs.y - sectionAbs.y`.
- When moving or resizing a section after children are already inside it, snapshot child absolute positions first, update the section, then restore each child's local coordinates from the saved absolute positions.
- Recompute section bounds from child absolute positions rather than from stale local coordinates.
- Prefer the reusable helper template in `scripts/structure_wireflow_sections.js` for section containment, connector styling, and QA checks.

## QA Before Final Response

Before telling the user the prototype is done, inspect the result with metadata and, when possible, a screenshot. Fix problems before finalizing.

Check all of these:

- All visible text uses `Noto Sans SC`.
- Decision nodes use the approved shape-with-text component style.
- Connectors are native connector lines or clearly disclosed approximations.
- Positive flows are solid; negative and recovery flows are dashed.
- Connector labels use the native connector text field, not separate text nodes.
- Connector label backgrounds are removed and connector label text matches the current style, usually white.
- Connector color is distinct from screen outlines.
- No connector crosses through a screen body unnecessarily.
- No connector label overlaps page content, page titles, or other labels.
- No major connector routes overlap each other.
- Prototype screens and decision nodes that belong to a section are actual children of that section.
- Section containment validates from absolute bounds: every contained screen/decision should sit inside its parent section's absolute bounding box.
- Same-section connectors are children of their section; cross-section connectors remain page-level only when they truly link across sections.
- The count of unexpectedly top-level prototype screens and decision nodes is zero for the structured section set.
- Report the concrete QA numbers when useful: section containment failures, top-level screen/decision counts, same-section connector count, cross-section connector count, solid connector count, dashed connector count, and connector labels that still have background fills.
- Root tabbar appears only on true root tab pages.
- In-task pages have clear exits back to home, project detail, or the prior step.
- The canvas reads like a product flow, not a pile of isolated screens.
