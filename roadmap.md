# ONNX model workflow
- [ ] Add class mapping and persistence for validated ONNX models.
- [ ] Add on-device validation and real image benchmark in XUẤT ONNX.
- [ ] Load activated models and class mappings in the live ADAS dashboard.
- [ ] Run focused tests and verify the preview flow/build.

# ADAS performance
- [x] Cap camera capture at 30 FPS and use a lighter default resolution on mobile.
- [x] Bound exported video frames to 1280×720 and retain 640px AI input sizing.
- [x] Cap 3D pixel ratio and pause rendering when off-screen or hidden.
- [x] Add focused performance-limit tests.
- [x] Start in CPU Lite mode, use CPU inference and lower media capture load by default.
