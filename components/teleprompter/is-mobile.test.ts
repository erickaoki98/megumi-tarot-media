import { describe, it, expect } from "vitest";
import { isMobileDevice } from "./is-mobile";

const iPhoneUA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const macUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

describe("isMobileDevice", () => {
  it("true for an iPhone user agent", () => {
    expect(isMobileDevice({ pointerCoarse: true, viewportWidth: 390, userAgent: iPhoneUA })).toBe(true);
  });
  it("true for a narrow coarse-pointer viewport (device emulation)", () => {
    expect(isMobileDevice({ pointerCoarse: true, viewportWidth: 414, userAgent: macUA })).toBe(true);
  });
  it("false for desktop (fine pointer, wide, mac UA)", () => {
    expect(isMobileDevice({ pointerCoarse: false, viewportWidth: 1440, userAgent: macUA })).toBe(false);
  });
  it("false for a wide coarse screen (large tablet landscape)", () => {
    expect(isMobileDevice({ pointerCoarse: true, viewportWidth: 1200, userAgent: macUA })).toBe(false);
  });
});
