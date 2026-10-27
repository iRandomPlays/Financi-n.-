# Onderzoek en status

## Gevonden in jouw Home Assistant (alleen gelezen, niets gewijzigd)
| Onderdeel | Versie / status |
|---|---|
| Home Assistant | 2026.10.2, Europe/Amsterdam |
| Spoolman-Ingress (bytenoodle) | 0.27.0-0, draait; Ingress-poort 7912, geen directe poort |
| SpoolmanSync-add-on | 1.6.14, draait |
| Bambu Lab-integratie (`bambu_lab`) | geladen; printer **Bambu X2D** (dubbele nozzle, 0,4 mm; serienummer 20P9BJ620700578), firmware niet uitgelezen; verbinding via `bambu_cloud` (MQTT via Bambu-cloud, niet LAN) |
| SpoolmanSync-automations | `Tray Change` en `Update Spool` actief voor deze printer |
| Spoolman Bambu Bridge | niet geïnstalleerd |

## Hoe SpoolmanSync (1.6.14) Bambu-verbruik berekent (broncode `ha-config-generator.ts`)
- Sensor "Filament Usage" = `print_weight / 100 × print_progress` (het **geplande** gewicht uit de slicer × voortgang). Dit is een schatting, geen gemeten extrusie.
- Een utility meter telt dit op; de waarde wordt afgeboekt via webhook (`used_weight`) op de actieve tray bij een traywissel of printeinde (`finished`/`idle`), en bij 2 minuten offline wordt de meter gereset.
- Gevolg: een print gestopt op 25% boekt ongeveer 25% van het geplande gewicht, niet het werkelijke verbruik. Spoelverbruik bij kleurwisselingen en laagverschillen zitten er niet in. Dit is gelezen uit de code, nog niet op jouw printer getest.
- Bij meerdere kleuren hangt de juistheid af van het moment van traywissel; de voortgang loopt door over alle tools.

## Bambu Filament Manager (cloud, niet-openbare API, uit cgradl/filament-manager)
- Basis: `https://api.bambulab.com/v1/design-user-service/my/filament/v2` (GET lijst, POST aanmaken, PUT bijwerken met `id` in body, vereist `filamentName`).
- Login: `/v1/user-service/user/login`, e-mailcode via `sendemail/code`, authenticator via `tfa/login`.
- Deze endpoints zijn niet door mij tegen een echt account geverifieerd; ze komen uit de broncode van een derde.

## G-code en gedeeltelijk verbruik (antwoorden op de vragen uit de opdracht)
| Vraag | Stand |
|---|---|
| 1-2 Bestand verkrijgen (printeropslag, cloud, slicer) | Niet onderzocht op jouw printer. Kandidaten: `.3mf` via FTPS op de printer, Bambu Cloud-taak (`/my/tasks`), of de slicer zelf. |
| 3 Extrusie/wissels leesbaar | Ja in model-G-code (E-waarden, `T<n>`, `M620 S<n>A`); geïmplementeerd in `usage.mjs`, getest met synthetische G-code. |
| 4-5 Positie in bestand | Alleen laag, tijd of voortgang bekend via de HA-integratie; een bestandsregel is niet aangetoond. Daarom is de onzekerheid één laag. |
| 6 Filamentnummer → AMS-slot | Niet geverifieerd; vereist het `ams_mapping` van de gestarte print. |
| 7 Verbruik door firmware/macro's | Laden, ontladen en spoelen zijn niet volledig zichtbaar in model-G-code; `usage.mjs` telt ze niet mee en meldt dat. |

`POST /api/estimate` geeft een **voorstel** (`kind: schatting`, bron, onzekerheid, `requiresConfirmation: true`). Er wordt niets in Spoolman geboekt.

## Teststatus
| Onderdeel | Status |
|---|---|
| Synchronisatie, koppelen, aanmaken zonder duplicaat, pauzeren, herstel, interval, Ingress-weigering, G-code-analyse | **Lokaal getest met gesimuleerde diensten** (12 tests geslaagd) |
| Gewicht afronden, state na herstart | Lokaal getest |
| Installatie als add-on (via repository-URL met branch), bouw op aarch64, start, UI en API via Ingress | **Getest in Home Assistant** (0.2.1, 2026-10-26) |
| Verbinding bridge → Spoolman via `http://2c829f0e-spoolman-ingress:7912` (1 actieve rol gevonden) | **Getest in Home Assistant** |
| Mobiele weergave, UI in een echte browser | **Nog niet geverifieerd** |
| Bambu-login (met verificatiecode), lijst, gewichtsupdate in Bambu-cloud, naam blijft behouden | **Getest in Home Assistant met het echte Bambu-account** (2026-10-26) |
| Handmatige en automatische synchronisatie (ronde van 60 s) | **Getest in Home Assistant** (tijdelijke wijziging 1000→999 g en 300→295 g, daarna teruggezet) |
| Rol zichtbaar in Studio/Handy, selectie op AMS-slot of printerscherm | **Nog niet geverifieerd**; cloudsynchronisatie bewijst dit niet |
| Verbruik normale/meerkleuren/afgebroken print, weegtests | **Nog niet geverifieerd** |

## Bekende beperkingen
- Geen schrijven naar Spoolman, geen tweerichtingssync, geen verwijderen van lege Bambu-rollen.
- SpoolmanSync is niet aangepast. Het afgebroken-printprobleem vraagt een wijziging of aanvullende automatisering die pas na praktijkmeting van jouw printer zinvol is.
- Bridge 0.2.0 is een herbouw volgens de opdracht; de oorspronkelijke 0.1.0-code (inclusief de 17 tests) was niet beschikbaar en is niet vergeleken.
- Het ZIP staat niet in de repository; bouw met `git archive` (zie hieronder).

## Volgende stappen (vereisen jouw omgeving)
1. Bridge installeren, Spoolman-URL bepalen, back-up van Spoolman maken.
2. Eén rol koppelen en handmatig synchroniseren; resultaat in Studio/Handy bekijken.
3. Testprint van 1 kleur, daarna meerkleuren en een bewust geannuleerde print; wegen en vergelijken met SpoolmanSync (let op leeg rolgewicht en weegschaalnauwkeurigheid).
4. Pas daarna bepalen of de G-code-route (of firmware-`ams_mapping`) SpoolmanSync moet aanvullen.

## Uitgevoerd in Home Assistant op 2026-10-26
- Back-up `04232042` ("Voor Bambu Bridge - 2026-10-26", add-ons + configuratie, zonder database) naast de automatische back-up `cbc1bc89` van 04:24 (met database). Mijn back-up werd pas na een time-out zichtbaar; de Supervisor was daarna even bezig.
- Spoolman bevat 1 rol: #1 Sunlu PLA Black, 1000 g van 1000 g, niet gearchiveerd. Het veld `extra.active_tray` is door SpoolmanSync aangemaakt.
- Add-on-repository `https://github.com/iRandomPlays/Financi-n.-#ccr-07122be8-fap75g` toegevoegd en de bridge geïnstalleerd en bijgewerkt naar 0.2.1. De store gebruikt de branch, niet de hoofdtak: na een merge of verwijderen van de branch moet de repository-URL worden aangepast.
- In de bridge alleen de Spoolman-URL ingesteld. Geen koppelingen, geen Bambu-login, automatisch synchroniseren uit.
- Spoolman en SpoolmanSync zijn niet gewijzigd.

## Printer en AMS (uitgelezen 2026-10-26)
- X2D met 1 AMS (4 trays) en 2 externe spoelen; links en rechts een 0,4 mm hardened-steel nozzle.
- Trays: 1 wit, 2 roze/rood (#F95D73), 3 blauw, 4 zwart (#161616). Alle `tray_uuid` zijn nullen en `remain` is -1: geen RFID, dus de rolidentiteit komt volledig van handmatige toewijzing. Externe spoelen zijn leeg.
- In SpoolmanSync is **geen enkele rol aan een tray gekoppeld**; de logs melden "no spool is assigned". Spoolman bevat maar 1 rol (Sunlu PLA Black) tegenover 4 kleuren in de AMS. De laatste print (24 oktober, 31 g, 86 lagen) is daardoor nergens afgeboekt.
- De HA-integratie levert wel: printgewicht, printlengte, huidige/totale laag, voortgang, taaknaam en G-code-bestandsnaam (`plate_1.gcode` uit een cloudtaak). Dat is genoeg voor een laaggebaseerd voorstel; het bestand zelf is via de cloud-modus niet beschikbaar zonder LAN-toegangscode of cloud-download.
- Risico: SpoolmanSync is ontworpen rond één actieve tray; de X2D heeft twee nozzles. Of de sensor "Active Tray" (nu leeg) bij een X2D-print goed werkt, is niet aangetoond.

## Voorraadimport en koppelingen (2026-10-26)
- Bambu's Filament Manager bevatte 12 rollen, Spoolman 1. Uit Bambu zijn 10 rollen als nieuwe Spoolman-rollen (ID 2-11, filamenten ID 2-9) aangemaakt met het Bambu-ID in de opmerking. Spoolman blijft daarna leidend.
- Alle 11 koppelingen: Spoolman #1 ↔ 7025377 en #2-#11 ↔ de Bambu-ID's in hun opmerking. Spoolman #1 en #10 zijn twee identieke zwarte C220-rollen; welke fysiek welke is, is willekeurig gekozen en nog niet bevestigd.
- Niet gekoppeld: Bambu-rol 6651172 (Bambu Lab PLA Matte blauw, 779/1000 g, `createType: ams`). Bambu werkt die zelf bij via de AMS; synchroniseren zou kunnen botsen.
- Automatisch synchroniseren staat aan (60 s).
- Nog niet gedaan: rollen aan AMS-trays koppelen in SpoolmanSync. Tray 2 (roze) en 3 (blauw) hebben geen bekende rol in Spoolman.

## Dashboard "Printer & Filament" (2026-10-27)
- Nieuw dashboard `printer-filament` met drie pagina's: **Print** (cover, status, voortgang, laag, temperaturen met grafiek, printerstatus), **Filament** (totale voorraad, lage rollen, tabel van alle rollen, verloop) en **AMS** (vochtigheid, temperatuur, drogen, sloten, rol per tray, snelkoppelingen naar Spoolman, SpoolmanSync en de bridge).
- Het bestaande dashboard "Home" met de pagina "Printer" is niet gewijzigd.
- Bron van de voorraad: bridge 0.3.0 publiceert `sensor.spoolman_rol_<id>`, `sensor.spoolman_voorraad` en `sensor.spoolman_bridge_status`. Sjablonen getest met de echte gegevens (10 rollen, 8950 g).
- Niet geverifieerd: weergave in de browser (geen screenshotfunctie beschikbaar), de snelkoppelingen `/hassio/ingress/<slug>`, en de kolom "Tray" zolang er geen rollen aan trays zijn gekoppeld. De cameraweergave is weggelaten omdat de camera-entiteit `unavailable` is.

## Printgeschiedenis (2026-10-27)
- Bridge 0.4.0 leest de `spool_usage`-afboekingen uit SpoolmanSync (`/api/logs`, zonder inlog bereikbaar via `http://172.30.32.1:3005`), groepeert ze per print (binnen 15 min) en publiceert `sensor.printgeschiedenis`. Printnaam, status en voortgang komen van de officiële Bambu-integratie op het moment dat de afboeking wordt gezien.
- Onderaan het dashboard "Printer Studio" staat de tabel (tijd, print, resultaat, gram per rol, totaal).
- Getest: lokaal met nagebootste diensten (20 tests); in Home Assistant is aangetoond dat de bridge SpoolmanSync bereikt en de sensor publiceert (0 prints). **Niet getest met een echte afboeking**: die ontstaat pas na de eerste print met een aan een tray gekoppelde rol.
- De grammen zijn de schatting van SpoolmanSync (gepland gewicht x voortgang), geen meting.

## Rol toevoegen met foto (2026-10-27)
- Bridge 0.5.0 heeft een tweede poort (8100) met token voor de pc-app in `rolscanner/`; Codex CLI leest het label lokaal op de pc, de gebruiker controleert de velden, daarna gaat de rol naar Spoolman en (autoCreate) naar Bambu.
- **Getest in Home Assistant** met een testrol: token aanmaken, poort 8100 weigert zonder token (401) en toont de normale bridge-API niet, rol toevoegen via poort 8100 (nieuwe leverancier, filament met nozzle 215 en bed 58 °C, rol 333 g), rol verscheen binnen één stap in Bambu met de juiste kleurnotatie, daarna opgeruimd (rol, filament, leverancier; Bambu-rol is door de bridge verwijderd).
- **Lokaal getest** (27 tests, nagebootste diensten): validatie, hergebruik van bestaand filament, token en blokkade, nagebootste `codex`, rolscanner-server.
- **Niet getest**: de echte Codex CLI (opdrachtregel en leeskwaliteit van jouw labels), en de webpagina in een echte browser of op een telefoon.

## Bambu-profiel ("Type") bij nieuwe rollen (2026-10-27)
- In Handy kiest de gebruiker bij "Type" merk en profiel (bijv. SUNLU PLA C220); dat is `filamentId`. De openbare bibliotheek (`/filament/config`, vraagt inlog) bevat 99 profielen in 6 merken, maar bij SUNLU **niet** PLA C210 en C220 (wel Matte, PETG, Marble, PLA+, PLA+ 2.0, Silk PLA+, Wood PLA). Een eerdere aanname dat C210/C220 "vaste bibliotheekprofielen" zijn, klopte dus niet; hun ID's (`P9877e1f`, `Paed3d28`) komen uit het eigen account.
- De bridge (0.6.1) combineert profielen van bestaande rollen met de bibliotheek en gokt niet. Lokaal getest (33 tests, incl. een bibliotheek zonder C220). **Nog niet getest in Home Assistant met een echte aanmaak** en niet getest of Handy de zo aangemaakte rol met het juiste Type toont.
- **Getest in Home Assistant (0.6.1):** een testrol "Sunlu PLA C220 Testkleur" via poort 8100 kreeg in Bambu SUNLU / PLA / PLA C220 met profiel `P9877e1f`, gelijk aan de bestaande C220-rollen, daarna opgeruimd (rol, filament; Bambu-rol door de bridge verwijderd). Of Handy dit als Type "PLA C220" toont, is niet met de app bekeken.

## Vaste typen en locaties (2026-10-27)
- Je eigen Studio-profielen staan in de Bambu-account (`/v1/iot-service/api/slicer/setting`, onder `filament.private`). De `filament_id` daarvan is het `filamentId` dat een rol in de Filament Manager krijgt: SUNLU PLA C190 `P71db9ac`, C210 `Paed3d28`, C220 `P9877e1f`, PETG Basic `P05a4964` (de eerder bij de bestaande PETG-rol gezien `GFSNL08` is het profiel uit de openbare bibliotheek, niet jouw eigen). Er staat ook een kopie "Bambu PETG Basic" (`GFG00`) in je account; die gebruik ik niet.
- Bridge 0.7.0: typen en locaties in de instellingen, rolscanner met menu voor locatie en type.
- Aannames die jij moet bevestigen: nozzletemperatuur 190/210/220 bij C190/C210/C220, PETG Basic zonder standaardtemperatuur, bed leeg.
- **Getest in Home Assistant (0.7.0):** testrol met type C190 en locatie Ine via poort 8100: Spoolman kreeg locatie "Ine" en nozzle 190 °C bij het filament, Bambu kreeg SUNLU / PLA / PLA C190 met profiel `P71db9ac`; daarna opgeruimd (rol, filament, Bambu-rol). De rolscanner-pagina zelf en Codex zijn niet in een browser of met echte foto's getest.

## QR-label in de rolscanner (2026-10-27)
- Na het opslaan toont de rolscanner het QR-label van de rol: `http://homeassistant.local:3005/scan/spool/<id>` (SpoolmanSync, poort 3005 op het eigen netwerk, zonder inlog; formaat uit de broncode van SpoolmanSync). De hostnaam van het systeem is `homeassistant`; het IP van de Home Assistant-host kon ik niet vinden en is niet aangenomen.
- **Getest:** eigen QR-generator (`rolscanner/qr.mjs`) uitgelezen met OpenCV voor 13 teksten, versie 1 t/m 10, ook met speciale tekens; de pagina in een echte browser (Chromium, telefoonbreedte) met nagebootste bridge en Codex: locatie en type kiezen, nozzle invullen, foto lezen, opslaan, label tonen en uitlezen uit het scherm, locatie en type blijven na opslaan en herladen staan.
- **Niet getest:** de echte Codex CLI met echte labels, het afdrukken op een labelprinter, en of `homeassistant.local` op de telefoon van de gebruiker wordt gevonden of een scan daadwerkelijk de tray-keuze opent.
- SpoolmanSync-instelling `syncSpoolmanLocation` staat uit; moet uit blijven, anders zou SpoolmanSync de locatie (Vincent/Ine) overschrijven met de tray.

## Direct printen naar de Niimbot D101 (2026-10-27)
- Onderzoek: `reports/Niimbot D101 QR printen via Android.md`. Praktijk: Chrome 156 op de Android-telefoon van de gebruiker heeft de vlag "Insecure origins treated as secure"; `https://niim.blue` verbond met de D101.
- Gebouwd in de rolscanner: Web Bluetooth-printknop met `@mmote/niimbluelib` 0.47.1 (meegeleverd in `rolscanner/vendor/`, MIT), label tekenen (liggend, zwart-wit, QR 3 punten per blokje), verbinden in dezelfde tik als opslaan, herprinten, testlabel, instelbare labelmaat/dichtheid/print task.
- **Getest:** echte bibliotheek in Chromium (coderen naar 160 x 240 voor een label van 30 x 20 mm, geen grijstinten, QR leesbaar met OpenCV) en nagebootste printer (volgorde, annuleren, afdrukfout, testlabel, uitgeschakelde automatische afdruk, uitleg bij onveilig adres).
- **Niet getest:** een echte afdruk op de D101. Open punten: werkt Bluetooth via de Chrome-vlag, welke print task (B1 of D110M_V4), draairichting en uitlijning, blanco eerste label na inschakelen (niimblue #108), labelmaat.
