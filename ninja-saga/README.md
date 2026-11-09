# Ninja Saga

3D action platformer for iPhone Safari, landscape. Built with Three.js (inlined, no CDN).

Current build: M1-01 Storm movement and test course.

Play: https://chris-chamberlain.github.io/ios-browser-games/ninja-saga/
On iPhone, open the link in Safari, tap Share, Add to Home Screen, then launch from the icon for full screen.

Source: `source/` holds src (sim.js, app.js, overlay is merged into app.js, template.html), tools (build.mjs, bundle-three.mjs, smoke tests) and lib (Three.js r187 bundle).
Build: `node source/tools/build.mjs <build-id> index.html` from inside `source/`.
