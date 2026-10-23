# Opdracht: Android-app "Samen Rond" – gedeelde financiën voor een stel

> Dit document is de volledige opdracht om de app te bouwen. Het is zo geschreven dat een ontwikkelaar (of een AI-codeassistent) er zonder verdere vragen mee aan de slag kan. Waar iets niet beschreven staat: kies de eenvoudigste oplossing die past bij de geest van dit document en noteer de keuze in `BESLISSINGEN.md`.

---

## 1. Doel van de app

Een offline Android-app waarmee een stel (de **hoofdpersoon** en de **partner**) bijhoudt:

1. Wat ieder verdient (4-wekelijks of maandelijks loon).
2. Welke vaste lasten er zijn, van wie ze zijn (hoofdpersoon, partner of gezamenlijk) en van welke rekening ze worden betaald.
3. Welke vaste lasten in de huidige loonperiode al betaald zijn (afvinken).
4. Hoeveel ieder nog moet betalen en hoeveel de partner naar de hoofdpersoon moet overmaken (of andersom) voor kosten die voorgeschoten zijn.

De **loonperiode van de hoofdpersoon** is de "betaalmaand" van de app. Zodra een nieuwe loonperiode begint, staan alle vinkjes weer uit.

Alle gegevens worden **alleen lokaal** op het toestel opgeslagen. De app heeft geen internettoegang nodig en vraagt die ook niet aan.

---

## 2. Technische randvoorwaarden

| Onderdeel | Keuze |
|---|---|
| Taal | Kotlin |
| UI | Jetpack Compose + Material 3 (Material You) |
| Architectuur | MVVM + Unidirectional Data Flow (`ViewModel` → `StateFlow<UiState>` → Compose) |
| Lagen | `data` (Room, DataStore, repositories) · `domain` (modellen, rekenlogica, use cases) · `ui` (schermen, componenten, thema) |
| Dependency injection | Hilt |
| Database | Room (met migraties, `exportSchema = true`) |
| Instellingen | Jetpack DataStore (Preferences) |
| Datum/tijd | `java.time` (`LocalDate`, `YearMonth`) |
| Navigatie | Navigation Compose met bottom navigation bar |
| Bedragen | Altijd opslaan als `Long` in **centen**. Nooit `Double`/`Float` voor geld. Rekenen met `BigDecimal` waar percentages gebruikt worden, afronden met `RoundingMode.HALF_UP`. |
| Min SDK / Target SDK | minSdk 26, targetSdk = nieuwste stabiele |
| Taal van de app | Nederlands (strings in `res/values/strings.xml`, zodat vertalen later kan) |
| Valutanotatie | `€ 1.234,56` via `NumberFormat.getCurrencyInstance(Locale("nl", "NL"))` |
| Permissies | Geen `INTERNET`. Optioneel `POST_NOTIFICATIONS` voor herinneringen (fase 3). |
| Tests | JUnit-tests voor alle rekenlogica (zie §10), minimaal één Compose UI-test voor het afvinken. |
| Build | Gradle Kotlin DSL + version catalog (`libs.versions.toml`). Project moet bouwen met `./gradlew assembleDebug` en `./gradlew test`. |

---

## 3. Begrippen

| Begrip | Betekenis |
|---|---|
| **Hoofdpersoon** | De gebruiker van de app. Zijn/haar loonperiode bepaalt de betaalperiode. |
| **Partner** | De tweede persoon. Heeft een eigen loon en eigen loonfrequentie. |
| **Loonfrequentie** | `MAANDELIJKS` of `VIERWEKELIJKS`. |
| **Loonperiode** | De periode vanaf een loondag van de hoofdpersoon tot en met de dag vóór de volgende loondag. |
| **Vaste last** | Een terugkerende uitgave (huur, energie, verzekering, abonnement…). |
| **Eigenaar** | Van wie de last is: `HOOFDPERSOON`, `PARTNER` of `GEZAMENLIJK`. |
| **Verdeling** | Alleen voor gezamenlijke lasten: `50/50`, `NAAR_INKOMEN` (eerlijk percentage) of `AANGEPAST` (zelf percentage kiezen, nice-to-have). |
| **Betaald van rekening** | Van wiens rekening de last daadwerkelijk wordt afgeschreven: `HOOFDPERSOON` of `PARTNER`. |
| **Voorschieten** | Iemand betaalt (een deel van) een last die niet (volledig) van hem/haar is. Bijv. gezamenlijke huur gaat volledig van de rekening van de hoofdpersoon af. Het aandeel van de partner is dan "voorgeschoten" en moet worden overgemaakt. |
| **Verrekening** | Het netto bedrag dat de ene persoon per periode naar de andere moet overmaken. |
| **Aandeel** | Het deel van een last dat écht voor rekening van een persoon komt. |

---

## 4. Functionaliteit

### 4.1 Eerste keer openen (onboarding)

Een korte wizard van 3–4 stappen met een vriendelijke, visuele stijl:

1. **Welkom** – uitleg in 2 zinnen + illustratie.
2. **Hoofdpersoon** – naam, kleur/avatar (emoji of initialen), nettoloon, loonfrequentie, loondag:
   - Maandelijks: dag van de maand (1–31; bestaat de dag niet in een maand, dan geldt de laatste dag van die maand).
   - Vierwekelijks: datum van een (recente of eerstvolgende) loondag. Vanaf die datum telt de app steeds 28 dagen verder of terug.
3. **Partner** – zelfde velden. Optie "Ik heb (nog) geen partner toevoegen" → app werkt dan in éénpersoonsmodus (gezamenlijk/voorschieten verbergen).
4. **Klaar** – knop "Voeg je eerste vaste last toe" of "Naar dashboard".

Alles is achteraf aan te passen in het tabblad **Personen**.

### 4.2 Navigatie

Bottom navigation met 4 tabbladen:

1. **Dashboard** (home)
2. **Vaste lasten**
3. **Personen** (inkomens en loonperiodes)
4. **Meer** (geschiedenis, instellingen, back-up, over)

### 4.3 Personen & inkomen

Per persoon:

- Naam
- Kleur (keuze uit 8 vooraf gedefinieerde, goed contrasterende kleuren) en avatar (emoji of initialen)
- Nettoloon (bedrag)
- Loonfrequentie: `Maandelijks` / `4-wekelijks` (segmented button)
- Loondag (zie onboarding)

Weergave:

- Per persoon een kaart met loon, frequentie, volgende loondag en het **maandequivalent** (zie §5.2), zodat inkomens vergelijkbaar zijn.
- Bovenaan een visuele balk die de inkomensverhouding laat zien (bijv. `57% | 43%`), dit is het percentage dat gebruikt wordt bij "naar inkomen".

Nice-to-have: **afwijkend loon voor deze periode** (bijv. vakantiegeld, overuren). Dit overschrijft het loon alleen voor de huidige periode en wordt in de geschiedenis bewaard.

### 4.4 Vaste lasten (tabblad)

Lijst van alle vaste lasten, gegroepeerd in secties **Gezamenlijk**, **[Naam hoofdpersoon]**, **[Naam partner]**, met per sectie een subtotaal. Bovenaan filterchips (Alles / Gezamenlijk / Hoofdpersoon / Partner) en een zoekveld.

Acties:

- **Toevoegen** via een Floating Action Button → formulier (volledig scherm of bottom sheet).
- **Bewerken** door op een last te tikken.
- **Verwijderen** via swipe-naar-links of via het formulier, met een *Ongedaan maken*-snackbar.
- **Pauzeren** (actief/inactief schakelaar): inactieve lasten tellen nergens mee maar blijven bewaard.
- Volgorde aanpassen met slepen (nice-to-have).

#### Velden van een vaste last

| Veld | Type | Verplicht | Toelichting |
|---|---|---|---|
| Naam | tekst | ja | bijv. "Huur" |
| Bedrag | bedrag | ja | > 0 |
| Categorie + icoon | keuze | ja | Wonen, Energie, Verzekeringen, Abonnementen, Vervoer, Zorg, Kinderen, Leningen, Sparen, Overig. Elk met een eigen Material-icoon en kleur. |
| Eigenaar | keuze | ja | Hoofdpersoon / Partner / Gezamenlijk (segmented button met namen en kleuren van de personen) |
| Verdeling | keuze | alleen bij Gezamenlijk | 50/50 · Naar inkomen · (Aangepast %) – direct eronder een live voorbeeld: "Jan betaalt € 685,71 · Lisa betaalt € 514,29" |
| Betaald van rekening | keuze | ja | Hoofdpersoon / Partner. Standaard: de eigenaar; bij gezamenlijk: hoofdpersoon. Als dit niet de eigenaar is, toon een duidelijke infotekst: "Jan schiet € 514,29 voor Lisa voor." |
| Datumtype | keuze | ja | **Vaste datum** of **Variabele datum (± 3 dagen)** |
| Dag van de maand | 1–31 | ja | Bestaat de dag niet in een maand → laatste dag van de maand. |
| Frequentie | keuze | ja | Maandelijks (standaard). Nice-to-have: per kwartaal, per jaar (met startmaand). |
| Notitie | tekst | nee | bijv. IBAN of klantnummer |
| Actief | schakelaar | ja | standaard aan |

**Datumtype is puur informatief.** Bij een variabele datum toont de app het bereik, bijv. "± 15 okt (12–18 okt)". Het beïnvloedt geen berekeningen, alleen de weergave en de status "binnenkort/te laat" (bij variabel geldt pas "te laat" na de laatste dag van het bereik).

Validatie: duidelijke foutmeldingen onder de velden; de opslaan-knop is pas actief als alles geldig is.

### 4.5 Dashboard (hoofdscherm)

Van boven naar beneden:

#### a. Periodekop
- "Periode 3 okt – 30 okt" + "nog 12 dagen" + een voortgangsbalk door de periode.
- Pijltjes ◀ ▶ om naar vorige periodes te bladeren (alleen-lezen weergave van de geschiedenis; terugkeren naar "Nu" met één tik). Vinkjes in afgelopen periodes zijn wel aan te passen (voor als je achteraf iets vergeten bent), toekomstige periodes niet.

#### b. Totaaloverzicht
- Een **ring/donut** met het percentage betaald (bedrag), in het midden "€ 1.120 van € 1.550 betaald".
- Daaronder: "Nog te betalen: € 430,00".

#### c. Personenkaarten (horizontaal naast elkaar of onder elkaar)
Per persoon, in de eigen kleur:

- Naam + avatar
- Inkomen deze periode
- **Nog te betalen** (groot en prominent): som van de nog niet afgevinkte lasten die van zijn/haar rekening gaan.
- Betaald / totaal van eigen rekening, met kleine voortgangsbalk.
- **Vrij besteedbaar** = inkomen − eigen aandeel in de lasten ± verrekening (zie §5).

Bij de **hoofdpersoon** moet duidelijk zichtbaar zijn wat de lasten zijn **met** en **zonder** de kosten van de partner:

```
Jan
Van mijn rekening      € 1.465,00   (incl. kosten voor Lisa)
Mijn eigen lasten      €   828,21   (excl. kosten voor Lisa)
Voorgeschoten voor Lisa € 636,79
```

Een kleine schakelaar of uitklapbare sectie "Toon met/zonder kosten partner" laat de bedragen en de lijst daarop meeschakelen. Hetzelfde geldt omgekeerd als de partner iets voorschiet voor de hoofdpersoon.

#### d. Verrekeningskaart
Alleen zichtbaar als er iets te verrekenen is:

> 💸 **Lisa maakt € 636,79 over naar Jan**
> ☐ Ontvangen

- Uitklapbaar met de specificatie per last (bijv. "Huur – aandeel Lisa € 514,29", "Energie – aandeel Lisa € 90,00", "Internet – door Lisa betaald, aandeel Jan − € 27,50").
- De verrekening kan worden afgevinkt, net als een last. Ook dit vinkje reset per periode.
- Instelling (in **Meer**): "Bedragen netto verrekenen" (standaard aan). Uit = toon beide richtingen apart.

#### e. Lijst vaste lasten van deze periode
- Filterchips: Alles / Gezamenlijk / [Hoofdpersoon] / [Partner] / Openstaand.
- Sortering standaard op datum; optioneel gegroepeerd per eigenaar.
- Elke rij toont:
  - Categorie-icoon in een gekleurde cirkel
  - Naam
  - Datum ("15 okt" of "± 15 okt")
  - Eigenaarlabel (chip in de kleur van de persoon, of tweekleurige chip "Samen")
  - Bij gezamenlijk: verdeling in klein ("57/43 naar inkomen")
  - Bij voorschieten: klein label "betaald door Jan"
  - Bedrag
  - **Checkbox** (grote, makkelijk aantikbare checkbox, met fijne animatie)
- Status-kleuren:
  - Betaald: doorgestreept/gedimd + groen vinkje
  - Binnenkort (binnen 3 dagen): oranje accent
  - Te laat (datum voorbij, niet afgevinkt): rood accent + "x dagen te laat"
- Afvinken kan ook met swipe-naar-rechts. Ongedaan maken via snackbar.
- Lege staat met illustratie: "Nog geen vaste lasten – voeg je eerste toe".

### 4.6 Reset per loonperiode

- Vinkjes worden **niet** gewist, maar opgeslagen **per periode** (sleutel = startdatum van de periode). Een nieuwe periode heeft simpelweg nog geen vinkjes → het voelt als een reset, en de geschiedenis blijft bewaard.
- De huidige periode wordt bij elke start van de app en bij het hervatten (`ON_RESUME`) opnieuw bepaald, en ook rond middernacht als de app open staat.
- Bij het begin van een nieuwe periode toont het dashboard eenmalig een banner: "Nieuwe periode gestart 🎉 Alle vinkjes staan weer uit." Optioneel met een samenvatting van de vorige periode (bijv. "Vorige periode: alles betaald" of "2 lasten niet afgevinkt").
- Wijzigt de gebruiker de loondag/-frequentie van de hoofdpersoon, dan worden periodes opnieuw berekend. Toon vooraf een waarschuwing dat vinkjes van de huidige periode daardoor kunnen verdwijnen uit de weergave (ze blijven wel in de database).

### 4.7 Geschiedenis (onder Meer)

- Lijst van afgelopen periodes met: totaal lasten, betaald, verrekening ontvangen ja/nee.
- Tik op een periode → hetzelfde dashboard maar voor die periode.
- Nice-to-have: grafiek van de totale lasten per periode (staafdiagram) en een donut per categorie.

### 4.8 Instellingen (onder Meer)

- Thema: Systeem / Licht / Donker
- Dynamische kleuren (Material You) aan/uit
- Bedragen netto verrekenen aan/uit
- Weergave lasten bij 4-wekelijkse periode: "Alleen lasten met een datum in deze periode" (standaard) / "Altijd alle maandlasten tonen" (zie §5.4)
- Herinneringen aan/uit (fase 3): melding op de dag dat een last vervalt en nog niet is afgevinkt
- **Back-up**: exporteren naar en importeren uit een JSON-bestand via het Android-bestandskiezer (Storage Access Framework). Geen cloud.
- Alle gegevens wissen (met dubbele bevestiging)
- Over de app (versie)

---

## 5. Rekenregels (belangrijk – exact zo implementeren)

Alle rekenlogica komt in pure Kotlin-klassen in de `domain`-laag, zonder Android-afhankelijkheden, zodat ze volledig unit-testbaar zijn.

### 5.1 Loonperiode bepalen (`PeriodCalculator`)

Input: loonfrequentie en loondag van de hoofdpersoon, en een datum `vandaag`.

- **Maandelijks** met loondag `d`:
  - Loondag in een maand = `min(d, lengte van die maand)`.
  - Periode = van de laatste loondag ≤ vandaag t/m de dag vóór de volgende loondag.
  - Voorbeeld: loondag 24 → periode 24 okt t/m 23 nov.
- **Vierwekelijks** met ankerdatum `a`:
  - `n = floor((vandaag − a) in dagen / 28)` (werkt ook voor datums vóór het anker).
  - Start = `a + n × 28` dagen, eind = start + 27 dagen.

Periodes worden niet opgeslagen maar berekend; de startdatum dient als periodesleutel.

### 5.2 Inkomen vergelijkbaar maken

Voor de inkomensverhouding worden beide inkomens omgerekend naar een **maandequivalent**:

- Maandelijks: `maandequivalent = loon`
- Vierwekelijks: `maandequivalent = loon × 13 / 12`

Het **inkomen dat op het dashboard in een periode getoond wordt** is het loon dat de persoon in die periode ontvangt, omgerekend naar de periodelengte van de hoofdpersoon:

- Zelfde frequentie als hoofdpersoon → het loon zelf.
- Hoofdpersoon maandelijks, partner 4-wekelijks → `loon partner × 13 / 12`.
- Hoofdpersoon 4-wekelijks, partner maandelijks → `loon partner × 12 / 13`.

### 5.3 Aandeel per last

Voor elke actieve last die in de periode valt:

| Eigenaar | Aandeel hoofdpersoon | Aandeel partner |
|---|---|---|
| Hoofdpersoon | 100% | 0% |
| Partner | 0% | 100% |
| Gezamenlijk, 50/50 | 50% | 50% |
| Gezamenlijk, naar inkomen | `maandeq. H / (maandeq. H + maandeq. P)` | de rest |
| Gezamenlijk, aangepast | ingesteld % | de rest |

- Bereken het aandeel van de hoofdpersoon in centen met `HALF_UP`, het aandeel van de partner = bedrag − aandeel hoofdpersoon. Zo klopt de som altijd tot op de cent.
- Zijn beide inkomens 0, val dan terug op 50/50 en toon een waarschuwing bij de last.
- Het percentage "naar inkomen" wordt berekend op basis van de inkomens die gelden in de betreffende periode (inclusief eventueel afwijkend loon).

### 5.4 Welke lasten vallen in een periode?

- Bij een **maandelijkse** periode valt elke maandelijkse last er precies één keer in. De getoonde datum is de concrete datum binnen de periode (bijv. loondag 24, last op de 1e → "1 nov").
- Bij een **vierwekelijkse** periode (28 dagen) valt een maandelijkse last er 0 of 1 keer in (13 periodes per jaar, 12 betalingen).
  - Standaard: toon alleen lasten met een vervaldatum binnen de periode. Lasten die deze periode niet vallen, worden onderaan getoond in een ingeklapte sectie "Valt niet in deze periode" en tellen niet mee.
  - Instelling "Altijd alle maandlasten tonen": elke maandlast verschijnt elke periode (eenvoudiger, maar ca. 1× per jaar te veel gerekend). Leg dit in de instelling kort uit.
- Kwartaal/jaar-lasten (nice-to-have) tellen alleen in de periode waarin hun vervaldatum valt.

### 5.5 Afschrijvingen, voorschieten en verrekening

Per periode, per persoon X:

- **Van rekening X** = som van bedragen van lasten met "betaald van rekening" = X.
- **Eigen aandeel X** = som van de aandelen van X in alle lasten.
- **Voorgeschoten door X** = som van de aandelen van de ander in lasten die van rekening X gaan.
- **Nog te betalen X** = som van bedragen van niet-afgevinkte lasten van rekening X.

Verrekening:

```
partner_moet_aan_hoofdpersoon  = voorgeschoten door hoofdpersoon
hoofdpersoon_moet_aan_partner  = voorgeschoten door partner
netto = partner_moet_aan_hoofdpersoon − hoofdpersoon_moet_aan_partner
  netto > 0 → partner maakt `netto` over naar hoofdpersoon
  netto < 0 → hoofdpersoon maakt `|netto|` over naar partner
  netto = 0 → geen verrekeningskaart
```

Controle (moet altijd kloppen, ook als unit-test): `Van rekening X − ontvangen verrekening + betaalde verrekening = Eigen aandeel X`.

**Vrij besteedbaar X** = inkomen X in deze periode − eigen aandeel X.

### 5.6 Rekenvoorbeeld (gebruik dit als unit-test)

**Personen**
- Jan (hoofdpersoon): € 2.400 per 4 weken → maandequivalent € 2.600,00
- Lisa (partner): € 1.950 per maand → maandequivalent € 1.950,00
- Verhouding naar inkomen: Jan 2600/4550 = **57,14%**, Lisa **42,86%**

**Vaste lasten** (allemaal in deze periode)

| Last | Bedrag | Eigenaar | Verdeling | Van rekening | Aandeel Jan | Aandeel Lisa |
|---|---|---|---|---|---|---|
| Huur | 1.200,00 | Gezamenlijk | Naar inkomen | Jan | 685,71 | 514,29 |
| Energie | 180,00 | Gezamenlijk | 50/50 | Jan | 90,00 | 90,00 |
| Internet | 55,00 | Gezamenlijk | 50/50 | Lisa | 27,50 | 27,50 |
| Telefoon Jan | 25,00 | Jan | – | Jan | 25,00 | 0,00 |
| Autoverzekering Lisa | 60,00 | Lisa | – | Jan | 0,00 | 60,00 |
| Sportschool Lisa | 30,00 | Lisa | – | Lisa | 0,00 | 30,00 |

**Uitkomsten**

| | Jan | Lisa |
|---|---|---|
| Van eigen rekening (incl. kosten ander) | € 1.465,00 | € 85,00 |
| Eigen aandeel (excl. kosten ander) | € 828,21 | € 721,79 |
| Voorgeschoten voor de ander | € 664,29 | € 27,50 |
| Inkomen deze periode | € 2.400,00 | € 1.800,00 (1950 × 12/13) |
| Vrij besteedbaar | € 1.571,79 | € 1.078,21 |

**Verrekening:** 664,29 − 27,50 = **Lisa maakt € 636,79 over naar Jan.**

Controle Jan: 1.465,00 − 636,79 = 828,21 ✔ · Controle Lisa: 85,00 + 636,79 = 721,79 ✔

---

## 6. Datamodel (Room)

```kotlin
enum class PersonRole { MAIN, PARTNER }
enum class PayFrequency { MONTHLY, FOUR_WEEKLY }
enum class ExpenseOwner { MAIN, PARTNER, SHARED }
enum class SplitMethod { EQUAL, INCOME_RATIO, CUSTOM }
enum class DateType { FIXED, VARIABLE }          // VARIABLE = ± 3 dagen, alleen info
enum class ExpenseFrequency { MONTHLY, QUARTERLY, YEARLY }

@Entity
data class PersonEntity(
    @PrimaryKey val role: PersonRole,
    val name: String,
    val colorIndex: Int,
    val avatar: String,              // emoji of initialen
    val incomeCents: Long,
    val payFrequency: PayFrequency,
    val monthlyPayDay: Int?,         // 1..31, bij MONTHLY
    val fourWeeklyAnchor: LocalDate?,// bij FOUR_WEEKLY
    val enabled: Boolean = true      // false = éénpersoonsmodus (alleen PARTNER)
)

@Entity
data class ExpenseEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val amountCents: Long,
    val category: String,
    val owner: ExpenseOwner,
    val splitMethod: SplitMethod?,   // alleen bij SHARED
    val customMainPercent: Int?,     // alleen bij CUSTOM, 0..100
    val paidFrom: PersonRole,
    val dateType: DateType,
    val dayOfMonth: Int,             // 1..31
    val frequency: ExpenseFrequency = ExpenseFrequency.MONTHLY,
    val startMonth: Int? = null,     // voor kwartaal/jaar
    val note: String? = null,
    val active: Boolean = true,
    val sortOrder: Int = 0,
    val createdAt: Instant,
    val deletedAt: Instant? = null   // soft delete, voor geschiedenis + undo
)

@Entity(primaryKeys = ["expenseId", "periodStart"])
data class PaymentEntity(
    val expenseId: Long,
    val periodStart: LocalDate,
    val paidAt: Instant,
    val amountCentsSnapshot: Long,   // bedrag op moment van afvinken
    val mainShareCentsSnapshot: Long
)

@Entity(primaryKeys = ["periodStart"])
data class SettlementEntity(
    val periodStart: LocalDate,
    val fromRole: PersonRole,
    val toRole: PersonRole,
    val amountCentsSnapshot: Long,
    val settledAt: Instant
)

@Entity(primaryKeys = ["role", "periodStart"])
data class IncomeOverrideEntity(     // nice-to-have: afwijkend loon
    val role: PersonRole,
    val periodStart: LocalDate,
    val incomeCents: Long
)
```

Opmerkingen:
- `LocalDate`/`Instant` via Room `TypeConverters`.
- Verwijderen = soft delete (`deletedAt`), zodat de geschiedenis van eerdere periodes klopt. Verwijderde lasten verschijnen niet meer in huidige/toekomstige periodes.
- Wijzigingen aan een last gelden voor de huidige en toekomstige periodes. Afgevinkte lasten in eerdere periodes tonen hun snapshot-bedrag.

---

## 7. Projectstructuur (indicatie)

```
app/src/main/java/nl/samenrond/
├── SamenRondApp.kt                 (@HiltAndroidApp)
├── MainActivity.kt
├── data/
│   ├── db/ (AppDatabase, DAO's, entities, converters)
│   ├── prefs/ (SettingsDataStore)
│   ├── backup/ (JSON export/import, kotlinx.serialization)
│   └── repository/ (PersonRepository, ExpenseRepository, PaymentRepository)
├── domain/
│   ├── model/ (Person, Expense, Period, PeriodSummary, PersonSummary, Settlement)
│   ├── calc/ (PeriodCalculator, IncomeNormalizer, ShareCalculator, SettlementCalculator, DueDateCalculator)
│   └── usecase/ (GetDashboardUseCase, TogglePaymentUseCase, …)
└── ui/
    ├── theme/ (Color, Type, Shape, Theme)
    ├── components/ (MoneyText, PersonChip, ExpenseRow, ProgressRing, AnimatedCheckbox, …)
    ├── onboarding/
    ├── dashboard/
    ├── expenses/ (lijst + formulier)
    ├── persons/
    └── more/ (geschiedenis, instellingen)
app/src/test/…    (unit-tests rekenlogica)
app/src/androidTest/… (Compose UI-test)
```

---

## 8. Visueel ontwerp

De app moet er **modern, rustig en aantrekkelijk** uitzien – het moet prettig voelen om je financiën bij te houden.

- **Material 3** met een eigen kleurenschema (bijv. diep blauwgroen als primaire kleur, warm koraal als accent) en ondersteuning voor dynamische kleuren.
- **Licht én donker thema**, beide goed uitgewerkt.
- **Persoonskleuren** lopen consequent door de hele app: personenkaarten, chips, verdelingsbalken, grafieken. Gezamenlijke lasten krijgen een tweekleurig verloop van beide persoonskleuren.
- **Kaarten** met afgeronde hoeken (24 dp), subtiele elevation, ruime padding (16–24 dp).
- **Typografie**: groot en vet voor bedragen (bijv. `displaySmall` voor "Nog te betalen"), tabulaire cijfers zodat bedragen netjes onder elkaar staan.
- **Animaties**:
  - Checkbox met schaal-/vink-animatie en lichte haptische feedback bij afvinken.
  - Voortgangsring en bedragen animeren naar de nieuwe waarde (`animateFloatAsState`, tellende cijfers).
  - Rijen schuiven soepel bij filteren (`animateItem` in `LazyColumn`).
  - Kleine confetti-/sparkle-animatie wanneer alle lasten van de periode betaald zijn ("Alles betaald! 🎉").
- **Iconen**: Material Symbols (rounded) per categorie, in een gekleurde cirkel.
- **Lege staten** met een vriendelijke illustratie (vector) en duidelijke actieknop.
- **Edge-to-edge** weergave, correcte omgang met system bars.
- **Toegankelijkheid**: contrast minimaal WCAG AA, `contentDescription` op iconen, tappable areas ≥ 48 dp, ondersteunt grote lettergrootte zonder afgekapte tekst. Status nooit alléén via kleur communiceren (ook icoon/tekst).
- Lever bij oplevering **screenshots** van dashboard, vaste-lastenlijst, formulier en personen-scherm in licht en donker thema (in `docs/screenshots/`).

---

## 9. Fasering

**Fase 1 – Basis (MVP)**
- Projectopzet, thema, navigatie
- Onboarding
- Personen & inkomen
- Vaste lasten toevoegen / bewerken / verwijderen (maandelijks, vaste/variabele datum)
- Dashboard met periode, personenkaarten, lijst en afvinken
- Reset per periode
- Alle rekenregels uit §5 + unit-tests

**Fase 2 – Gezamenlijk & voorschieten afgerond**
- Verrekeningskaart met specificatie en afvinken
- Met/zonder kosten partner-weergave
- Geschiedenis en terugbladeren
- Back-up export/import
- Nieuwe-periode-banner

**Fase 3 – Extra's (nice-to-have)**
- Herinneringen via WorkManager
- Kwartaal- en jaarlasten
- Aangepast verdelingspercentage
- Afwijkend loon per periode
- Grafieken per categorie en per periode
- Home-screen widget (Glance) met "nog te betalen"

---

## 10. Testen en acceptatiecriteria

### Unit-tests (verplicht)
1. `PeriodCalculator`: maandelijks (loondag 31 in februari, schrikkeljaar, jaarovergang), vierwekelijks (datum vóór anker, precies op loondag, dag vóór loondag).
2. `IncomeNormalizer`: alle vier combinaties van frequenties.
3. `ShareCalculator`: 50/50 met oneven centen (bijv. € 0,01 → 1/0), naar inkomen, beide inkomens 0, som altijd gelijk aan bedrag.
4. `SettlementCalculator`: het rekenvoorbeeld uit §5.6 exact, netto positief/negatief/nul.
5. `DueDateCalculator`: last op de 31e in een maand van 30 dagen; 4-wekelijkse periode zonder vervaldatum van een last; variabel bereik over de maandgrens.

### Acceptatiecriteria
- [ ] Ik kan mijn loon en dat van mijn partner invullen en per persoon kiezen tussen 4-wekelijks en maandelijks.
- [ ] Mijn vaste lasten staan op het dashboard en ik kan ze afvinken; het vinkje blijft bewaard na herstarten van de app.
- [ ] Er is een apart tabblad Vaste lasten waar ik lasten kan toevoegen, bewerken en verwijderen.
- [ ] Per last kies ik een vaste datum of een variabele datum (± 3 dagen); dit wordt alleen als info getoond.
- [ ] Zodra een nieuwe loonperiode van de hoofdpersoon begint, staan alle vinkjes uit; vorige periodes zijn terug te zien.
- [ ] Op het dashboard zie ik per persoon hoeveel hij/zij nog moet betalen.
- [ ] Op het dashboard zie ik per last van wie hij is en welke gezamenlijk zijn.
- [ ] Bij gezamenlijke lasten kies ik 50/50 of naar inkomen; het percentage naar inkomen wordt automatisch en correct berekend.
- [ ] Ik kan aangeven van wiens rekening een last betaald wordt (voorschieten), en zie hoeveel mijn partner naar mij moet overmaken.
- [ ] Ik zie voor de hoofdpersoon duidelijk de vaste lasten **met** en **zonder** de kosten van de partner.
- [ ] De app werkt volledig offline en vraagt geen internetpermissie.
- [ ] Licht en donker thema zien er verzorgd uit; de app voelt visueel aantrekkelijk.
- [ ] `./gradlew test` slaagt; het rekenvoorbeeld uit §5.6 geeft exact de genoemde bedragen.

---

## 11. Op te leveren

1. Volledig Android Studio-project in deze repository, buildbaar met `./gradlew assembleDebug`.
2. Alle unit-tests uit §10 groen.
3. `README.md` met: korte beschrijving, screenshots, hoe te bouwen, uitleg van de rekenregels in gewone taal.
4. `BESLISSINGEN.md` met gemaakte keuzes die niet in deze opdracht stonden.
5. Een debug-APK als release-asset of in `docs/` (optioneel).
