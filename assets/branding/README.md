# shiori branding

`shiori-app-icon-v1.png` is the approved simplified application icon: a reader with an open book inside an ivory bookmark, on a forest-green rounded tile. The transparent PNG is the unmodified output of the built-in image generation tool, approved on 2026-10-29. It is the master for Windows executable/window/taskbar icons, Store logos, browser favicons and PWA icons.

`shiori-mark-256.png` and `shiori-bookmark-v1.png` remain the detailed brand artwork used inside the app, including the About screen.

Run `pnpm icons` to regenerate platform assets using the installed Tauri CLI. The script preserves the approved artwork and transparency when resizing. The maskable PWA variant adds an opaque forest-green background and safe-area padding. Temporary conversions and size previews are placed under `test-results/icon-refresh/`.

The Windows ICO contains 16, 20, 24, 32, 40, 48, 64, 128 and 256px PNG frames, including intermediate DPI sizes. Each frame is generated directly from the master, not from another thumbnail.

The concept was generated using the earlier simple bookmark icon as the edit target, the original shiori logo as the identity reference, and the supplied MioNote taskbar icon as a reference for a compact emblem with a recognizable character. The design instruction was to replace the two text bars with a large simplified reader silhouette, retain the bookmark notch and forest-green/ivory palette, and omit fine facial features, foliage, tassels, strings and lettering. No AI redraw is performed when regenerating platform files.
