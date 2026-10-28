# Rolscanner

Rol toevoegen met een foto van het label. Codex (lokaal op je pc) leest merk, materiaal, naam en kleur, jij controleert en vult het gewicht in, en één tik zet de rol in Spoolman. Staat "nieuwe Spoolman-rollen automatisch in Bambu aanmaken" aan in de bridge, dan komt de rol daarna ook in Bambu's Filament Manager.

```
telefoon of pc-browser  →  rolscanner (je pc, Codex CLI)  →  bridge-poort 8100 (token)  →  Spoolman  →  Bambu
```

## Installeren (eenmalig)
1. Node 20 of nieuwer en de Codex CLI (`codex`) staan op je pc en je bent ingelogd bij Codex.
2. Werk de bridge bij naar 0.5.0 (Home Assistant: Instellingen, Add-ons, Spoolman Bambu Bridge, bijwerken).
3. Open de bridge, onderdeel **Pc-app**, kies **Nieuw token aanmaken** en kopieer het token (wordt maar één keer getoond).
4. Kopieer `rolscanner.config.example.json` naar `rolscanner.config.json` en vul `bridgeUrl` (bijv. `http://homeassistant.local:8100`) en `token` in. Zet het token alleen in dit bestand, nooit in de repository.
5. Start met `node rolscanner.mjs` en open <http://localhost:8787>.

Voor gebruik met je telefoon zet je `"host": "0.0.0.0"` in de config en open je `http://<ip-van-je-pc>:8787`. De pagina heeft zelf geen wachtwoord; doe dit alleen op je eigen netwerk en laat Windows-firewall alleen het privénetwerk toe.

## Gebruik
0. Kies bovenaan de **locatie** (Vincent of Ine) en het **type** (SUNLU PLA C190, C210, C220, PETG Basic of "Anders, lees het label"). Beide blijven staan bij de volgende rol. Een vast type zet merk, materiaal en nozzletemperatuur vast en koppelt de rol in Bambu aan jouw eigen profiel; Codex hoeft dan alleen de kleur te lezen. De locatie komt alleen in Spoolman.
1. Vul nozzle- en bedtemperatuur één keer in (of tik 190, 210 of 220). Ze blijven staan in je browser tot je ze wijzigt.
2. Neem een foto van het label. Codex leest het label; dat duurt een paar seconden tot een halve minuut.
3. Controleer de velden. **Rood omrand = onzeker of leeg**, daar moet je naar kijken. De kleurcode van een foto is altijd een schatting; pas hem aan met de kleurkiezer als hij niet klopt.
4. Vul bij **Gewicht nu** in wat de rol nu weegt aan filament (zonder spoel). Dit veld is bij elke rol weer leeg. **Volle rol** blijft op 1000 g staan (of het gewicht van het label als dat gelezen wordt). Spoolman krijgt de volle rol in "Weight", het verschil in "gebruikt" en de lege spoel op 0 g.
5. **Opslaan en volgende rol.** Er gaat niets naar Spoolman voordat je daarop tikt.

Bestaat het filament al in Spoolman (zelfde merk, materiaal, naam en kleur), dan wordt dat hergebruikt en komt er alleen een rol bij.

## Wat nog niet bewezen is
- Hoe goed Codex jouw labels leest. Test eerst met een paar rollen en kijk goed naar de rode velden.
- De opdrachtregel van Codex (`codex exec --output-schema ... -i foto -`) hangt af van je Codex-versie. Werkt het niet, pas dan `codexArgs` of `codexBin` aan in de config of stuur de foutmelding door.
- Het is getest met een nagebootste `codex`, niet met de echte.

## Veiligheid
- De bridge-poort 8100 accepteert alleen "rol toevoegen" en de lijst met merken, alleen met het token. Na 5 foute pogingen wordt het afzender-adres een minuut geblokkeerd.
- Het token wordt in de bridge alleen als hash bewaard. Een nieuw token maakt het oude ongeldig.
- De foto wordt tijdelijk op je pc opgeslagen voor Codex en direct daarna verwijderd.

## QR-label na het opslaan
Na "Opslaan en volgende rol" verschijnt onderaan het **QR-label van die rol** (`labelBaseUrl` uit de config, standaard `http://homeassistant.local:3005`, plus `/scan/spool/<id>`). Dat is een pagina van de bridge: sinds bridge 0.9.1 luistert hij ook op host-poort 3005 (SpoolmanSync is daarvoor verplaatst naar poort 3015), zodat al geprinte labels met `:3005` dezelfde wacht-op-rol-pagina openen. Poort 8100 geeft dezelfde pagina. Met **Label afdrukken** print je alleen het label. Het adres klopt alleen op je eigen wifi en als `homeassistant.local` op je telefoon werkt; zo niet, zet dan het vaste IP van je Home Assistant in `labelBaseUrl`.

**Tray koppelen zonder haast (bridge 0.8.0 of nieuwer).** Scan het label met de camera van je telefoon. Kies op de pagina de tray (bijv. Tray 1) en doe daarna de rol in de printer. De bridge kijkt elke 5 seconden of de printer de rol in die tray ziet en koppelt de rol in SpoolmanSync pas als hij 8 seconden onafgebroken zichtbaar is. Zat er al een andere rol in die tray, dan telt die niet: de bridge wacht tot de tray leeg is geweest of een andere rolchip ziet. Zit de rol er al in, dan tik je op "Rol zit er al in: nu koppelen". Na een uur zonder rol vervalt de wachtende koppeling.
Alle labels (ook de eerder geprinte met `:3005`) openen dezelfde wacht-op-rol-pagina.
De QR-generator zit zelf in de map (`qr.mjs`, geen bibliotheek). Het label is bij de bouw uit een echte browser-weergave uitgelezen met OpenCV.

## Direct printen naar de Niimbot D101
Op de pagina staat het onderdeel **Label-printer (Niimbot)**. Met "Direct afdrukken na opslaan" aan, wordt het QR-label automatisch afgedrukt zodra je op "Opslaan en volgende rol" tikt. Je telefoon maakt dan via Bluetooth verbinding met de printer; de pc doet daar niets mee.

**Eenmalig instellen (Android, Chrome)**
1. Zet de rolscanner op `"host": "0.0.0.0"` en geef je pc een vast IP in je router.
2. Chrome staat Bluetooth alleen toe op `https://` of `localhost`. Zet daarom in `chrome://flags` de optie **Insecure origins treated as secure** op *Ingeschakeld*, met `http://<ip-van-je-pc>:8787` in het tekstvak (met `http://` en poort), en start Chrome opnieuw.
3. Sluit de Niimbot-app volledig af; de printer praat met één apparaat tegelijk.
4. Open `http://<ip-van-je-pc>:8787`, tik op **Verbind printer** en kies je D101. Test met **Testlabel**.

**Gebruik**
- Bij de eerste rol na het openen van de pagina verschijnt het keuzemenu voor de printer in dezelfde tik als het opslaan. Daarna blijft de verbinding actief.
- Mislukt het afdrukken of is de printer niet verbonden, dan is de rol al opgeslagen. Tik op **Afdrukken naar Niimbot** om het label opnieuw te sturen.
- Onder "Instellingen label en printer" stel je de **labelmaat** in (standaard 30 x 20 mm: lengte x breedte, breedte maximaal 24 mm), de dichtheid (1-3) en de **print task**. Komt het label blanco of verschoven uit, probeer dan een andere print task (bijv. B1 of D110M_V4), zoals ook NiimBlue adviseert, en tik op Testlabel.

**Wat het label bevat:** een QR-code (3 punten per blokje, 4 blokjes lege rand, alleen zwart en wit), het rolnummer, de naam, het gewicht en de locatie.

**Wat bewezen is en wat niet**
- Getest in Chromium met de echte bibliotheek (label tekenen, omzetten naar 160 x 240 punten voor de printkop, QR uitlezen met OpenCV) en met een nagebootste printer (volgorde van verbinden en afdrukken, annuleren, afdrukfout, testlabel). Zie `tests/browser/printen.browser.cjs`.
- **Niet getest met een echte D101.** Dat de verbinding via de Chrome-vlag werkt, welke print task goed is en of de rotatie klopt, blijkt bij de eerste afdruk. NiimBlue (https://niim.blue) verbond bij de gebruiker wel met de D101.
- De printerbibliotheek is `@mmote/niimbluelib` 0.47.1 (MIT) in `vendor/`.

## Installeren op Windows met één regel
Open **PowerShell** op je pc en plak:

```
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/iRandomPlays/Financi-n.-/ccr-07122be8-fap75g/rolscanner/install-windows.ps1 | iex"
```

Het script (`install-windows.ps1`, lees het eerst als je wilt) controleert Node 20+ en Codex, haalt de map `rolscanner` op in `%USERPROFILE%\rolscanner`, vraagt om het token uit de bridge, maakt `rolscanner.config.json`, test de verbinding met de bridge en maakt `start-rolscanner.bat`. Een bestaande config blijft behouden. Opnieuw uitvoeren werkt de bestanden bij. Het script is niet getest in Windows (er was geen PowerShell beschikbaar bij het schrijven); meld een foutmelding als het vastloopt.
