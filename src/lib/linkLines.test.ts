import { describe, expect, it } from "vitest";
import { linkLineLabels, linkLineOrder, linkLineStyle, linkQuality } from "./linkLines";

describe("linkQuality", () => {
  it("is good once the margin covers the fade margin", () => {
    expect(linkQuality(10, 10)).toBe("good");
    expect(linkQuality(9.9, 10)).toBe("marginal");
  });

  it("is marginal down to 0 dB, then fails", () => {
    expect(linkQuality(0, 10)).toBe("marginal");
    expect(linkQuality(-0.1, 10)).toBe("fail");
  });
});

describe("linkLineStyle", () => {
  it("splits good links by line of sight", () => {
    expect(linkLineStyle("good", "clear")).toBe("good-clear");
    expect(linkLineStyle("good", "fresnel")).toBe("good-obstructed");
    expect(linkLineStyle("good", "blocked")).toBe("good-obstructed");
  });

  it("doesn't call a good link clear before terrain is checked", () => {
    expect(linkLineStyle("good", undefined)).toBe("good-obstructed");
  });

  it("draws marginal and failed links the same whatever the terrain", () => {
    for (const los of ["clear", "fresnel", "blocked", undefined] as const) {
      expect(linkLineStyle("marginal", los)).toBe("marginal");
      expect(linkLineStyle("fail", los)).toBe("fail");
    }
  });

  it("names every style in the legend", () => {
    expect(linkLineOrder).toHaveLength(Object.keys(linkLineLabels).length);
    for (const style of linkLineOrder) expect(linkLineLabels[style]).toBeTruthy();
  });
});
