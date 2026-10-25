CORE v28 -> Android app (PWABuilder), with offline vision

WHAT'S NEW
- Offline vision (TFLite on-device): face detect (BlazeFace) -> mesh alignment -> FaceNet-512 match, plus EfficientDet-Lite0 object scan.
- Settings > More: "Download offline vision pack (~48 MB)". Do it once on Wi-Fi. After that, Scan/Enroll use it automatically when you are offline,
  or always if you tick "Always use offline vision".
- Pack lives in its own cache (core-offvis-v1) that the service worker never wipes.
- Tiny offline brain (chat) was already in More tab; vision pack is separate.
- Face match threshold is cosine similarity, default 0.70. Tune with CORE_OFFVIS.setThreshold(0.6) in the console if it is too strict/loose.

STEP 1 - HOST OVER HTTPS (needs a real URL)
Upload EVERYTHING in this folder except preview.html: index.html, offvision.js, sw.js, manifest.webmanifest, icons/, models/, vendor/.
GitHub Pages: add an empty file named .nojekyll, and push with git (Termux) - the web uploader caps files at 25 MB.
Open the URL once in Chrome, check CORE loads.

STEP 2 - PWABUILDER
pwabuilder.com -> paste your URL -> Start. Manifest + service worker should be green.

STEP 3 - ANDROID PACKAGE
Package for stores -> Android -> Generate. Keep the "signing key" files from the zip - you need them for every future update.

STEP 4 - REMOVE THE URL BAR (Digital Asset Links)
PWABuilder's zip has assetlinks.json. Host it at https://YOUR-SITE/.well-known/assetlinks.json (with .nojekyll the folder is served).
Without it the app opens with a Chrome address bar on top.

STEP 5 - INSTALL
Unzip, install the .apk (allow unknown sources). Open CORE -> Settings -> More -> Download offline vision pack while on Wi-Fi.
Test: airplane mode -> Enroll face -> Scan.

Camera/mic are asked at runtime. INTERNET permission is added by PWABuilder automatically.
