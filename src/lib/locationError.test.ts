import { describe, expect, it } from "vitest";
import { locationErrorMessage } from "./locationError";

describe("locationErrorMessage", () => {
  it("says what to do for each kind of failure", () => {
    expect(locationErrorMessage(1, false)).toContain("Allow it for this site");
    expect(locationErrorMessage(2, false)).toContain("location and Wi-Fi are on");
    expect(locationErrorMessage(3, false)).toContain("Try again");
  });

  it("treats an unknown code as position unavailable", () => {
    expect(locationErrorMessage(99, false)).toBe(locationErrorMessage(2, false));
  });

  it("adds the Windows hint only on Windows", () => {
    for (const code of [1, 2, 3]) {
      expect(locationErrorMessage(code, true)).toContain("Geolocation Service");
      expect(locationErrorMessage(code, false)).not.toContain("Geolocation Service");
    }
  });

  it("always offers another way to set the location", () => {
    for (const code of [1, 2, 3]) expect(locationErrorMessage(code, false)).toContain("enter coordinates");
  });
});
