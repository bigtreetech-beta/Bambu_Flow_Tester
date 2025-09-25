export type SvgOptions = {
  bedWidth?: number; // mm
  bedLength?: number; // mm
  margin?: number; // mm
  gridStep?: number; // mm
  filamentDiameter?: number; // mm, used for blob sizing
  blobMinE?: number; // mm of filament to consider blob
  blobMaxXY?: number; // mm max XY move to be blob
  blobScale?: number; // visual scale factor for blob radius
  strokeTravel?: string;
  strokeExtrude?: string;
  strokeBlob?: string;
  strokeWidthTravel?: number;
  strokeWidthExtrude?: number;
  strokeWidthBlob?: number;
  fontFamily?: string;
  fontSize?: number;
};

type State = {
  x: number;
  y: number;
  z: number;
  e: number;
  absPos: boolean; // G90/G91 (XYZE positioning)
  absExtrude: boolean; // M82/M83 (E positioning)
};

function mm2(val: number) {
  return Number.isFinite(val) ? +val : 0;
}

export function gcodeToSvg(gcode: string, opts: SvgOptions = {}): string {
  const {
    bedWidth = 220,
    bedLength = 220,
    margin = 5,
    gridStep = 20,
    filamentDiameter = 1.75,
    blobMinE = 20,
    blobMaxXY = 0.1,
    blobScale = 0.06,
    strokeTravel = "#F00",
    strokeExtrude = "#0b79d0",
    strokeBlob = "#cc3300",
    strokeWidthTravel = 0.6,
    strokeWidthExtrude = 2.0,
    strokeWidthBlob = 3,
    fontFamily = "Arial, sans-serif",
    fontSize = 4,
  } = opts;

  // We'll auto-fit the preview to the actual G-code extents.
  // First pass: compute bounding box of all XY positions in the G-code.
  const lines = gcode.split(/\r?\n/);

  let minX = Number.POSITIVE_INFINITY,
    minY = Number.POSITIVE_INFINITY,
    maxX = Number.NEGATIVE_INFINITY,
    maxY = Number.NEGATIVE_INFINITY;

  // State copy for first pass
  const stFirst: State = {
    x: 0,
    y: 0,
    z: 0,
    e: 0,
    absPos: true,
    absExtrude: true,
  };

  function markPoint(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  // include initial position
  markPoint(stFirst.x, stFirst.y);

  for (const raw of lines) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    const cmd = parts[0].toUpperCase();

    if (cmd === "G90") {
      stFirst.absPos = true;
      continue;
    }
    if (cmd === "G91") {
      stFirst.absPos = false;
      continue;
    }
    if (cmd === "M82") {
      stFirst.absExtrude = true;
      continue;
    }
    if (cmd === "M83") {
      stFirst.absExtrude = false;
      continue;
    }
    if (cmd === "G92") {
      let nx = stFirst.x,
        ny = stFirst.y,
        nz = stFirst.z,
        ne = stFirst.e;
      for (const p of parts.slice(1)) {
        const axis = p[0].toUpperCase();
        const val = mm2(parseFloat(p.slice(1)));
        if (axis === "X") nx = val;
        if (axis === "Y") ny = val;
        if (axis === "Z") nz = val;
        if (axis === "E") ne = val;
      }
      stFirst.x = nx;
      stFirst.y = ny;
      stFirst.z = nz;
      stFirst.e = ne;
      markPoint(stFirst.x, stFirst.y);
      continue;
    }

    if (cmd === "G0" || cmd === "G1") {
      let tx = stFirst.x,
        ty = stFirst.y,
        tz = stFirst.z,
        te = stFirst.e;
      let hasX = false,
        hasY = false,
        hasZ = false,
        hasE = false;

      for (const p of parts.slice(1)) {
        const axis = p[0].toUpperCase();
        const val = mm2(parseFloat(p.slice(1)));
        if (!Number.isFinite(val)) continue;
        if (axis === "X") {
          hasX = true;
          tx = stFirst.absPos ? val : stFirst.x + val;
        }
        if (axis === "Y") {
          hasY = true;
          ty = stFirst.absPos ? val : stFirst.y + val;
        }
        if (axis === "Z") {
          hasZ = true;
          tz = stFirst.absPos ? val : stFirst.z + val;
        }
        if (axis === "E") {
          hasE = true;
          te = stFirst.absExtrude ? val : stFirst.e + val;
        }
      }

      const dx = (hasX ? tx : stFirst.x) - stFirst.x;
      const dy = (hasY ? ty : stFirst.y) - stFirst.y;

      const moveXY = Math.hypot(dx, dy);
      if (moveXY > 1e-9) {
        // mark both endpoints
        markPoint(stFirst.x, stFirst.y);
        markPoint(stFirst.x + dx, stFirst.y + dy);
      }

      stFirst.x += dx;
      stFirst.y += dy;
      stFirst.z += hasZ ? tz - stFirst.z : 0;
      stFirst.e += hasE ? te - stFirst.e : 0;
      continue;
    }
  }

  // If no moves found, fall back to the bed size extents
  if (minX === Number.POSITIVE_INFINITY) {
    minX = 0;
    minY = 0;
    maxX = bedWidth;
    maxY = bedLength;
  }

  // bounding box of actual content
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;

  // Canvas in mm: ensure at least bed size so bed drawing still makes sense
  const W = Math.max(bedWidth, bboxW) + 2 * margin;
  const H = Math.max(bedLength, bboxH) + 2 * margin;

  // Compute translation so that content's minX maps to 'margin'
  const offsetX = margin - minX;

  // Coordinate transform: shift by computed offset
  const toSvgX = (x: number) => offsetX + x;
  // Flip Y so that G-code Y increases upward in the preview.
  // SVG Y axis grows downward, so map content Y into an inverted coordinate space
  // while keeping the bed rectangle and grid drawn in the normal top-left oriented coords.
  // We map content Y such that minY -> margin and maxY -> margin + bboxH, but inverted:
  // svgY = margin + (maxY - y)
  const toSvgY = (y: number) => margin + (maxY - y);

  const areaFilament = Math.PI * Math.pow(filamentDiameter / 2, 2); // mm²

  const st: State = {
    x: 0,
    y: 0,
    z: 0,
    e: 0,
    absPos: true, // default G90
    absExtrude: true, // default M82
  };

  // We’ll build SVG elements as strings
  const elements: string[] = [];

  // Background + bed
  // elements.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#000"/>`);
  elements.push(
    `
    <rect x="${margin}" y="${margin}" width="${bedWidth}" height="${bedLength}" fill="#3f3f46"/>
    <rect x="${margin}" y="${margin + bedLength}" width="${
      bedWidth / 2
    }" height="${bedLength / 25}" fill="#3f3f46"/>
    `
  );

  // Grid
  if (gridStep > 0) {
    for (let x = margin; x <= margin + bedWidth + 0.001; x += gridStep) {
      elements.push(
        `<line x1="${x}" y1="${margin}" x2="${x}" y2="${
          margin + bedLength
        }" stroke="#4b4b53" stroke-width="0.3"/>`
      );
    }
    for (let y = margin; y <= margin + bedLength + 0.001; y += gridStep) {
      elements.push(
        `<line x1="${margin}" y1="${y}" x2="${
          margin + bedWidth
        }" y2="${y}" stroke="#4b4b53" stroke-width="0.3"/>`
      );
    }
  }

  // Toolpaths: store as immediate <path> segments (simple <line> for clarity)
  const pathSegments: string[] = [];
  const travelSegments: string[] = [];

  // Blob markers
  const blobCircles: string[] = [];
  // Pending label (set when we see an M117 containing flow) and rendered at next XY move
  let pendingLabel: string | null = null;

  // Helper to draw a move
  function drawMove(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    isExtruding: boolean
  ) {
    const sx0 = toSvgX(x0),
      sy0 = toSvgY(y0);
    const sx1 = toSvgX(x1),
      sy1 = toSvgY(y1);
    const seg = `<line stroke-dasharray="2 1" x1="${sx0}" y1="${sy0}" x2="${sx1}" y2="${sy1}" stroke="${
      isExtruding ? strokeExtrude : strokeTravel
    }" stroke-width="${
      isExtruding ? strokeWidthExtrude : strokeWidthTravel
    }" stroke-linecap="round"/>`;
    (isExtruding ? pathSegments : travelSegments).push(seg);
  }

  // Detect blob (mostly Z+E, no/little XY)
  function addBlobAt(x: number, y: number, dE: number) {
    // Convert extruded filament length to plastic volume
    const volume = areaFilament * dE; // mm^3 (filament in)
    // Visual radius scaled to sqrt(volume) for nicer growth
    const r = Math.sqrt(Math.max(volume, 0)) * blobScale;
    const cx = toSvgX(x),
      cy = toSvgY(y);
    blobCircles.push(
      `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(
        3
      )}" fill="none" stroke="${strokeBlob}" stroke-width="${strokeWidthBlob}"/>`
    );
  }

  // Parse G-code (second pass): generate SVG elements using the computed transform
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, "").trim(); // strip comments
    if (!line) continue;

    const parts = line.split(/\s+/);
    const cmd = parts[0].toUpperCase();

    // Mode changes
    if (cmd === "G90") {
      st.absPos = true;
      continue;
    }
    if (cmd === "G91") {
      st.absPos = false;
      continue;
    }
    if (cmd === "M82") {
      st.absExtrude = true;
      continue;
    }
    if (cmd === "M83") {
      st.absExtrude = false;
      continue;
    }
    if (cmd === "M117") {
      // M117 message often contains the flow like '200°C // 8mm3/s; F9.98mm/min'
      const msg = raw.split(/\s+/).slice(1).join(" ");
      // console.log("M117 message:", msg);
      // Extract temperature, flow, and F value
      // temperature data sometimes present but unused in preview
      /* const tempMatch = msg.match(/([0-9]+(?:\.[0-9]+)?)\s*°C/i); */
      const flowMatch = msg.match(/([0-9]+(?:\.[0-9]+)?)\s*mm3\/s/i);
      const fMatch = msg.match(/F\s*([0-9]+(?:\.[0-9]+)?)\s*mm\/min/i);

      let label = "";
      // if (tempMatch) label += `${tempMatch[1]}ºC`;
      if (flowMatch) label += (label ? " - " : "") + `F ${flowMatch[1]}`;
      if (fMatch) label += (label ? " - " : "") + `FR ${fMatch[1]}`;

      if (label) pendingLabel = label;
      continue;
    }
    if (cmd === "G92") {
      // Reset axes present
      let nx = st.x,
        ny = st.y,
        nz = st.z,
        ne = st.e;
      for (const p of parts.slice(1)) {
        const axis = p[0].toUpperCase();
        const val = mm2(parseFloat(p.slice(1)));
        if (axis === "X") nx = val;
        if (axis === "Y") ny = val;
        if (axis === "Z") nz = val;
        if (axis === "E") ne = val;
      }
      st.x = nx;
      st.y = ny;
      st.z = nz;
      st.e = ne;
      continue;
    }

    // Motion (G0/G1)
    if (cmd === "G0" || cmd === "G1") {
      let tx = st.x,
        ty = st.y,
        tz = st.z,
        te = st.e;
      let hasX = false,
        hasY = false,
        hasZ = false,
        hasE = false;

      for (const p of parts.slice(1)) {
        const axis = p[0].toUpperCase();
        const val = mm2(parseFloat(p.slice(1)));
        if (!Number.isFinite(val)) continue;

        if (axis === "X") {
          hasX = true;
          tx = st.absPos ? val : st.x + val;
        }
        if (axis === "Y") {
          hasY = true;
          ty = st.absPos ? val : st.y + val;
        }
        if (axis === "Z") {
          hasZ = true;
          tz = st.absPos ? val : st.z + val;
        }
        if (axis === "E") {
          hasE = true;
          te = st.absExtrude ? val : st.e + val;
        }
      }

      const dx = (hasX ? tx : st.x) - st.x;
      const dy = (hasY ? ty : st.y) - st.y;
      const dz = (hasZ ? tz : st.z) - st.z;
      const dE = (hasE ? te : st.e) - st.e;

      const moveXY = Math.hypot(dx, dy);

      // Draw XY segment if there is XY movement
      if (moveXY > 1e-6) {
        drawMove(st.x, st.y, st.x + dx, st.y + dy, dE > 1e-6);
        // If we have a pending label (from M117), render it at the target XY
        if (pendingLabel) {
          const sx = toSvgX(st.x + dx);
          const sy = toSvgY(st.y + dy);
          elements.push(
            `<text x="${sx + 2}" y="${
              sy + 10
            }" font-family="${fontFamily}" font-size="${fontSize}" fill="#FFF">${pendingLabel}</text>`
          );
          pendingLabel = null;
        }
      }

      // Blob detection: big extrusion with almost no XY change
      if (dE > blobMinE && moveXY <= blobMaxXY) {
        addBlobAt(st.x, st.y, dE);
      }

      // Update state
      st.x += dx;
      st.y += dy;
      st.z += dz;
      st.e += dE;
      continue;
    }

    // Ignore other commands for 2D preview (M104, M140, M117, G4, etc.)
  }

  // Push paths (travel first so extrusion sits on top)
  elements.push(...travelSegments);
  elements.push(...pathSegments);
  elements.push(...blobCircles);

  // Wrap up SVG
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600px" viewBox="0 0 ${W} ${H}">\n` +
    elements.join("\n") +
    `\n</svg>`;

  return svg;
}
