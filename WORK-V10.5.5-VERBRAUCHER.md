# Energieverbraucher – Fehlerbehebung zu V10.5.5

## Befund

- Android-Aufnahme vom 21.11.2026: Rusche „Cloer“ mit 5 × 800 W und „Cloer Hörncheneisen“ mit 1 × 800 W; beide mit eigenem, im Video gestopptem Timer. Zwei weitere Herde mit unterschiedlichen Wattzahlen sind kein Nachweis für ein Duplikat.
- Veröffentlichter Quellcode V10.5.5: Startlogik ergänzte in bereits gespeicherten Listen ein Standardgerät, wenn sie die Standard-ID nicht fand. Der damalige Ansichtsfilter verglich ID oder den ausgeschriebenen Gerätenamen und erkannte den Namen „Cloer“ nicht.
- Lesender Abgleich des gemeinsamen Supabase-Bestands 2026 gegen die vorhandene Sicherung: identisch; letzter gespeicherter Zeitpunkt 18.11.2026, 21:59:59 MEZ. Das Gerät „Cloer“ (`device-218873e0-fb8b-428f-8989-edc625da705a`) hat 5 Eisen und 800 W je Eisen. `dev-rusche-iron` war dort nicht vorhanden. Der Cloud-Stand kann die Warteschlangen und lokalen Geräteeinstellungen der vier Handys nicht abbilden.
- Energieprotokoll im gesicherten Cloud-Stand: 79 Einträge, darunter zwei zugeordnet zu Rusches tatsächlichem Cloer. Keine identischen Zeitintervalle unter diesen beiden Einträgen, keine überlappenden Buchungen über bekannte Cloer-Geräte-IDs und keine Buchung mit der Standard-ID. Das bestätigt nicht den Stand noch unsynchronisierter Handys.

## Änderung in der Vorschau

- Erfasst ausschließlich das bestätigte Paar der zwei Geräte-IDs in Rusches Hörncheneisen-Gruppe; keine Zusammenführung anderer Geräte nach Namen oder Leistung.
- In bestehenden Gerätelisten wird ein fehlendes Rusche-Standardgerät nicht mehr automatisch ergänzt. Bei beiden IDs erhält die konfigurierte Gruppe Vorrang in Einstellungen und Nachtrag; Timer und Schnellstart zeigen bei Bedarf einen noch laufenden Alt-Timer, damit er sich korrekt abschließen lässt. Keine automatische Buchung oder Löschung.
- Das erneute Einspielen der alten Standard-ID über die Synchronisierung erzeugt auf aktualisierten Clients keine zweite Bedienkarte. Bestehende Geräte-IDs, Timer und alle historischen Buchungen bleiben unverändert; keine produktive Bereinigung.
- Nicht synchronisierte Daten eines Gerätes können erst anhand seines Exports geprüft werden. Ein Gerät, das nur die Standard-ID kennt, kann die Fünf-Eisen-Konfiguration erst nach erfolgreichem Abgleich anzeigen.

## Abnahme

- Pipeline im PR: Chromium-Mobilansicht mit der realen Namensvariante, 5 × 800 W, beiden möglichen Alt-Timern, Synchronisierung mit abgefangener API und stabilem Fokus; vier simulierte Offline-Handys mit getrennten lokalen Daten und anschließendem Abgleich. Keine echten Kundendaten, keine Produktionszugriffe im Test.
- Noch offen: aktuelle Exporte von allen vier Handys, Prüfung ihrer lokalen Alt-Timer und Protokolle, Offline-Neustart und anschließende echte Synchronisierung auf den vier Geräten, native Tastatur/Picker bei der Eingabe. Erst nach Sicherung und Freigabe eine produktive Datenbereinigung erwägen. Der produktive Updatekanal bleibt unverändert.
