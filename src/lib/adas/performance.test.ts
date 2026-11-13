import { describe, expect, it } from "vitest";
import { boundedVideoSize, CAMERA_MAX_FPS, cameraConstraints, DEFAULT_SETTINGS, modelBackendPreference } from "./engine";

describe("ADAS media performance limits", () => {
  it("caps camera capture at 30 FPS with a 24 FPS target", () => {
    expect(CAMERA_MAX_FPS).toBe(30);
    expect(cameraConstraints(1280, 720).frameRate).toEqual({ ideal: 24, max: 30 });
  });

  it("starts in low-power mode and keeps model inference on CPU until opted out", () => {
    expect(DEFAULT_SETTINGS.lite).toBe(true);
    expect(modelBackendPreference(DEFAULT_SETTINGS.lite)).toBe("wasm");
    expect(modelBackendPreference(false)).toBeUndefined();
  });

  it("requests a lighter camera frame rate in low-power mode", () => {
    expect(cameraConstraints(854, 480, true).frameRate).toEqual({ ideal: 15, max: 20 });
  });

  it("limits saved video frames to at most 1280×720 without upscaling", () => {
    expect(boundedVideoSize(3840, 2160)).toEqual([1280, 720]);
    expect(boundedVideoSize(640, 480)).toEqual([640, 480]);
  });
});