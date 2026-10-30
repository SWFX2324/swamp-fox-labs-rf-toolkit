import { describe, expect, it } from "vitest";
import { formatCoordinates, parseCoordinates, toMgrs } from "./coords";
import { distanceBetweenM } from "./geo";

describe("toMgrs", () => {
  it("gives the standard reference for 0°, 0°", () => {
    expect(toMgrs({ lat: 0, lon: 0 })).toBe("31N AA 66021 00000");
  });

  it("formats a US location", () => {
    expect(toMgrs({ lat: 35.2271, lon: -80.8431 })).toBe("17S NU 14277 98239");
  });

  it("refuses the polar regions MGRS hands to UPS", () => {
    expect(toMgrs({ lat: 85, lon: 0 })).toBeUndefined();
  });
});

describe("parseCoordinates", () => {
  it("still reads decimal lat/lon", () => {
    expect(parseCoordinates("35.2271, -80.8431")).toEqual({ lat: 35.2271, lon: -80.8431 });
  });

  it("reads MGRS with or without spaces, in any case", () => {
    for (const text of ["17S NU 14277 98239", "17SNU1427798239", "17snu 1427798239"]) {
      const p = parseCoordinates(text)!;
      expect(distanceBetweenM(p, { lat: 35.2271, lon: -80.8431 })).toBeLessThan(2);
    }
  });

  it("reads lower-precision MGRS as the centre of its cell", () => {
    const p = parseCoordinates("17S NU 142 982")!; // 100 m cell
    expect(distanceBetweenM(p, { lat: 35.2271, lon: -80.8431 })).toBeLessThan(100);
  });

  it("rejects junk and malformed MGRS", () => {
    for (const text of ["", "junk", "17S NU 1427 9823 1", "17SNU142", "99S NU 14277 98239", "17I NU 14277 98239"]) {
      expect(parseCoordinates(text)).toBeUndefined();
    }
  });

  it("round-trips through MGRS to within a metre", () => {
    for (const p of [
      { lat: 51.5, lon: -0.1 },
      { lat: -33.87, lon: 151.21 },
      { lat: 61.22, lon: -149.9 },
      { lat: 64.15, lon: -21.94 },
    ]) {
      expect(distanceBetweenM(parseCoordinates(toMgrs(p)!)!, p)).toBeLessThan(1.5);
    }
  });
});

describe("formatCoordinates", () => {
  it("formats in either style and falls back near the poles", () => {
    expect(formatCoordinates({ lat: 35.2271, lon: -80.8431 }, "latlon")).toBe("35.22710, -80.84310");
    expect(formatCoordinates({ lat: 35.2271, lon: -80.8431 }, "mgrs")).toBe("17S NU 14277 98239");
    expect(formatCoordinates({ lat: 85, lon: 0 }, "mgrs")).toBe("85.00000, 0.00000");
  });
});
