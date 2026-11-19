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

Live-Browsertest in der isolierten Vercel-Vorschau (Code-Commit `a08f5d92d6b42cd3675571c2637f401a9e318224`): drei synthetische Keks-Eimer produziert, zwei reserviert → ein Eimer frei; einen abgeholt → weiterhin ein Eimer frei, ein Eimer offen, Status „Teilweise abgeholt“. Nach Neuladen waren Status, Restmenge und drei ausstehende Änderungen weiterhin sichtbar. Keine echten Kunden- oder Belegdaten eingegeben. Produktives Release-Manifest weiterhin V10.5.4.

## Serverseitiger Bestandswächter – isolierter Prüfstand

- `db-proposals/issue-5-stock-guard.sql` ist ein Entwurf und wurde nicht in Supabase ausgeführt. Der Trigger prüft Produktion minus Verkäufe minus offene Reservierungen in derselben Zeilenänderung für den jeweiligen Arbeitsbereich und das Jahr. Bestehende Datenbankregeln für den Arbeitsbereich bleiben unverändert.
- Der Entwurf weist negative Bestände, rückwärts gesetzte Reservierungsstände und Verkäufe ohne passende aktive Teilabholung zurück. Historische Jahre ohne Reservierungsfeld werden nicht umgeschrieben. Ein bereits für Reservierungen aktiviertes Jahr darf dieses Feld nicht mehr verlieren. Vor einem Rollout müssen Altgeräte und der Umgang mit möglicherweise bereits negativen Jahresbeständen geprüft werden.
- `tests/stock-guard.pg.cjs` bestand mit PGlite 0.5.17: veralteter Versionsvergleich, Überbuchung durch Direktverkauf und Produktionskorrektur, Korrektur einer Abholung sowie Schutz vor Löschen, Umpreisen und Wiederherstellen der zugehörigen Verkaufszeile. Das synthetische Test-RLS blieb wirksam. Das ersetzt keinen Test mit der tatsächlich eingerichteten Supabase-API.
- `tests/stock-concurrency.pg.cjs` ist für zwei parallele PostgreSQL-Verbindungen vorbereitet. Die Runner-Umgebung verweigerte die lokale Unix-Socket-Verbindung mit EPERM; der native Paralleltest ist daher **nicht bestanden/verifiziert**. Der bestehende Vercel-Browser-Test betraf ausschließlich die lokale Reservierung.
- Für die Cloud-Integration fehlen weiterhin eine fachliche Konfliktauflösung mit Erhalt abgewiesener Offline-Vorgänge und die geprüfte Aktivierung ausschließlich für neue Clients. Reservierungen bleiben auf der Produktiv-Domain deaktiviert. Die Vorschau verhindert zusätzlich lokale Produktionskorrekturen unter die bereits verkaufte und reservierte Menge.

Weitere Freigabepunkte: physische Android-Gerätetests, neue vollständige Wiederherstellung, Verbrauchsmessung der produktiven API, Abgleich bereits geleisteter Zahlungen und Update mit ausstehenden Änderungen. Kein Merge, keine produktive Migration, kein produktiver Release.
