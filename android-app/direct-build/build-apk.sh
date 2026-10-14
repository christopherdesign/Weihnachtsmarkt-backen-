#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DIRECT_DIR="$PROJECT_DIR/android-app/direct-build"
BUILD_DIR="$DIRECT_DIR/build"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-/workspace/scratch/android-sdk}"
BUILD_TOOLS="$ANDROID_SDK_ROOT/build-tools/36.0.0"
ANDROID_JAR="$ANDROID_SDK_ROOT/platforms/android-36/android.jar"
KEYSTORE="${ANDROID_DEBUG_KEYSTORE:-/workspace/scratch/android-debug.keystore}"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/compiled" "$BUILD_DIR/generated" "$BUILD_DIR/classes" "$BUILD_DIR/dex" "$BUILD_DIR/assets/www"
cp "$PROJECT_DIR/index.html" "$PROJECT_DIR/style.css" "$PROJECT_DIR"/app*.txt "$BUILD_DIR/assets/www/"

"$BUILD_TOOLS/aapt2" compile --dir "$DIRECT_DIR/res" -o "$BUILD_DIR/compiled/resources.zip"
"$BUILD_TOOLS/aapt2" link -I "$ANDROID_JAR" --manifest "$DIRECT_DIR/AndroidManifest.xml" \
  --min-sdk-version 24 --target-sdk-version 36 --version-code 10500 --version-name 10.5.0 \
  --java "$BUILD_DIR/generated" -A "$BUILD_DIR/assets" -o "$BUILD_DIR/app-unsigned.apk" \
  "$BUILD_DIR/compiled/resources.zip"

java -m jdk.compiler/com.sun.tools.javac.Main -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d "$BUILD_DIR/classes" \
  $(find "$DIRECT_DIR/src" "$BUILD_DIR/generated" -name '*.java' -print)
(cd "$BUILD_DIR/classes" && zip -q -r "$BUILD_DIR/classes.jar" .)
"$BUILD_TOOLS/d8" --lib "$ANDROID_JAR" --min-api 24 --output "$BUILD_DIR/dex" "$BUILD_DIR/classes.jar"
zip -q -j "$BUILD_DIR/app-unsigned.apk" "$BUILD_DIR/dex/classes.dex"
"$BUILD_TOOLS/zipalign" -f -p 4 "$BUILD_DIR/app-unsigned.apk" "$BUILD_DIR/app-aligned.apk"

if [[ ! -f "$KEYSTORE" ]]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -alias androiddebugkey -keypass android \
    -dname "CN=Android Debug,O=Android,C=DE" -keyalg RSA -keysize 2048 -validity 10000 -noprompt
fi
"$BUILD_TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias androiddebugkey --out "$BUILD_DIR/Weihnachtsmarkt-Backen-V10.5.apk" "$BUILD_DIR/app-aligned.apk"
cp "$BUILD_DIR/Weihnachtsmarkt-Backen-V10.5.apk" "$PROJECT_DIR/Weihnachtsmarkt-Backen-V10.5.apk"
echo "$PROJECT_DIR/Weihnachtsmarkt-Backen-V10.5.apk"
