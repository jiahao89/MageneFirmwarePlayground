// Paste/adapt this helper inside a Figma `use_figma` call when restructuring
// existing product prototype screens into readable native Sections.
//
// This is a template, not a standalone local script. Fill SECTION_SPECS with
// the target file's real node names/IDs and run inside the Figma plugin context.

const SECTION_PADDING = {
  x: 260,
  top: 360,
  bottom: 260,
};

const CONNECTOR_STROKE = {
  type: "SOLID",
  color: { r: 0x8a / 255, g: 0x94 / 255, b: 0xa6 / 255 },
  opacity: 0.82,
};

const CONNECTOR_TEXT_WHITE = {
  type: "SOLID",
  color: { r: 1, g: 1, b: 1 },
  opacity: 1,
};

const SECTION_SPECS = [
  // Example:
  // {
  //   name: "员工筛选链路",
  //   screenIds: ["118:1234", "118:1235"],
  //   decisionIds: ["118:2234"],
  //   sameSectionConnectorIds: ["118:3234"],
  // }
];

function absRect(node) {
  const box = node.absoluteBoundingBox;
  if (!box) return null;
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    right: box.x + box.width,
    bottom: box.y + box.height,
  };
}

function unionRects(rects) {
  const usable = rects.filter(Boolean);
  if (!usable.length) return null;
  const left = Math.min(...usable.map((rect) => rect.x));
  const top = Math.min(...usable.map((rect) => rect.y));
  const right = Math.max(...usable.map((rect) => rect.right));
  const bottom = Math.max(...usable.map((rect) => rect.bottom));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    right,
    bottom,
  };
}

function isNegativeFlow(label) {
  const text = String(label || "");
  if (text.includes("筛选已失败")) return false;
  return /不足|失败返还|异常|错误|取消|拒绝|失败重试|回退|退回/.test(text);
}

function snapshotAbs(nodes) {
  return new Map(
    nodes
      .map((node) => [node.id, { node, rect: absRect(node) }])
      .filter(([, value]) => value.rect)
  );
}

function restoreLocalFromAbs(parent, snapshot) {
  const parentRect = absRect(parent);
  if (!parentRect) return;
  for (const { node, rect } of snapshot.values()) {
    node.x = rect.x - parentRect.x;
    node.y = rect.y - parentRect.y;
  }
}

function moveNodesIntoSection(section, nodes) {
  const moving = nodes.filter(Boolean);
  const before = snapshotAbs(moving);
  for (const node of moving) {
    if (node.parent !== section) section.appendChild(node);
  }
  restoreLocalFromAbs(section, before);
}

function resizeSectionAroundChildren(section, boundNodes, padding = SECTION_PADDING) {
  const childRects = boundNodes.map(absRect).filter(Boolean);
  const bounds = unionRects(childRects);
  if (!bounds) return null;

  const children = section.children ? [...section.children] : [];
  const before = snapshotAbs(children);

  const nextX = bounds.x - padding.x;
  const nextY = bounds.y - padding.top;
  const nextW = bounds.width + padding.x * 2;
  const nextH = bounds.height + padding.top + padding.bottom;

  section.x = nextX;
  section.y = nextY;
  section.resizeWithoutConstraints(nextW, nextH);
  restoreLocalFromAbs(section, before);

  return absRect(section);
}

function connectorLabel(connector) {
  if (!connector) return "";
  if (connector.text && typeof connector.text.characters === "string") {
    return connector.text.characters;
  }
  return "";
}

function styleConnector(connector) {
  if (!connector || connector.type !== "CONNECTOR") return;

  connector.connectorLineType = "ELBOWED";
  connector.strokes = [CONNECTOR_STROKE];
  connector.strokeWeight = 3;
  connector.dashPattern = isNegativeFlow(connectorLabel(connector)) ? [12, 8] : [];

  if (connector.text) {
    connector.text.fills = [CONNECTOR_TEXT_WHITE];
  }
  if (connector.textBackground) {
    connector.textBackground.fills = [];
  }
}

function containsRect(container, child, tolerance = 1) {
  return (
    child.x >= container.x - tolerance &&
    child.y >= container.y - tolerance &&
    child.right <= container.right + tolerance &&
    child.bottom <= container.bottom + tolerance
  );
}

function validateSectionContainment(sections) {
  const failures = [];
  for (const section of sections) {
    const sectionRect = absRect(section);
    if (!sectionRect || !section.children) continue;
    for (const child of section.children) {
      if (!["FRAME", "COMPONENT", "INSTANCE", "SHAPE_WITH_TEXT"].includes(child.type)) {
        continue;
      }
      const childRect = absRect(child);
      if (childRect && !containsRect(sectionRect, childRect)) {
        failures.push({
          section: section.name,
          sectionId: section.id,
          child: child.name,
          childId: child.id,
        });
      }
    }
  }
  return failures;
}

async function structureWireflowSections(page = figma.currentPage) {
  const sections = [];
  const crossSectionConnectors = [];

  for (const spec of SECTION_SPECS) {
    const screenNodes = (spec.screenIds || []).map((id) => figma.getNodeById(id)).filter(Boolean);
    const decisionNodes = (spec.decisionIds || []).map((id) => figma.getNodeById(id)).filter(Boolean);
    const connectorNodes = (spec.sameSectionConnectorIds || [])
      .map((id) => figma.getNodeById(id))
      .filter((node) => node && node.type === "CONNECTOR");

    const section = figma.createSection();
    section.name = spec.name;
    page.appendChild(section);

    const boundNodes = [...screenNodes, ...decisionNodes];
    const bounds = unionRects(boundNodes.map(absRect));
    if (bounds) {
      section.x = bounds.x - SECTION_PADDING.x;
      section.y = bounds.y - SECTION_PADDING.top;
      section.resizeWithoutConstraints(
        bounds.width + SECTION_PADDING.x * 2,
        bounds.height + SECTION_PADDING.top + SECTION_PADDING.bottom
      );
    }

    moveNodesIntoSection(section, [...connectorNodes, ...screenNodes, ...decisionNodes]);
    resizeSectionAroundChildren(section, boundNodes);

    for (const connector of connectorNodes) {
      styleConnector(connector);
      section.insertChild(0, connector);
    }

    sections.push(section);
  }

  for (const node of page.findAll((node) => node.type === "CONNECTOR")) {
    styleConnector(node);
    if (node.parent === page) crossSectionConnectors.push(node);
  }

  return {
    sectionCount: sections.length,
    crossSectionConnectorCount: crossSectionConnectors.length,
    containmentFailures: validateSectionContainment(sections),
  };
}
