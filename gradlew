#!/usr/bin/env sh
# Bootstrap gradlew: uses Gradle if already installed, otherwise downloads Gradle 8.7 once.
# Needs Java 17. Run: bash ./gradlew assembleDebug
cd "$(dirname "$0")" || exit 1
if [ ! -f local.properties ]; then
  SDK="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
  [ -n "$SDK" ] && echo "sdk.dir=$SDK" > local.properties
fi
V=6.9.4
D="$HOME/.core-gradle"
G="$D/gradle-$V/bin/gradle"
if [ ! -x "$G" ]; then
  mkdir -p "$D" || exit 1
  URL="https://services.gradle.org/distributions/gradle-$V-bin.zip"
  echo "Downloading Gradle $V ..."
  if command -v curl >/dev/null 2>&1; then curl -fL -o "$D/g.zip" "$URL" || exit 1
  else wget -O "$D/g.zip" "$URL" || exit 1; fi
  unzip -q -o "$D/g.zip" -d "$D" && rm -f "$D/g.zip" || exit 1
fi
exec "$G" "$@"
