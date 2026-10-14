# Weihnachtsmarkt Backen – Android

Die Android-App bündelt die aktuelle Web-App lokal mit Capacitor. Supabase-Synchronisierung, Jahresdaten und Freigabelinks bleiben unverändert erhalten.

## Debug-APK erstellen

```bash
npm ci
npm run android:debug
```

Die APK liegt anschließend unter `android/app/build/outputs/apk/debug/app-debug.apk`.

Vor jedem Android-Build kopiert `scripts/prepare-web.mjs` automatisch die aktuelle Version aus dem Projektstamm in das native App-Paket.

## APK ohne Gradle-Abhängigkeiten erstellen

Für eine vollständig reproduzierbare Debug-APK nur mit einem installierten Android SDK (API 36 / Build Tools 36.0.0):

```bash
npm run android:direct
```

Das Skript bündelt ebenfalls immer die aktuellen Dateien aus dem Projektstamm. Die APK wird als `Weihnachtsmarkt-Backen-V10.5.apk` im Projektstamm abgelegt. Diese Variante enthält zusätzlich die nativen Android-Dialoge für Bonfotos, JSON-Import und JSON-Export.

## Vom Eigentümer freigegebene App-Updates

Die Android-App prüft beim Start und beim Wechsel zurück in die App ausschließlich `mobile-release.json`. Änderungen an der normalen Website werden dadurch nicht automatisch in der Android-App sichtbar.

Ein Rollout wird bewusst vorbereitet und erst durch die Änderung der Manifestdatei freigegeben:

```bash
npm run release:web -- 10.5.1
```

Danach wird `mobile-release.json` auf den neuen unveränderlichen Ordner unter `mobile-releases/` gesetzt und der getestete Stand veröffentlicht. Es gibt in der App keinen manuellen Update-Schalter. Ohne Internet bleibt die in der APK enthaltene Version nutzbar.
