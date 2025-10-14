export const printers = [
  {
    model: "A1 Mini",
    buildVolume: {
      width: 180,
      depth: 180,
      height: 180,
    },
    bedMarginX: 10,
    bedMarginY: 10,
    xSpacing: 13,
    ySpacing: 20,
  },
  {
    model: "A1",
    buildVolume: {
      width: 256,
      depth: 256,
      height: 256,
    },
    bedMarginX: 10,
    bedMarginY: 10,
    xSpacing: 25,
    ySpacing: 25,
  },
  {
    model: "X1/P1",
    buildVolume: {
      width: 256,
      depth: 256,
      height: 256,
    },
    bedMarginX: 10,
    bedMarginY: 10,
    xSpacing: 25,
    ySpacing: 25,
    excludedAreas: [{ x: 0, y: 0, width: 18, depth: 28 }],
  },
  {
    model: "H2D",
    buildVolume: {
      width: 350,
      depth: 320,
      height: 325,
    },
    bedMarginX: 30,
    bedMarginY: 10,
    xSpacing: 25,
    ySpacing: 25,
  },
  {
    model: "H2S",
    buildVolume: {
      width: 340,
      depth: 320,
      height: 340,
    },
    bedMarginX: 10,
    bedMarginY: 10,
    xSpacing: 25,
    ySpacing: 25,
  },
];
