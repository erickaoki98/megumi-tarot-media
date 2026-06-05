import { describe, it, expect } from "vitest";
import { recordingExtension, recordingFileName } from "./save-recording";

describe("recordingExtension", () => {
  it("returns mp4 for an mp4 mime", () => {
    expect(recordingExtension("video/mp4")).toBe("mp4");
  });
  it("returns webm for a webm mime with codecs", () => {
    expect(recordingExtension("video/webm;codecs=vp9,opus")).toBe("webm");
  });
  it("returns mov for quicktime", () => {
    expect(recordingExtension("video/quicktime")).toBe("mov");
  });
  it("falls back to webm for unknown/empty", () => {
    expect(recordingExtension("")).toBe("webm");
    expect(recordingExtension("application/octet-stream")).toBe("webm");
  });
});

describe("recordingFileName", () => {
  it("builds a filename with the right extension", () => {
    expect(recordingFileName("video/mp4")).toBe("teleprompter.mp4");
    expect(recordingFileName("video/webm")).toBe("teleprompter.webm");
  });
});
