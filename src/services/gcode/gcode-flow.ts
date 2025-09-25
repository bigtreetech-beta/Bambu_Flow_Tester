import { printers } from "./printers";

function getCurrentSettings(values: Record<string, any> = {}) {
  const getValue = (keys: string[] | string, d: any) => {
    // Accept either a single key or an array where the first element is used.
    const key = Array.isArray(keys) ? keys[0] : (keys as string);
    if (!key) return d;
    if (!Object.prototype.hasOwnProperty.call(values, key)) return d;
    const raw = (values as any)[key];
    if (raw === undefined || raw === null || raw === "") return d;

    // Numbers
    if (typeof d === "number") {
      const n = typeof raw === "number" ? raw : parseFloat(String(raw).trim());
      return Number.isFinite(n) ? n : d;
    }

    // Booleans
    if (typeof d === "boolean") {
      if (typeof raw === "boolean") return raw;
      const s = String(raw).trim().toLowerCase();
      return s === "true" || s === "1";
    }

    // Strings
    if (typeof raw === "string") return raw.trim();
    return raw;
  };

  const settings = {
    // core geometry & material
    bedWidth: getValue("bedWidth", 180),
    bedLength: getValue("bedLength", 180),
    // legacy single margin; prefer bedMarginX/bedMarginY when provided
    bedMargin: getValue("bedMargin", 20),
    bedMarginX: getValue("bedMarginX", undefined),
    bedMarginY: getValue("bedMarginY", undefined),
    filamentDiameter: getValue("filamentDiameter", 1.75),

    // motion & timing
    movementSpeed: getValue("movementSpeed", 60), // mm/s
    stabilizationTime: getValue("stabilizationTime", 3), // s

    // temps/fan
    bedTemp: getValue("bedTemp", 60),
    startTemp: getValue("startTemp", 200),
    tempOffset: getValue("tempOffset", 0),
    tempSteps: getValue("tempSteps", 1),
    fanSpeed: getValue("fanSpeed", 0), // %

    // priming/wipe
    primeLength: getValue("primeLength", 10),
    primeAmount: getValue("primeAmount", 3),
    primeSpeed: getValue("primeSpeed", 5),
    wipeLength: getValue("wipeLength", 10),

    // retract
    retractionDistance: getValue("retractionDistance", 1),
    retractionSpeed: getValue("retractionSpeed", 30),

    // blob
    blobHeight: getValue("blobHeight", 5),
    extrusionAmount: getValue("extrusionAmount", 50),

    // layout
    xSpacing: getValue("xSpacing", 25),
    ySpacing: getValue("ySpacing", 25),
    direction: getValue("direction", 0), // 0 normal, 1 mirror Y

    // flow series
    startFlow: getValue("startFlow", 2),
    flowOffset: getValue("flowOffset", undefined),
    flowSteps: getValue("flowSteps", undefined),
    endFlow: getValue("endFlow", undefined),
  };

  // derive flowOffset if missing but endFlow present
  if (
    !Number.isFinite(settings.flowOffset) &&
    Number.isFinite(settings.endFlow)
  ) {
    settings.flowOffset =
      settings.flowSteps > 1
        ? (settings.endFlow - settings.startFlow) / (settings.flowSteps - 1)
        : 0;
  }
  if (!Number.isFinite(settings.flowOffset)) settings.flowOffset = 2;

  return settings;
}

export function generateGcode(
  selectedPrinterIndex: number,
  rawValues: Record<string, any>
) {
  // destructure for convenience (after mapping/derivations)
  let {
    bedWidth,
    bedLength,
    // support new per-axis margins; fall back to symmetric bedMargin for backward compatibility
    bedMargin: _bedMargin,
    bedMarginX: _bedMarginX,
    bedMarginY: _bedMarginY,
    filamentDiameter,
    movementSpeed,
    stabilizationTime,
    bedTemp,
    fanSpeed,
    primeLength,
    primeAmount,
    primeSpeed,
    wipeLength,
    retractionDistance,
    retractionSpeed,
    blobHeight,
    extrusionAmount,
    xSpacing,
    ySpacing,
    startFlow,
    flowOffset,
    flowSteps,
    endFlow,
    startTemp,
    tempOffset,
    direction,
  } = getCurrentSettings(rawValues);

  const bedLengthSave = bedLength;
  // Resolve final margins: priority bedMarginX/bedMarginY -> bedMargin (legacy) -> 0
  const bedMarginX = Number.isFinite(_bedMarginX)
    ? _bedMarginX
    : Number.isFinite(_bedMargin)
    ? _bedMargin
    : 0;
  const bedMarginY = Number.isFinite(_bedMarginY)
    ? _bedMarginY
    : Number.isFinite(_bedMargin)
    ? _bedMargin
    : 0;
  const maxColumnsPerPlate = Math.max(
    1,
    Math.floor(
      (bedWidth - (Math.abs(bedMarginX) + Math.abs(bedMarginX))) /
        (primeLength + wipeLength + xSpacing)
    )
  );

  const maxRowsPerPlate = Math.max(
    1,
    Math.floor(
      (bedLength - (Math.abs(bedMarginY) + Math.abs(bedMarginY))) / ySpacing
    )
  );

  // Prepare effective geometry for direction (don't mutate originals)
  const effectiveBedLength = direction === 1 ? 0 : bedLength;
  const effectiveBedMargin = direction === 1 ? -bedMarginY : bedMarginY;
  const effectiveYSpacing = direction === 1 ? -ySpacing : ySpacing;

  // Build a list of candidate grid positions (preserve the original ordering
  // used by the algorithm: columns increase outer, rows inner). Then filter
  // out any positions that fall inside printer-specific excludedAreas.
  const printer = printers[selectedPrinterIndex] || ({} as any);
  const excludedAreas: Array<{
    x: number;
    y: number;
    width: number;
    depth: number;
  }> = printer.excludedAreas || [];

  const candidatePositions: Array<{
    localCol: number;
    localRow: number;
    x: number;
    y: number;
  }> = [];

  for (let localCol = 1; localCol <= maxColumnsPerPlate; localCol++) {
    for (let localRow = 1; localRow <= maxRowsPerPlate; localRow++) {
      const columnX =
        Math.abs(bedMarginX) +
        (localCol - 1) * (primeLength + wipeLength + xSpacing);
      const rowY =
        effectiveBedLength -
        effectiveBedMargin -
        (localRow - 1) * effectiveYSpacing;

      // test whether this point lies inside any excluded area
      const insideExcluded = excludedAreas.some((area) => {
        const ax0 = area.x;
        const ay0 = area.y;
        const ax1 = area.x + area.width;
        const ay1 = area.y + area.depth;
        return columnX >= ax0 && columnX <= ax1 && rowY >= ay0 && rowY <= ay1;
      });

      if (!insideExcluded) {
        candidatePositions.push({ localCol, localRow, x: columnX, y: rowY });
      }
    }
  }

  const testsPerPlate = Math.max(0, candidatePositions.length);
  const totalTests = flowSteps;
  const plateCount =
    testsPerPlate > 0 ? Math.max(1, Math.ceil(totalTests / testsPerPlate)) : 1;

  const plates: Array<{ index: number; gcode: string; steps: number }> = [];

  // constants for extrusion math
  const filamentArea = Math.PI * Math.pow(filamentDiameter / 2, 2); // mm^2

  for (let plateIndex = 0; plateIndex < plateCount; plateIndex++) {
    const lines: string[] = [];
    const writeGcodeLine = (text = "") =>
      lines.push(String(text).replaceAll(",", ".")); // be decimal-safe

    // ---------- Header & settings echo ----------
    writeGcodeLine("; *** BTT Flow Pattern Generator (JS port)");
    writeGcodeLine(`; Profile: ${printers[selectedPrinterIndex]?.model}`);
    writeGcodeLine(`; Plate ${plateIndex + 1} of ${plateCount}`);
    writeGcodeLine(";####### Settings");
    const settingsToEcho = {
      bedWidth,
      bedLength: bedLengthSave,
      bedMarginX,
      bedMarginY,
      filamentDiameter,
      movementSpeed,
      stabilizationTime,
      bedTemp,
      fanSpeed,
      primeLength,
      primeAmount,
      primeSpeed,
      wipeLength,
      retractionDistance,
      retractionSpeed,
      blobHeight,
      extrusionAmount,
      xSpacing,
      ySpacing,
      startFlow,
      flowOffset,
      flowSteps,
      endFlow,
      startTemp,
      tempOffset,
      direction,
    };
    for (const [k, v] of Object.entries(settingsToEcho)) {
      writeGcodeLine(`; ${k} = ${v}`);
    }
    writeGcodeLine("");

    // ---------- Boilerplate ----------
    writeGcodeLine(`M104 S${startTemp} ; Set Nozzle Temperature`);
    writeGcodeLine(`M140 S${bedTemp} ; Set Bed Temperature`);
    writeGcodeLine("G90");
    writeGcodeLine("G28 ; Home all axes");
    writeGcodeLine("G0 Z10 ; Lift nozzle");
    writeGcodeLine("G21 ; Units in mm");
    writeGcodeLine("G92 E0 ; Reset extruder");
    writeGcodeLine("M83 ; Relative extrusion");
    writeGcodeLine(`M190 S${bedTemp} ; Wait for bed`);
    writeGcodeLine(`M106 S${Math.round((fanSpeed * 255) / 100)} ; Fan`);

    let plateTestCount = 0;

    // If there are no available candidate positions, emit an informational
    // plate containing a comment so callers know nothing could be placed.
    if (testsPerPlate === 0) {
      writeGcodeLine("");
      writeGcodeLine(
        "; No available placement slots on this printer — check excludedAreas"
      );
      plates.push({ index: plateIndex + 1, gcode: lines.join("\n"), steps: 0 });
      // nothing more to do for this plate
      continue;
    }

    // For each allowed slot on this plate (preserving the original ordering), compute the global test index and map
    for (let localIndex = 0; localIndex < testsPerPlate; localIndex++) {
      const pos = candidatePositions[localIndex];
      const globalIndex = plateIndex * testsPerPlate + localIndex;
      if (globalIndex >= totalTests) break;

      // Global (logical) column/row (these drive temperature & flow sequencing)
      const globalColumnIndex = Math.floor(globalIndex / flowSteps) + 1; // 1-based
      const globalRowIndex = (globalIndex % flowSteps) + 1; // 1-based

      const columnTemperature =
        startTemp + (globalColumnIndex - 1) * tempOffset;

      // Flow sequencing: if tempOffset==0 we continue flows across columns (fill mode)
      let flow: number;
      if (tempOffset === 0) {
        flow = startFlow + globalIndex * flowOffset;
      } else {
        flow = startFlow + (globalRowIndex - 1) * flowOffset;
      }

      // Physical X/Y on plate (from precomputed candidate)
      const columnX = pos.x;
      const rowY = pos.y;

      // Output temperature block header when starting a new column group on this plate
      // We write a header per logical column when the first local slot on this plate corresponds to that column
      // Find whether this localIndex is the first occurrence of its globalColumnIndex on this plate
      const firstGlobalIndexForColumn = (globalColumnIndex - 1) * flowSteps; // global index of col, row1
      const firstLocalIndexForColumnOnThisPlate =
        firstGlobalIndexForColumn - plateIndex * testsPerPlate;
      if (firstLocalIndexForColumnOnThisPlate === localIndex) {
        writeGcodeLine("");
        writeGcodeLine(`;####### ${columnTemperature}C`);
        writeGcodeLine("G4 S0 ; Dwell");
        writeGcodeLine(`M109 R${columnTemperature}`);
      }

      // --- Extrusion move for the blob ---
      const extrusionRate = flow / filamentArea; // mm/s
      const feedRateMmPerMin =
        ((blobHeight * extrusionRate) / extrusionAmount) * 60;
      const roundedFeedRate = Math.max(1, +feedRateMmPerMin.toFixed(2)); // safety min

      // ---------- Test G-code ----------
      writeGcodeLine("");
      writeGcodeLine(`;####### ${flow}mm3/s`);
      writeGcodeLine(
        `M117 ${columnTemperature}°C // ${flow}mm3/s; F${roundedFeedRate}mm/min`
      );

      // approach + prime + wipe + de/retract
      writeGcodeLine(
        `G0 X${columnX} Y${rowY} Z${0.5 + blobHeight + 5} F${
          movementSpeed * 60
        }`
      );
      writeGcodeLine(`G4 S${stabilizationTime} ; Stabilize`);
      writeGcodeLine(`G0 Z0.3`);
      writeGcodeLine(
        `G1 X${columnX + primeLength} E${primeAmount} F${
          primeSpeed * 60
        } ; Prime`
      );
      writeGcodeLine(
        `G1 E${-retractionDistance} F${retractionSpeed * 60} ; Retract`
      );
      writeGcodeLine(
        `G0 X${columnX + primeLength + wipeLength} F${
          movementSpeed * 60
        } ; Wipe`
      );
      writeGcodeLine(`G0 Z0.5`);
      writeGcodeLine(
        `G1 E${retractionDistance} F${retractionSpeed * 60} ; De-Retract`
      );

      writeGcodeLine(
        `G1 Z${
          0.5 + blobHeight
        } E${extrusionAmount} F${roundedFeedRate} ; Extrude F${roundedFeedRate}mm/min`
      );
      writeGcodeLine(
        `G1 E${-retractionDistance} F${retractionSpeed * 60} ; Retract`
      );
      writeGcodeLine(`G0 Z${0.5 + blobHeight + 5} ; Lift`);
      writeGcodeLine(`G0 X${columnX} Y${rowY} F${movementSpeed * 60}`);
      writeGcodeLine(`G92 E0`);

      plateTestCount++;
    }

    // ---------- Footer ----------
    writeGcodeLine("");
    writeGcodeLine(";####### End G-Code");
    writeGcodeLine(
      `G0 X${bedWidth - Math.abs(bedMarginX)} Y${
        bedLengthSave - Math.abs(bedMarginY)
      }`
    );
    writeGcodeLine("M104 S0 T0");
    writeGcodeLine("M140 S0");
    writeGcodeLine("M84");

    plates.push({
      index: plateIndex + 1,
      gcode: lines.join("\n"),
      steps: plateTestCount,
    });
  }

  return plates;
}

// If you want CommonJS usage too:
// module.exports = { generateGcode };
export default { generateGcode };
