import "./App.css";
import { useState, useMemo, useEffect } from "react";
import { generateGcode } from "./services/gcode/gcode-flow";
import { gcodeToSvg } from "./services/gcode/gcode-preview";
import { printers } from "./services/gcode/printers";

function App() {
  const [selectedPrinterIndex, setSelectedPrinterIndex] = useState(-1);

  // When the selected printer changes, update bed width/length in settings.
  const applyPrinterToSettings = (index: number) => {
    const p = printers[index];
    if (!p) return;
    // prefer either `buildVolume` or `build_volume_mm` property
    const bv = (p as any).buildVolume ?? (p as any).build_volume_mm ?? null;
    const vol =
      bv && (bv as any).single_nozzle ? (bv as any).single_nozzle : bv;
    const width = (vol as any).width ?? (vol as any).depth ?? settings.bedWidth;
    const depth =
      (vol as any).depth ?? (vol as any).width ?? settings.bedLength;
    handleSettingChange("bedWidth", width);
    handleSettingChange("bedLength", depth);
    // Update bedMarginX/bedMarginY from printer if provided (top-level or inside build_volume)
    let marginX = (settings as any).bedMarginX;
    let marginY = (settings as any).bedMarginY;
    if (typeof (p as any).bedMarginX === "number")
      marginX = (p as any).bedMarginX;
    if (typeof (p as any).bedMarginY === "number")
      marginY = (p as any).bedMarginY;
    if (typeof (p as any).bedMargin === "number") {
      marginX = marginY = (p as any).bedMargin;
    } else if (bv && typeof (bv as any).bedMargin === "number") {
      marginX = marginY = (bv as any).bedMargin;
    } else if (vol && typeof (vol as any).bedMargin === "number") {
      marginX = marginY = (vol as any).bedMargin;
    }
    console.log(p);
    handleSettingChange("bedMarginX", marginX);
    handleSettingChange("bedMarginY", marginY);
    handleSettingChange("xSpacing", p.xSpacing ?? 20);
    handleSettingChange("ySpacing", p.ySpacing ?? 20);
  };

  const [settings, setSettings] = useState({
    bedWidth: 180,
    bedLength: 180,
    bedMarginX: 10,
    bedMarginY: 10,
    direction: 1,
    filamentDiameter: 1.75,
    travelSpeed: 100,
    bedTemperature: 60,
    fanSpeed: 0,
    retractionDistance: 0.8,
    retractionSpeed: 35,
    temperatureSpacing: 0,
    startFlow: 8,
    offset: 2,
    steps: 20,
    startTemperature: 200,
    endFlow: 0,
    stabilizationTime: 20,
    primeLength: 25,
    primeAmount: 20,
    primeSpeed: 5,
    wipeLength: 15,
    blobHeight: 10,
    extrusionAmount: 200,
    comment: "Ender-3",
    xSpacing: 20,
    ySpacing: 20,
  });

  const plates = useMemo(() => {
    // The UI uses short names (offset, steps). The generator expects
    // flowOffset and flowSteps. Also compute endFlow when not provided by
    // the user: endFlow = startFlow + (steps - 1) * offset.
    const flowOffset = Number.isFinite((settings as any).offset)
      ? (settings as any).offset
      : (settings as any).flowOffset;
    const flowSteps = Number.isFinite((settings as any).steps)
      ? (settings as any).steps
      : (settings as any).flowSteps;
    const computedEndFlow = (settings as any).endFlow; // provided by outer memo

    const rawValues = {
      ...settings,
      flowOffset,
      flowSteps,
      endFlow: computedEndFlow,
    } as any;

    const result = generateGcode(selectedPrinterIndex, rawValues);

    return result;
  }, [settings]);

  // compute endFlow from startFlow, offset and steps but don't write it into state here
  const computedEndFlow = useMemo(() => {
    const flowOffset = Number.isFinite((settings as any).offset)
      ? (settings as any).offset
      : (settings as any).flowOffset;
    const flowSteps = Number.isFinite((settings as any).steps)
      ? (settings as any).steps
      : (settings as any).flowSteps;
    return (
      (settings as any).startFlow +
      (flowOffset || 0) * (Math.max(1, flowSteps) - 1)
    );
  }, [
    (settings as any).startFlow,
    (settings as any).offset,
    (settings as any).flowOffset,
    (settings as any).steps,
    (settings as any).flowSteps,
  ]);

  const [currentPlateIndex, setCurrentPlateIndex] = useState(0);

  const currentGcode = plates[currentPlateIndex]?.gcode || "";
  const currentSvg = useMemo(() => {
    if (!currentGcode) return "";
    const result = gcodeToSvg(currentGcode, {
      bedWidth: settings.bedWidth,
      bedLength: settings.bedLength,
      // preview accepts a single margin; use the larger axis margin so the content fits
      margin: Math.max(settings.bedMarginX ?? 0, settings.bedMarginY ?? 0),
      gridStep: 20,
      filamentDiameter: settings.filamentDiameter, // used to estimate blob size
      blobMinE: 20, // mm of filament for "blob" detection
      blobMaxXY: 0.1, // max XY drift to still consider it a blob
      blobScale: 0.06, // visual scaling of computed radius
      strokeTravel: "#ffff0050",
      strokeExtrude: "#0b79d0",
      strokeBlob: "#0b79d0",
    });

    return result;
  }, [
    currentGcode,
    settings.bedWidth,
    settings.bedLength,
    settings.bedMarginX,
    settings.bedMarginY,
    settings.filamentDiameter,
  ]);

  const handleSettingChange = (key: string, value: any) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // small helper to reduce repeated number input markup
  const InputNumber = ({
    label,
    value,
    onChange,
    inputProps = {},
    style = {},
  }: {
    label: string;
    value: number | string;
    onChange: (v: number) => void;
    inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
    style?: React.CSSProperties;
  }) => {
    const [local, setLocal] = useState(String(value ?? ""));

    useEffect(() => {
      setLocal(String(value ?? ""));
    }, [value]);

    const commit = () => {
      const parsed = parseFloat(local as string);
      if (!Number.isNaN(parsed)) onChange(parsed);
      else onChange(0);
    };

    return (
      <label style={{ display: "flex", alignItems: "center" }}>
        <p style={{ whiteSpace: "nowrap" }}>{label}</p>
        <input
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            }
          }}
          style={{
            marginLeft: "0.5rem",
            width: "100%",
            fontSize: "1rem",
            ...style,
          }}
          {...inputProps}
        />
      </label>
    );
  };

  // small helper to download text content as a file
  const downloadTextFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    downloadBlob(blob, filename);
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Minimal in-browser ZIP creator (store only, no compression).
  // Produces a valid ZIP file containing provided files.
  const createZip = (files: { name: string; data: Uint8Array }[]) => {
    // CRC32 table
    const makeCrcTable = () => {
      const table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
      }
      return table;
    };
    const crcTable = makeCrcTable();
    const crc32 = (data: Uint8Array) => {
      let crc = 0xffffffff;
      for (let i = 0; i < data.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff];
      }
      return (crc ^ 0xffffffff) >>> 0;
    };

    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    const centralDirEntries: Uint8Array[] = [];
    let offset = 0;

    const u32 = (n: number) =>
      new Uint8Array([
        n & 0xff,
        (n >>> 8) & 0xff,
        (n >>> 16) & 0xff,
        (n >>> 24) & 0xff,
      ]);
    const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);

    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const compressedSize = data.length;
      const uncompressedSize = data.length;

      // local file header
      const lf = new Uint8Array(30 + nameBytes.length);
      let p = 0;
      // signature
      lf.set(u32(0x04034b50), p);
      p += 4;
      // version needed to extract
      lf.set(u16(20), p);
      p += 2;
      // general purpose bit flag
      lf.set(u16(0), p);
      p += 2;
      // compression method (0 = store)
      lf.set(u16(0), p);
      p += 2;
      // mod time/date
      lf.set(u16(0), p);
      p += 2;
      lf.set(u16(0), p);
      p += 2;
      // crc32
      lf.set(u32(crc), p);
      p += 4;
      // compressed size
      lf.set(u32(compressedSize), p);
      p += 4;
      // uncompressed size
      lf.set(u32(uncompressedSize), p);
      p += 4;
      // filename length
      lf.set(u16(nameBytes.length), p);
      p += 2;
      // extra length
      lf.set(u16(0), p);
      p += 2;
      // filename
      lf.set(nameBytes, p);
      p += nameBytes.length;

      parts.push(lf);
      parts.push(data);

      // central directory header
      const cdh = new Uint8Array(46 + nameBytes.length);
      p = 0;
      cdh.set(u32(0x02014b50), p);
      p += 4; // central file header signature
      cdh.set(u16(0), p);
      p += 2; // version made by
      cdh.set(u16(20), p);
      p += 2; // version needed
      cdh.set(u16(0), p);
      p += 2; // gp bit flag
      cdh.set(u16(0), p);
      p += 2; // compression method
      cdh.set(u16(0), p);
      p += 2; // mod time
      cdh.set(u16(0), p);
      p += 2; // mod date
      cdh.set(u32(crc), p);
      p += 4;
      cdh.set(u32(compressedSize), p);
      p += 4;
      cdh.set(u32(uncompressedSize), p);
      p += 4;
      cdh.set(u16(nameBytes.length), p);
      p += 2; // file name length
      cdh.set(u16(0), p);
      p += 2; // extra len
      cdh.set(u16(0), p);
      p += 2; // file comment len
      cdh.set(u16(0), p);
      p += 2; // disk number start
      cdh.set(u16(0), p);
      p += 2; // internal file attrs
      cdh.set(u32(0), p);
      p += 4; // external file attrs
      cdh.set(u32(offset), p);
      p += 4; // relative offset of local header
      cdh.set(nameBytes, p);
      p += nameBytes.length;

      centralDirEntries.push(cdh);

      offset += lf.length + data.length;
    }

    const centralSize = centralDirEntries.reduce((sum, e) => sum + e.length, 0);
    const centralOffset = offset;

    // end of central directory
    const eocd = new Uint8Array(22);
    let p = 0;
    eocd.set(u32(0x06054b50), p);
    p += 4; // end of central dir signature
    eocd.set(u16(0), p);
    p += 2; // number of this disk
    eocd.set(u16(0), p);
    p += 2; // disk where central starts
    eocd.set(u16(centralDirEntries.length), p);
    p += 2; // number of central dir records on this disk
    eocd.set(u16(centralDirEntries.length), p);
    p += 2; // total central dir records
    eocd.set(u32(centralSize), p);
    p += 4; // size of central dir
    eocd.set(u32(centralOffset), p);
    p += 4; // offset of start of central dir
    eocd.set(u16(0), p);
    p += 2; // comment length

    const allParts = [...parts, ...centralDirEntries, eocd];
    const totalLength = allParts.reduce((s, b) => s + b.length, 0);
    const out = new Uint8Array(totalLength);
    let pos = 0;
    for (const part of allParts) {
      out.set(part, pos);
      pos += part.length;
    }

    return new Blob([out], { type: "application/zip" });
  };

  // sanitize printer model for filenames
  const printerModelForFilename = (idx: number) => {
    const p = printers[idx];
    if (!p) return "printer";
    return String(p.model)
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "");
  };

  return (
    <>
      <div>
        <div style={{ flex: "0 0 100%" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.5rem",
            }}
          >
            Printer:
            <select
              value={selectedPrinterIndex}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setSelectedPrinterIndex(idx);
                applyPrinterToSettings(idx);
              }}
              style={{ marginLeft: "0.5rem" }}
            >
              <option value={-1}>Please select</option>
              {printers.map((p, i) => (
                <option key={i} value={i}>
                  {p.model}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          style={{
            display: selectedPrinterIndex === -1 ? "none" : "flex",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <h2>G-code Preview</h2>
          {plates.length > 1 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {plates.map((plate, index) => (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      gap: "0.25rem",
                      alignItems: "center",
                    }}
                  >
                    <button
                      onClick={() => setCurrentPlateIndex(index)}
                      style={{
                        padding: "0.35rem 0.6rem",
                        backgroundColor:
                          index === currentPlateIndex ? "#0056b3" : "#007bff",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                      title={`View Plate ${plate.index}`}
                    >
                      Plate {plate.index}
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: "0.5rem" }}>
                <button
                  onClick={() => {
                    const plate = plates[currentPlateIndex];
                    downloadTextFile(
                      plate.gcode,
                      `flow-test-${printerModelForFilename(
                        selectedPrinterIndex
                      )}-plate-${plate.index}.gcode`
                    );
                  }}
                  style={{
                    marginRight: "0.5rem",
                    padding: "0.5rem 1rem",
                    backgroundColor: "#007bff",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Download Plate {plates[currentPlateIndex]?.index}
                </button>
                <button
                  onClick={() => {
                    try {
                      const files = plates.map((plate) => ({
                        name: `flow-test-${printerModelForFilename(
                          selectedPrinterIndex
                        )}-plate-${plate.index}.gcode`,
                        data: new TextEncoder().encode(plate.gcode),
                      }));
                      const zip = createZip(files);
                      downloadBlob(
                        zip,
                        `flow-test-${printerModelForFilename(
                          selectedPrinterIndex
                        )}.zip`
                      );
                    } catch (e) {
                      // fallback to individual downloads
                      plates.forEach((plate) => {
                        downloadTextFile(
                          plate.gcode,
                          `flow-test-${printerModelForFilename(
                            selectedPrinterIndex
                          )}-plate-${plate.index}.gcode`
                        );
                      });
                    }
                  }}
                  style={{
                    padding: "0.5rem 1rem",
                    backgroundColor: "#28a745",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Download All Plates
                </button>
              </div>
            </div>
          )}
          {plates.length === 1 && (
            <div style={{ marginBottom: "1rem" }}>
              <button
                onClick={() => {
                  const plate = plates[0];
                  downloadTextFile(
                    plate.gcode,
                    `flow-test-${printerModelForFilename(
                      selectedPrinterIndex
                    )}.gcode`
                  );
                }}
                style={{
                  padding: "0.5rem 1rem",
                  backgroundColor: "#007bff",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Download G-code
              </button>
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          padding: "1rem",

          borderRadius: "8px",
          flex: "1 1 50%",
          minWidth: 0,
          display: selectedPrinterIndex === -1 ? "none" : "inline-block",
        }}
      >
        <h2>Settings</h2>
        <div>
          {/* Bed Settings */}
          <div hidden>
            <h3>Bed Settings</h3>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <InputNumber
                label="Bed Width (mm):"
                value={settings.bedWidth}
                onChange={(v) => handleSettingChange("bedWidth", v)}
              />
              <InputNumber
                label="Bed Length (mm):"
                value={settings.bedLength}
                onChange={(v) => handleSettingChange("bedLength", v)}
              />
              <InputNumber
                label="Bed Margin X (mm):"
                value={settings.bedMarginX}
                onChange={(v) => handleSettingChange("bedMarginX", v)}
              />
              <InputNumber
                label="Bed Margin Y (mm):"
                value={settings.bedMarginY}
                onChange={(v) => handleSettingChange("bedMarginY", v)}
              />
            </div>
          </div>

          {/* Filament Settings */}
          <div hidden>
            <h3>Filament Settings</h3>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <InputNumber
                label="Filament Diameter (mm):"
                value={settings.filamentDiameter}
                onChange={(v) => handleSettingChange("filamentDiameter", v)}
                inputProps={{ step: "0.01" }}
              />
              <InputNumber
                label="Travel Speed (mm/min):"
                value={settings.travelSpeed}
                onChange={(v) => handleSettingChange("travelSpeed", v)}
              />
            </div>
          </div>

          {/* Flow Settings */}
          <details>
            <summary>Flow Settings</summary>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <InputNumber
                label="Start Flow (mm³/s):"
                value={settings.startFlow}
                onChange={(v) => handleSettingChange("startFlow", v)}
                inputProps={{ step: "0.1" }}
              />
              <InputNumber
                label="Flow Offset:"
                value={settings.offset}
                onChange={(v) => handleSettingChange("offset", v)}
                inputProps={{ step: "0.1" }}
              />
              <InputNumber
                label="Steps:"
                value={settings.steps}
                onChange={(v) => handleSettingChange("steps", v)}
              />
              <InputNumber
                label="End Flow:"
                value={computedEndFlow}
                onChange={() => {}}
              />
            </div>
          </details>

          {/* Temperature Settings */}
          <details>
            <summary>Temperature Settings</summary>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <InputNumber
                label="Bed Temperature (°C):"
                value={settings.bedTemperature}
                onChange={(v) => handleSettingChange("bedTemperature", v)}
              />
              <InputNumber
                label="Start Temperature (°C):"
                value={settings.startTemperature}
                onChange={(v) => handleSettingChange("startTemperature", v)}
              />
              <InputNumber
                label="Fan Speed (%):"
                value={settings.fanSpeed}
                onChange={(v) => handleSettingChange("fanSpeed", v)}
                inputProps={{ min: 0, max: 100 }}
              />
            </div>
          </details>

          {/* Prime Settings */}
          <details hidden>
            <summary>Prime Settings</summary>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <InputNumber
                label="Prime Length (mm):"
                value={settings.primeLength}
                onChange={(v) => handleSettingChange("primeLength", v)}
              />
              <InputNumber
                label="Prime Amount (mm):"
                value={settings.primeAmount}
                onChange={(v) => handleSettingChange("primeAmount", v)}
              />
              <InputNumber
                label="Prime Speed (mm/min):"
                value={settings.primeSpeed}
                onChange={(v) => handleSettingChange("primeSpeed", v)}
              />
              <InputNumber
                label="Wipe Length (mm):"
                value={settings.wipeLength}
                onChange={(v) => handleSettingChange("wipeLength", v)}
              />
            </div>
          </details>

          {/* Retraction Settings */}
          <details hidden>
            <summary>Retraction Settings</summary>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <InputNumber
                label="Retraction Distance (mm):"
                value={settings.retractionDistance}
                onChange={(v) => handleSettingChange("retractionDistance", v)}
                inputProps={{ step: "0.1" }}
              />
              <InputNumber
                label="Retraction Speed (mm/min):"
                value={settings.retractionSpeed}
                onChange={(v) => handleSettingChange("retractionSpeed", v)}
              />
            </div>
          </details>

          {/* Blob Settings */}
          <div hidden>
            <h3>Blob Settings</h3>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <InputNumber
                label="Blob Height (mm):"
                value={settings.blobHeight}
                onChange={(v) => handleSettingChange("blobHeight", v)}
              />
              <InputNumber
                label="Extrusion Amount (mm):"
                value={settings.extrusionAmount}
                onChange={(v) => handleSettingChange("extrusionAmount", v)}
              />
            </div>
          </div>

          {/* Spacing Settings */}
          <details>
            <summary>Spacing Settings</summary>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <InputNumber
                label="X Spacing (mm):"
                value={settings.xSpacing}
                onChange={(v) => handleSettingChange("xSpacing", v)}
              />
              <InputNumber
                label="Y Spacing (mm):"
                value={settings.ySpacing}
                onChange={(v) => handleSettingChange("ySpacing", v)}
              />
              {/* <InputNumber
                label="Direction:"
                value={settings.direction}
                onChange={(v) => handleSettingChange("direction", v)}
              /> */}
            </div>
          </details>

          {/* Other Settings */}
          <details hidden>
            <summary>Other Settings</summary>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <InputNumber
                label="Stabilization Time (s):"
                value={settings.stabilizationTime}
                onChange={(v) => handleSettingChange("stabilizationTime", v)}
              />
              <label style={{ display: "flex", alignItems: "center" }}>
                Comment:
                <input
                  type="text"
                  value={settings.comment}
                  onChange={(e) =>
                    handleSettingChange("comment", e.target.value)
                  }
                  style={{ marginLeft: "0.5rem", width: "120px" }}
                />
              </label>
            </div>
          </details>
        </div>
      </div>

      <div
        style={{
          flex: "1 1 50%",
          maxWidth: "50%",
          minWidth: 0,
          display: selectedPrinterIndex === -1 ? "none" : "inline-block",
        }}
      >
        <div
          dangerouslySetInnerHTML={{ __html: currentSvg }}
          style={{
            padding: "1rem",
          }}
        />
      </div>
    </>
  );
}

export default App;
