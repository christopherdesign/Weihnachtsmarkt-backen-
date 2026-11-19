# Weihnachtsmarkt Backen – Audit und Zwischenprüfung zu Issue #5

Stand: 19.11.2026. Dieser Entwicklungsstand ist **nicht zur Produktivfreigabe bereit**.

## Ausgangslage und Sicherung

- Arbeitsbranch: `work/weihnachtsmarkt-next-safe`; Ausgangspunkt von `main` und Branch: `10ac0f3bcb1c1291a49ba180b57c3e242b031564` (V10.5.4). Audit: kein paralleler offener PR.
- Produktiver Updatekanal: `mobile-release.json` meldet V10.5.4 und nativeVersion 10501. GitHub meldet erfolgreichen verbundenen Vercel-Deploy `2xJg9M4gv6yV7GAqQD8X8UNZ7Sfd`. Der Direct-Build-Wrapper besitzt eine Manifestprüfung beim Start und bei Wiederaufnahme; Geräte und Signatur wurden nicht direkt geprüft.
- Der lesend geprüfte gemeinsame Cloud-Datensatz umfasst das Cloud-Jahr 2026. Der vorhandene Vorab-Schnappschuss stimmt beim Audit byteinhaltlich mit dem aktiven JSON-Datensatz überein (Vergleich per Datenbankinhalt-Fingerabdruck). Er enthält 12 Einkäufe, 11 eingebettete Bonfotos, 42 Produktions-, 54 Verkaufs- und 79 Energieeinträge. Nicht synchronisierte Handy-Daten sind darin nicht enthalten.
- Vor Freigabe: neue Sicherung aller tatsächlich verwendeten Cloud-Jahre und Einstellungen, vier gerätebezogene JSON-Exporte aller lokal vorhandenen Jahre einschließlich Warteschlange, Nachweis von Dateiprüfsummen und isolierter Wiederherstellung, Vergleich von IDs, Zahlen und Foto-Hashes. Originale unverändert lassen. Die frühere Vollsicherung wurde bereits im vorigen Release separat wiederhergestellt; der neue Ende-zu-Ende-Restore ist offen.

## Bestandsaufnahme

| Bereich | V10.5.4 | Gezielte Weiterarbeit |
|---|---|---|
| Energie | Zwei Cloer-Gruppen und manuelle Nachtragung vorhanden; die gemeldete Doppelanzeige ist erledigt. | Unverändert; Regressionstest zu historischen Preisen und Mitternacht. |
| Einkauf/Abrechnung | Gemeinsam/Neutral, hälftiges Ergebnis und negativer Saldo vorhanden. | Bereits erfolgte Zahlungen/Ausgleich getrennt erfassen und testen. |
| Synchronisierung | Zeitstempel-Polling und Vergleich-vor-Schreiben vorhanden. Keine dauerhafte Anzeige ausstehender Änderungen, Risiken bei Neustart und Jahreswechsel. | Jahresbezogenes lokales Journal mit atomarem lokalen Speichervorgang, IDs, Bestätigung, Backoff und Status; Großbestände/Quoten und Konflikte weiter testen. |
| Verkauf | Direktverkauf vorhanden; keine Reservierung. | Reservierungen, Mehrfachabholung, Storno und Korrektur im bestehenden Verkaufsbereich. Serverseitige Transaktion noch offen. |
| Updates | Vorhandene Domain und Web-Release per Android-Wrapper. | Alte Release-Dateien und Manifest unangetastet lassen, Update mit Pending-Daten real testen. |

## Isolierter Entwicklungsstand

- Vorschau hat keinen Produktions-Cloud-Zugriff. Reservierungsmaske ist explizit nicht auf dem Produktionshost aktiv.
- Lokaler Reservierungsstand, Vorgangsrevision und Auditspur; Teilabholung verwendet die bestehende Verkaufshistorie. Korrektur gibt die Menge wieder als reserviert frei und entfernt die dazugehörige Umsatzbuchung, ohne das Korrekturprotokoll zu löschen.
- Vorschau kann keine transaktionssichere Reservierung über vier Geräte belegen. Dazu muss der Server die Bestandsprüfung und alle bestandswirksamen Änderungen gemeinsam absichern. Insbesondere müssen parallele Direktverkäufe, Produktionskorrekturen und alte Clients berücksichtigt werden.
- Vor Veröffentlichung müssen Speicherquoten mit Originalgröße und lokaler Archivierung geprüft werden. Das Vorschau-Journal bewahrt alte Schlüssel absichtlich; eine zusätzliche Vollkopie kann bei großen Belegbeständen an die WebView-Speichergrenze stoßen. Kein Löschen alter Daten als Ausweichlösung.

## Testnachweis dieses Zwischenstands

`node --test tests/offline-journal.test.js tests/reservations.test.js`: fünf Tests erfolgreich. Geprüft wurden Offline-Einkauf und Neustart, Schreibfehler ohne Erfolgsmeldung, vier simulierte Geräte mit Konfliktvergleich und Bonfoto-Erhalt, Polling nur der Metadaten im Ruhezustand, Bestand und Umsatz bei Mehrfachabholung, Storno, Korrektur, wiederholte IDs und veraltete Revisionen. JavaScript-Syntax der zusammen geladenen Dateien erfolgreich geprüft.

Offen: echter Browser-/Gerätetest, neue vollständige Wiederherstellung, Verbrauchsmessung der produktiven API, transaktionssichere Cloud-Reservierungen, Offline-Bestandskonflikte, Abgleich bereits geleisteter Zahlungen, Update mit ausstehenden Änderungen und Freigabe. Kein Merge, keine produktive Migration, kein produktiver Release.
