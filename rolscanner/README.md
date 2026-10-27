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
1. Vul nozzle- en bedtemperatuur één keer in. Ze blijven staan in je browser tot je ze wijzigt.
2. Neem een foto van het label. Codex leest het label; dat duurt een paar seconden tot een halve minuut.
3. Controleer de velden. **Rood omrand = onzeker of leeg**, daar moet je naar kijken. De kleurcode van een foto is altijd een schatting; pas hem aan met de kleurkiezer als hij niet klopt.
4. Vul het gewicht in. Dit veld is bij elke rol weer leeg. Het gewicht van het label staat als hint ernaast.
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
