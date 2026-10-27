# Spoolman Bambu Bridge

Leest de rollenvoorraad uit Spoolman en zet de resterende grammen in Bambu's eigen Filament Manager.
De bridge boekt **geen** printverbruik af; dat doet SpoolmanSync. Hij leest geen printer-G-code en bedient de printer niet.

## Installeren
1. Kopieer de map `spoolman_bambu_bridge` naar `/addons/spoolman_bambu_bridge` op de Home Assistant-host (Samba- of SSH-add-on).
2. Instellingen → Add-ons → Add-on store → ⋮ → Opnieuw laden. Onder *Lokale add-ons* verschijnt de bridge; installeer en start hem.
3. Open "Bambu Bridge" in de zijbalk.
4. Vul de Spoolman-URL in. De Spoolman-Ingress-add-on heeft geen eigen externe poort; gebruik `http://2c829f0e-spoolman-ingress:7912` (getest, werkt vanuit de bridge). Lukt dat niet, installeer dan de niet-Ingress-variant van Spoolman of open de poort.
5. Log in bij Bambu (met verificatiecode indien gevraagd). Het wachtwoord wordt niet opgeslagen, alleen het token.
6. "Rollen laden", koppel één rol, klik "Nu synchroniseren". Zet pas daarna automatisch synchroniseren aan.

## Werking
- Spoolman is leidend. Per ronde: doelgewicht = Spoolman-resterend, afgerond op hele grammen; alleen schrijven als Bambu afwijkt.
- Rollen met onbekend gewicht of een gearchiveerde bronrol worden zichtbaar gepauzeerd (nooit 0 g). Verwijder je een rol in Spoolman, dan verwijdert de bridge ook de gekoppelde Bambu-rol en vervalt de koppeling (alleen rollen die de bridge zelf koppelde; niet terug te draaien). Is de hele Spoolman-lijst leeg, dan wordt er niets ontkoppeld maar gepauzeerd.
- Handmatig ontkoppelen verwijdert geen rol. Een ronde draait nooit dubbel; mislukte updates gaan de volgende ronde opnieuw met de nieuwste stand.
- Een aangemaakte Bambu-rol krijgt `[spoolman:ID]` in de notitie. Na een onzekere netwerkreactie wordt daarop gezocht in plaats van opnieuw aan te maken.

- Optioneel (instelling): een nieuwe Spoolman-rol met bekend gewicht wordt automatisch in Bambu aangemaakt en gekoppeld. Bestaat dezelfde rol al los in Bambu, dan ontstaat er een tweede; koppel die dan handmatig vóór je de rol in Spoolman toevoegt.

## Back-up en herstel
- Gegevens staan in `/data/state.json` en zitten in de normale Home Assistant-back-up van de add-on.
- Update: vervang de map, laad de store opnieuw, werk de add-on bij; `/data` blijft behouden.
- Herstel: back-up terugzetten, add-on starten. Controleer na een nieuwe Spoolman-database of -account de koppelingen vóór je automatisch synchroniseren aanzet (ontbrekende rollen worden gepauzeerd).

## Sensoren in Home Assistant
Elke ronde publiceert de bridge: `sensor.spoolman_rol_<id>` (resterende grammen met merk, materiaal, kleur, tray, sync-status), `sensor.spoolman_voorraad` (totaal, aantal lage rollen, lijst `rollen`) en `sensor.spoolman_bridge_status` (ok / pauze / fout / niet_ingelogd). Het zijn alleen-lezen sensoren zonder registratie; na een herstart van Home Assistant verschijnen ze bij de volgende ronde weer (maximaal één interval). Bij een Spoolman-storing worden alleen de status bijgewerkt en geen rolsensoren verwijderd.
