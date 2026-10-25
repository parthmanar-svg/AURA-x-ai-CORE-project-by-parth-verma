CORE AI - AIDE project (no AndroidX, no downloads at build time)

BUILD
1. Unzip, open the folder containing build.gradle in AIDE, press Run.
2. If AIDE complains about the Gradle plugin, change the classpath line in build.gradle to a version your AIDE accepts.

OFFLINE MODELS (Settings > Models)
1. Build libcore_llm.so with GitHub Actions (see core-native-build.zip > README_GITHUB.txt), put it in app/src/main/jniLibs/arm64-v8a/, rebuild.
2. Open CORE > Settings > Models. Each category has its own + Add button: Chat, Coding, Speech to text, Text to speech, Vision, Embeddings, Other.
3. Tap + Add, pick one or more files. They are copied into the app's private models folder with a progress bar (needs free space equal to the file size).
4. Tap a model to make it the active one for that category. Tap X to delete (app-managed files only).
5. Files you copied over USB into /sdcard/CORE/models/<chat|code|stt|tts|vision|embed|other>/ show up after Rescan. Files placed loose in /sdcard/CORE/models/ show as Unsorted with Chat / Code buttons.
6. Turn on Offline mode (or leave Auto-switch on) and chat/coding questions go to your local models.

Real format is read from the file header (a GGUF renamed .bin runs). Models too big for the phone's RAM get a warning badge.
Formats accepted: .gguf .onnx .ort .tflite .task .litertlm .bin .safetensors .pt .pth, plus .json/.txt/.model/.vocab/.merges support files.
Runs today: GGUF (Chat, Coding). safetensors/pt/pth/old ggml: convert to GGUF with tools/convert-model.yml. ONNX/TFLITE/TASK/LITERT are stored until their engines are added. See tools/README_MODELS.txt.

Fixed in this version: More-tab crash (3 insertBefore bugs), AndroidX removed, AIDE-style gradle, API 23 WebView client, briefing null errors.

PERFORMANCE (new)
- core-perf.js adapts render resolution and glow effects to keep the animation smooth on your phone. It remembers the level between launches.
- Add ?perf=1 to the page URL (or ask me for a debug build) to see a live FPS / quality readout.
- three.js is now bundled in assets/vendor (starts faster, works offline).

TOOLS (new)
- New checklist button next to the settings gear opens Tools: Tasks, Timer (with Focus/Pomodoro and Alarm), Stopwatch, Notes.
- Shares data with voice/typed commands: "add task ...", "show my tasks", "timer for 10 minutes", "note ...".
- More commands: "open timer", "open tasks", "start pomodoro", "start stopwatch", "stop stopwatch", "cancel timers".
- A running timer or stopwatch shows as a small pill at the top of the main screen. The Android back button closes Tools.

OPENING SCREEN
- The Daily Briefing card now has an Add-a-task field and tick boxes. Open it any time by saying "daily briefing".

UNRESTRICTED MODE (new)
- Settings > Models: Unrestricted mode (on by default), custom system prompt, max answer length, temperature, context size (2048/4096/8192), messages remembered.
- The app adds no filtering. Built-in refusals live in the model weights: load an uncensored/abliterated GGUF.

TEXT TO IMAGE: build libsd.so with tools/build-sd.yml (see tools/README_MODELS.txt), add an SDXS-512 .safetensors under Text to image, then use Create image in Settings > Models.

BUILD WITHOUT AIDE: tools/build-apk.yml builds the APK on GitHub and also gives you gradlew + gradle/wrapper (download the "gradle-wrapper" artifact). AIDE keeps using its own build files.

GRADLEW BUILDS (AndroidIDE, PC, Termux): gradlew is in the project root and the root Gradle files are the modern ones. For the real AIDE app, copy the files in tools/aide/ back (app-build.gradle goes to app/build.gradle).

FULL PROJECT NOTES
- Root Gradle files = the setup that built on Java 8 (Android plugin 4.2.2, Gradle 6.9.4 via gradlew). Modern Java 17 versions are in tools/ci (used by the GitHub Build APK workflow).
- Opens on the Simple chat screen (core-simple.js). Side menu > Open full mode for the original interface.
- Add libcore_llm.so (chat) and libsd.so (images) to app/src/main/jniLibs/arm64-v8a/.

ONLINE MODE (Simple chat): model menu > Online. Auto tries Puter (if signed in), Hugging Face (token from Settings > Brain), then Pollinations. Online sends your messages to the internet; the footer says so. Offline stays the default.

CLOUD + PHONE CONTROL: see CLOUD_README.md (cloud/ worker, /cloud /phone /link chat commands).

MULTI-STEP TASKS (new): say e.g. "hey core open YouTube, search Parth Verma 67, subscribe, like the video called Big Day and comment nice one".
Needs: phone control ON (/phone), CORE accessibility service ON, CORE Cloud set (/cloud). It shows what it will do, you tap Run, it works up to 30 steps. STOP is in the notification.
It will not touch password fields, banking/password apps, or anything that looks like payments/memberships. It never types your phone PIN.
