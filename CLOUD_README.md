# CORE Cloud + Phone control

## 1. Put it on GitHub
Push this folder as the repo root (so `.github/workflows` is at the top). Models and the .so files are big; `.gitignore` skips *.gguf and APKs.

## 2. Deploy the backend (Cloudflare Workers, free)
1. Make a Cloudflare account and an API token (template: "Edit Cloudflare Workers"). Note your Account ID.
2. Get an API key from an OpenAI-compatible host. Default is Groq (fast); change `UPSTREAM_URL` / `MODEL` in `cloud/wrangler.toml` for others.
3. Repo > Settings > Secrets > Actions, add:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `UPSTREAM_KEY`,
   `DEVICE_TOKEN` (long random string, goes on the phone), `CONTROL_TOKEN` (a different long random string, stays with you).
4. Actions > "Deploy cloud" > Run workflow. Your URL looks like `https://core-cloud.<you>.workers.dev`.

GitHub itself only hosts the code and runs the deploy. It cannot run a backend.

## 3. Phone setup (in the CORE chat box)
- `/cloud https://core-cloud.<you>.workers.dev <DEVICE_TOKEN>` then pick **CORE Cloud** in the model menu.
- `/phone` and follow the prompts (switch on "CORE phone control" in Accessibility, then approve the dialog).
- Instant commands, no model and no network: `home`, `back`, `open youtube`, `scroll down`, `volume up`, `call 555...`, `search ...`
- With CORE Cloud selected, plain requests ("open Spotify and scroll down") become phone plans.
- `/link on` lets your own scripts send commands to the phone (CORE must be open):
  `curl -X POST $URL/v1/cmd -H "Authorization: Bearer $CONTROL_TOKEN" -d '{"actions":[{"do":"open","app":"Spotify"}]}'`

- `/phone auto on` (one native approval) makes every plan run with no per-plan Allow; `/phone auto off` goes back.

## Hold-Home assistant
1. Install the app, then send `/assistant` in the chat (opens the phone's assistant settings) and pick **CORE** as the Digital assistant app. Allow the microphone when asked.
2. Hold Home (gesture phones: hold the bottom bar; some phones use the power button, set under Settings > Gestures / Side key).
3. A small card listens. Quick commands (`open youtube`, `scroll down`, `go home`) run locally and instantly. Anything else goes to CORE Cloud, which needs `/cloud` set up once and phone control on (`/phone`).
- The card closes before actions run, so taps, typing and reading act on the app you were in. Results come as a toast and spoken reply.
- Works on an unlocked phone. If another app's voice typing breaks after switching assistants, tell me.

## Wake word + unlock
- `/wake on` starts a background listener (notification + mic indicator stay visible; it uses battery). Say "hey core" alone to get the card, or "hey core open youtube" to run it directly. `/wake off` stops it. `/wake word hey jarvis, ok jarvis` changes the phrases. Re-arm it with `/wake on` after a reboot.
- It needs CORE set as your assistant (`/assistant`) so it can open over other apps and the lock screen.
- If the phone is locked when a plan needs to act, CORE wakes the screen and asks Android to unlock: your face/fingerprint/PIN is used and CORE never sees it. A swipe-only lock just opens. After unlock the plan runs.
- v1 detects the wake word with the phone's speech recognizer in a loop. It can miss words between listens and may ding on some phones. A dedicated wake-word engine (Porcupine, openWakeWord) is the proper upgrade.

## Actions
home, back, recents, notifications, quick, scroll{dir}, volume{dir}, open{app}, alarm{hour,min,label}, wait{ms}, media{key}, torch{on}, screenshot, lock, power, settings{page} run immediately.
tap{x,y}, swipe{x1,y1,x2,y2}, longpress{x,y}, click{text}, type{text}, read, dial{number}, sms{number,text}, url{url}, intent{action,data,package,type,extras} (any app or system screen that has an Android intent) need one on-screen Allow per plan.

## Known limits (v1)
- Remote link runs inside the open app. Staying connected with the screen off needs a foreground service (next step).
- One-shot plans: the model can't yet look at the result and continue (observe-act loop is the next step).
- Android blocks accessibility on secure screens (lock screen, some banking apps, FLAG_SECURE), and CORE refuses tap/type/read on banking, wallet and password-manager apps (list in PhoneControlService.java).
- Written without an Android SDK here, so it has not been compiled. If the build errors, send me the log.
- The page still loads third-party scripts (Puter, Google sign-in, jsDelivr). Phone control is gated natively so they can't use it silently, but removing unused ones is worthwhile.
