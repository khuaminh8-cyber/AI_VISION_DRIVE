<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- ADAS logic (tracker, TTC, ranging) lives in plain TS under src/lib/adas; React/three only draw engine state — keeps rules testable (tracker.test.ts).
- Inference and CV run in Web Workers (src/workers); main thread only sends ImageBitmaps — keeps UI smooth.
- Real-time data lives on the AdasEngine instance (refs), React state is refreshed at 4 Hz only — avoids per-frame re-renders.
- Never fake detections: modes without a model show "MODEL NOT LOADED".
- tsconfig has noUncheckedIndexedAccess/exactOptionalPropertyTypes off — numeric pixel-buffer code is index-heavy.
- Dense models (road seg, depth) load only on user click in src/workers/aux.worker.ts, one frame in flight at ≤6 fps; unload terminates the worker — keeps camera/3D smooth on weak devices.
- The ADAS dashboard defaults to CPU Lite and only probes/uses WebGPU after the user opts out, keeping first-use resource use low.
- Training datasets persist in IndexedDB via src/lib/training/db.ts; YOLO parse/validate/split rules are pure TS in src/lib/training/yolo.ts (tested) — survives reload and keeps rules testable.
- Auto-label runs the pretrained YOLO ONNX locally (src/lib/training/autolabel.ts) and writes only ImageMeta.suggest; suggestions become training boxes only when the user saves — never auto-mark done, no paid APIs.
