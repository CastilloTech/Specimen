# Specimen (working title) — playable rules prototype

A 2D digital prototype of a two-player card game where both players control the **same creature**. Built for playtesting the core rules, not for polish.

```
npm install
npm run dev          # play at http://localhost:5173
npm test             # 222 unit tests
npm run sim -- --matches 1000
```

TypeScript, React, Vite, Tailwind. No backend. Node 20+.

> Tip: the project sits in a OneDrive folder. `node_modules` has thousands of files; if syncing is slow, pause OneDrive or move the folder.

## Modes

| Mode | What it does |
|---|---|
| **Vs Bot** | You are Player 1. The bot plays grafts while staying 2 below the Rejection threshold, uses Toxins when you are at 7+ Strain, and weights its stance toward countering your last stance. |
| **Hotseat** | Two players, one device. A "pass the device" screen appears before **every** private decision (mulligan, stance, each action, each reaction). While it shows, the hand is not even in the page. |
| **Decks & Chips** | Build a 20-card deck (live validation, a Build's own cards + your chosen World Faction's cards + up to 4 tech) and pick a Chip loadout (one node per row). Saved in `localStorage`, usable in match setup. |
| **Settings** | Timers, Cycling, Dormant, Neural links, Energy banking, Stance momentum. |

**Two independent axes, not one pick.** A Specimen is built from a **Build** (Predator / Parasite / Bastion — unchanged since the prototype's start) and a **World Faction** (Corrosion / Aegis / Miasma / Hollow — new), and the two answer completely different questions:
- **Build** governs your relationship with **Strain**: it decides your card pool, and your two possible evolutions. It carries no skill tree of its own any more (see the Eleventh pass).
- **World Faction** governs your relationship with **graft Integrity and the four status effects** (Bleed, Necrosis, Numb, Fever) — an axis deliberately orthogonal to Strain, so a Predator/Corrosion Specimen and a Bastion/Corrosion Specimen play very differently even though they share a World Faction, and a Predator/Corrosion Specimen and a Predator/Aegis Specimen play very differently even though they share a Build. It brings its own ~10-card pool (min 8 copies in a legal deck) and offers exactly **3 Chips** to choose from.
- A **Chip** is the loadout item you actually equip: pick one of your World Faction's 3 Chips before a match, and it carries a **2-row x 2-node skill tree** (4 unique nodes, one pick per row) — this is the only place node-picking happens now. Any Build pairs with any World Faction (12 combinations total), and each Chip's tree is independent of both.

**Layout.** On a phone (portrait) the match is one stacked column. On desktop (window at least 1024 px wide) it becomes a single-screen board: your panel, the two Specimens facing each other, and the opponent's panel on one row; your hand next to the selected-card detail and the Pass / Hold / Cycle buttons underneath; the match log in a fixed column on the right. It fits without page scrolling at 1280×720, 1366×768 and 1920×1080 in every phase (mulligan, stance, actions, reaction, evolution choice).

**Seeing what the opponent played.** Three layers, all built from the engine's public play history (`state.plays`):
- When the opponent plays, a compact stack of cards drops in on **their side of the arena** (left for you, right for them — it follows whoever played it) for about 5 seconds, narrow rather than a big banner across the board (in hotseat it shows as soon as the next player taps in). Each row already states the card's own effect text, so what it did is obvious without opening it; tap a row for the full card, or tap the header to dismiss the whole stack. The panel lets clicks through everywhere except its own rows, so you can still target enemy slots under it.
- A **"Played this round"** strip under the Specimens keeps every card of the current round as a chip (player, name, where it went or what it targeted, "negated" if it was), newest highlighted.
- The **Plays** button in the header opens the whole match grouped by round; tap any chip to see the card.

Privacy is enforced in one place (`publicPlay`): a face-down graft played by the opponent shows only as "Face-down graft -> Head" until it is woken, forced awake, ejected or negated, and a **cycled** card is never named. Reactions (Protocols, Pressure Valve) appear like any other play.

**Face-down grafts are asleep.** Tick "Face-down" when you place a graft. While it is face-down it is **asleep**:

- it gives **no attack, no armor and no text** (passives, triggers and node bonuses all off), so it cannot leak through the ATK / ARM readout either;
- it adds **1 less Strain** now (`dormant.quietStrain`); the saved Strain is added when it wakes;
- the opponent sees only its slot and that Strain.

It wakes when you choose (the **Wake** button on the graft, a free action that uses your turn), or when the opponent forces it: **Scanner Probe** or any **Sabotage** that targets it wakes it against your will (and you pay its saved Strain). A graft you wake yourself after it has **slept through at least one round** also gives an **Ambush** for that round, and the Ambush depends on the faction (`dormant.ambush`): **Predator +5 attack**; **Parasite +2 attack and the opponent gains 1 Strain**; **Bastion +1 attack, +4 armor and heals 1**. Waking the same round you played it gives no Ambush, and a forced wake never does. An ejected sleeping graft leaves with only the Strain it had added.

So it is a real choice: you give up a graft's stats for a round or more, in exchange for Strain relief, a hidden card the opponent has to respect (or spend a Scanner / Sabotage on), and a burst when you flip it. It pays most for **cheap grafts** (cost 2 or less), because a sleeping cheap graft gives up little while it waits; see the Seventh pass for the measurements per faction.

**Evolution is announced, and you can turn it down.** Meeting a form's condition never evolves you automatically: it always offers a choice, **evolve now or hold off** (the same or a newly-met condition is offered again at the next Strain check, so declining is never a dead end — it is "not yet", not "no"). Evolving is permanent and irreversible, so this matters: you might want to wait for the other, possibly better, form to also become available before you commit. When either Specimen evolves, a banner drops in for both players: who evolved, the form's name, the condition that was met, and every boost as a plain-language line ("+2 attack", "Your attacks ignore Fortify's damage halving", ...) — the numbers are fixed per Build, since no Chip node touches them. It stays about 14 seconds or until dismissed, and it lets clicks through to the board underneath except for its own dismiss button (so it never blocks play while it is up). Afterwards the evolved player's panel shows a glowing "★ form · boosts" badge instead of the progress bars, and the ATK / ARM chips get a ▲ when part of the number is the form's bonus. Before the match, the loadout screen lists both players' two possible forms with what each needs and gives, and the "choose your form" prompt shows the boosts of each option plus a "Hold off" button. The bot always accepts the first form it becomes eligible for and never declines.

**Quality of life.**
- **Help sheet** (`?` button or the `?` key): stances, Strain zones, Energy and draws, replacement, face-down and the shortcut list, all read from the live config so the numbers are right.
- **Keyboard shortcuts** (Settings toggle): `A` / `D` / `F` (or `1`-`3`) pick a stance, `K` / `M` keep / mulligan, `1`-`9` select a card, `P` pass, `H` hold, `C` cycle, `W` wake a sleeping graft, `N` no response, `Esc` cancel.
- **Confirm before passing** (Settings toggle, on by default): if you can still afford and play a card, Pass asks first ("Pass anyway" / "Keep playing"). When you truly have nothing to play the Pass button pulses and says so.
- **Round recap** while you pick the next stance: HP and Strain change for both sides last round.
- **Recent stances** of each player (public once revealed) as chips on their panel, so counter-picking is not a memory test.
- **Replace grafts** (Settings toggle): with a graft card selected, occupied slots glow too and say what they cost.
- The stance buttons and their descriptions read the current numbers from `config.json`.

**Hold matters.** Declaring Hold gives up your own Clash damage this round — nothing else changes, you can still play cards and cycle on later turns that round — in exchange for **+`strain.holdArmor` armor** (which reduces what you take too, since armor is part of the round's Clash math either way) and venting **`strain.holdVent` Strain** immediately, on top of whatever a node like Heat Sink adds. Your panel shows a HOLD badge and the boosted ARM number while it is active. See the Eighth pass for the numbers and how often the bot actually uses it now.

Timers: **10 s per stance** (it is a coin-flip-feeling pick between three options, not a card-reading exercise); **90 s for the opening keep/mulligan decision** (it does not draw on your reserve, and running out keeps your hand); **30 s per other action** (up from 20 s, so there is real time to look over the board and plan once both stances are revealed) plus a 30 s reserve bank per player per match. Running out passes / auto-picks (and the auto-action is logged like any other action, so replays stay exact; a timed-out evolution choice evolves into the first offered form rather than holding off). Turn timers off in Settings.

The post-match screen has HP and Strain line charts (hover, or "show as table"), key events, and **Export match log (JSON)**. The export contains the setup, seed and every action, so it can be replayed exactly:

```ts
import { replay } from './src/engine';
const state = replay(log.setup, log.actions); // log = the exported JSON, parsed
```

## Project layout

```
src/engine/    pure TypeScript rules engine: no UI imports, no Math.random, no clocks
  reducer.ts   reduce(state, action) -> newState (immer), validateAction, legalPlays, pendingPlayers
  rules.ts     op executor, round flow, clash, strain check, evolution
  stats.ts     read-only helpers: zones, attack/armor, costs, evolution progress
  bot.ts       heuristic bot         runner.ts   playBotMatch / replay
  rng.ts       seeded mulberry32 (the RNG state lives in the game state)
  budget.ts    card power-budget estimator
src/data/      config.json, cards.json, chips.json, decks.json   <- everything tunable
src/ui/        React screens and components
scripts/       sim.ts (simulator), audit.ts (cards, stances, first mover, snowball, face-down), energy.ts, budget.ts, match-log.ts, diag.ts
tests/         Vitest (rules, cards, chips, evolutions, determinism, data integrity)
docs/          balance-report*.txt: current numbers (random and adaptive loadouts, plus -forced-first/second/none), balance-audit.txt, energy-report.txt, and the *-before-*.txt earlier versions
```

## Changing numbers (no code change needed)

Everything tunable is JSON.

**`src/data/config.json`**

| Section | Controls |
|---|---|
| `specimen` | HP 40 (spec said 30; see "Fourth pass"), base attack 2, base armor 0 |
| `match` | max rounds, starting hand, mulligans, Meltdown start round and Strain per round (3; spec said 2), late draw (`lateDrawFromRound` 5, `lateDraw` 1), second wind (`catchUpHpGap` 8, `catchUpDraw` 1), round-1 second-mover help (`secondMoverDraw` / `secondMoverEnergy`, both 0), `koTiebreak` |
| `energy` | cap (6), bank size (2), `min` (Energy floor, **2**: round 1 now gives 2 Energy) |
| `replace` | `enabled` and `extraCost` (1): playing a graft on an occupied slot replaces it |
| `strain` | threshold T (10), stable ratio, Overclock bonus and self-damage, venting amounts, Hold venting (`holdVent`, default 0), `severRemovesStrain` |
| `stances` | Aggress-beats-Adapt bonus (+3), Fortify divisor and base counter (0; Counterweight adds one), momentum bonus |
| `slots`, `slotTypes`, `adjacency` | slot layout and which slots touch |
| `features` | `cycling`, `dormant`, `neuralLinks`, `energyBanking`, `stanceMomentum` toggles |
| `dormant` | `quietStrain` (Strain a sleeping graft saves, 1) and `ambush` (per faction: `attack`, `armor`, `heal`, `oppStrain`, `draw` given for waking on purpose after a round asleep) |
| `deck` | 20 cards, min 8 Build cards, min 8 World Faction cards, max 4 tech, 2 copies, 1 signature |
| `timers` | stance / mulligan / action / reserve seconds |
| `evolutions` | each evolution's condition metric and target, and its numeric effects |
| `budget` | the card power-budget formula and price list |
| `bot` | strain margin (global and `graftStrainMarginByFaction`), toxin threshold, stance weights, dormant chance and latest round (`dormantChance`, `dormantMaxRound`), delay |

Config can also be overridden per match: `createMatch({ seed, players, config: { strain: { threshold: 12 } } })`.

**`src/data/chips.json`** — the only source of skill nodes now (Builds carry no tree of their own). Shape: `{ [worldFaction]: ChipDef[] }`, 3 Chips per World Faction, each with a `tree` of exactly 2 rows of exactly 2 nodes (48 nodes total). Every node has `params` (numbers the engine reads) and an optional `cond` (the same `Cond` shape cards use — `zone`, `stance`, `strainAtLeast`/`strainAtMost`, `oppStrainAtLeast`, `hpAtMost`, `minRound`, `evolution`, plus `oppHasAnyStatus`/`selfHasAnyStatus`) that gates every param on that node. A node's *shape* is its `(param key, cond)` pair, not just the key — `flatAttack` unconditional and `flatAttack` gated on `zone: 'overclocked'` are two different nodes, which is how every node stays genuinely different from about 30 param keys instead of needing a bespoke hook each. Most nodes work by summing their key across a player's 2 equipped nodes, skipping any whose `cond` isn't currently met (`sumLoadoutParam` in `src/engine/stats.ts`): `flatAttack`, `flatArmor`, `flatIntegrity`, `graftDamageBonus`, `graftDamageReduction`, `bleedRoundsBonus`, `numbRoundsBonus`, `feverRoundsBonus`, `necrosisRoundsBonus`, `poisonRoundsBonus`, `disableRoundsBonus`, `killHeal`, `killStrain`, `killIntegrityHeal`, `killDraw`, `severHeal`, `necrosisVent`, `purgeHeal`, `purgeVent`, `purgeIntegrityHeal`, `worldCardDiscount`, `firstGraftDiscount`, `replaceCostReduction`, `cycleVentBonus`, `firstDrawRoundBonus`, `veteranThresholdReduction`, `holdVentBonus` and `integrityRegen`. Two more (`perGraftAttack`, `perGraftArmor`) scale with your graft count rather than being flat, handled as a small bespoke case in `computeStats` instead of the generic sum. `tests/data.test.ts` pins this exact key list and asserts no two nodes share a `(key, cond)` pair, so a typo'd param key or an accidental duplicate both fail a test instead of silently doing nothing. In `config.evolutions`, a `condition.metric` is one of `damageDealt`, `damageTaken`, `hpHealed`, `endRoundStrain`, `oppRejections`, `oppMaxStrain`, `strainVented`, `damageBlocked` or `round` (no two of the six forms may share one — `tests/data.test.ts` enforces it), and an evolution's `effects` may include `attack`, `armor`, `overclockBonus`, `fortifyVent`, `healOnOppReject`, `toxinDrain`, `ignoreFortifyHalving` and `armorToAttack` (with an optional `armorToAttackCap`) — these are fixed per Build; no Chip node scales them.

**`src/data/decks.json`** — shape `{ build: {predator, parasite, bastion}, world: {corrosion, aegis, miasma, hollow}, tech: [...] }`. A starter deck for a given Build/World Faction pairing is `build[faction] (12) + world[worldFaction] (8) + tech (5)` (`starterDeck()` in `src/engine/data.ts`), validated by tests across all 12 combinations.

After changing anything, run `npm test` and `npm run sim -- --matches 3000`.

## Adding a card

Add an object to `src/data/cards.json`. Every card needs:

```json
{ "id": "pred_new_thing", "name": "New Thing", "faction": "predator", "type": "graft",
  "cost": 2, "strain": 2, "slot": "Head", "attack": 3, "armor": 0,
  "text": "When you deal Clash damage, heal 1.", "signature": false,
  "effect": { "abilities": [ { "trigger": "onDealDamage", "ops": [ { "op": "heal", "amount": 1 } ] } ] },
  "budgetNote": "" }
```

- `faction`: `predator | parasite | bastion | tech | corrosion | aegis | miasma | hollow` (the first three plus `tech` are a Build's own pool; the last four are the four World Factions' pools — same field, wider union, so nothing else about card ownership changed). `type`: `graft | serum | protocol | toxin | sabotage`. `slot` (grafts only): `Head | Limb | Organ | Nerve`.
- For non-graft cards, `strain` is the Strain **you** gain when you play it.
- There is no free-text-only effect: `text` is for humans, `effect` is what the engine runs.

**Effect shapes**

- Grafts: `effect.abilities` = `[{ trigger, cond?, ops }]`. Triggers: `passive` (stat `mod` ops), `onAttach`, `onRoundStart`, `onStrainCheck`, `onDealDamage`, `onTakeDamage`, `onReject`.
- Serum / Toxin / Sabotage: `effect.ops`. Sabotage (and Scanner-style serums) set `"target": "enemySlot"`.
- Protocol: `effect.ops` plus `"reactsTo": ["any"]` or a list of `graft | serum | toxin | sabotage`.
- `cond` (all optional, ANDed): `zone`, `stance`, `strainAtLeast`, `strainAtMost`, `oppStrainAtLeast`, `hpAtMost`, `minRound`.

**Ops** (`who` is `self` or `opp`; defaults are sensible): `heal`, `damage` (direct, ignores armor), `strain` (add), `vent`, `draw`, `discard` (random), `energy` (gain), `drain` (opponent loses Energy), `buff` (`attack|armor`, this round, negative on `opp` = debuff), `sabotage` (`sever|poison|disable|necrosis`), `reveal`, `negate`, `reflect`, `mod` (passive stat, optionally `per` graft/Strain/missing HP), `graftDamage` (integrity damage to one targeted graft, ignores armor), `status` (`bleed|necrosis|numb|fever`), `purge` (clears your own four statuses by default), `integrityHeal` (heals integrity on every graft you control).

Adding a new *kind* of op needs one `case` in `runOps` (`src/engine/rules.ts`); everything else is data.

**Power budget.** Target ≈ `1.5 × Strain + 1 + Cost` (1 attack = 1 pt, 1 armor = 1 pt); signatures get `budget.signatureBonus` (**+5**; it was +3, see the Seventh pass). Text effects are priced from `config.budget.prices`. After editing cards run:

```
npm run budget              # prints target vs actual for every card (WARN if outside ±2)
npm run budget -- --write   # also rewrites every card's "budgetNote"
```

`npm test` fails if a card drifts outside the tolerance. To make a new card show up in the default starter decks, add it under the right bucket in `decks.json` (`build[faction]`, `world[worldFaction]`, or `tech`) — every starter deck is assembled from those three buckets at `8 + 8 + 4 = 20` cards. `npm test` also fails if a card duplicates another's effect shape or a graft in the pool has no ability — see the Twelfth pass.

## Simulator

```
npm run sim -- --matches 1000
```

Options: `--seed N` (match *i* uses seed N+i), `--jobs J` (parallel processes; results do not depend on J), `--policy random|adaptive`, `--json FILE`, and `--config X` for what-if runs: `X` is inline JSON such as `'{"specimen":{"hp":40}}'` or the path of a JSON file, deep-merged over `config.json` for that run only (nothing is written). Use a file on Windows shells, which mangle inline quotes. `--force-evolution first|second|none` makes every player evolve into that form right after round 1 (or never), to measure raw form strength without selection bias (`--force-round N` moves that from round 1 to round N; round 1 is misleading because the factions reach their forms at very different times). Section 7 of the report lists, per Build, how often each form is reached and its win rate.

**Sample size matters.** 1,000 matches is only about 220 games per matchup, so a single cell can be 8 points off by chance (the same seed shows Parasite vs Bastion at 41.7% with 1,000 matches, 51.6% with 6,000 and 50.9% with 20,000). Use 10,000+ before trusting the 45–55% band.

It plays bot-vs-bot matches over every one of the 12 Build/World-Faction archetypes, paired against every other archetype, and prints: Build x Build matchups, World-Faction x World-Faction matchups, each archetype's aggregate score, average match length and round histogram, % of games with a rejection, evolution split per Build, stance pick rates, and every Chip node's pick rate and win rate (grouped by World Faction -> Chip -> row).

- `random` (default): each bot rolls a uniformly random Chip and a uniformly random node per row, so pick rates are ~50% by construction and the node **win rate** is what is informative.
- `adaptive`: bots drift toward nodes that have been winning, so pick rate becomes a "what a rational pool would take" signal.

Other tools: `npm run log -- --a predator --b bastion --wa corrosion --wb aegis --seed 5` prints one full match in plain English; `npm run diag -- --a parasite --b predator --wa miasma --wb hollow` shows average attack/armor/grafts/Strain by round. `--wa`/`--wb` (World Faction for each side) default to `corrosion`/`aegis` if omitted.

## Final balance numbers

Numbers below are from the **Tenth pass** (see below): 30,000 bot-vs-bot matches per column, fresh seeds, starter decks including the expanded card pool (`docs/balance-report.txt` and `docs/balance-report-adaptive.txt`). They predate the **Eleventh pass** (World Factions and Chips) and were not regenerated at 30,000-match scale afterward — the Build-axis shape they describe (cards, evolutions) is unchanged, but every match now also has a randomly-paired World Faction and Chip in the mix, and the Eleventh pass section below has the current, smaller-sample numbers for that.

| Matchup (score, draws = ½) | Random loadouts | Adaptive loadouts |
|---|---|---|
| Predator vs Parasite | **45.3%** / 54.7% | 45.6% / 54.4% |
| Predator vs Bastion | **48.5%** / 51.5% | 49.2% / 50.8% |
| Parasite vs Bastion | **54.0%** / 46.0% | 55.0% / 45.0% |

Overall: **Predator 47.9%, Parasite 50.2%, Bastion 51.9%** (random); 48.3 / 49.8 / 51.9 (adaptive). All three matchups are inside the 45–55% band, but not centered on it the way earlier passes were: Parasite is now the strongest faction against both others, and Predator the weakest, a real shift introduced by this session's card-pool expansion and evolution retunes (see "What is still weak" — I traced and fixed the worst offender, an overtuned new card, but did not fully re-center the three factions afterward). With 30,000 matches one matchup cell has about ±0.6 points of noise (one standard deviation).

| Other headline numbers | Now (Tenth pass) | Before any tuning |
|---|---|---|
| Average match length | **6.66 rounds** | 4.97 |
| Matches that reach round 8 (Meltdown) | **42%** | 12% |
| Matches ended by KO | 66% | 92% |
| Draws (simultaneous KO) | **0.2%** | ~13% |
| Games with at least one rejection | **23.5%** | 4.5% |
| Skill-node win rates (27 faction nodes, random loadouts) | **46.3% – 53.9%** | 26.7% – 67.5% |
| Evolution-row nodes (Hair Trigger / Late Bloomer / Surge) | 49.7 / 48.8 / 51.5% | ~50% each, but 84% vs 18% evolve rates |
| Predator evolves into Apex / Frenzy / not at all | 50% / 31% / 20% | 82% / 0.6% / 17% |
| Parasite: Hive Host / Leech / not at all | 58% / 28% / 14% | 1.4% / 27% / 71% |
| Bastion: Carapace / Juggernaut / not at all | 25% / 72% / 2% | 9% / 77% / 14% |
| Stance mean HP swing (Aggress / Adapt / Fortify) | −0.03 / +0.16 / −0.13 | n/a |
| Round-1 Energy spent | **93%** | n/a |
| Energy spent in round 8 | **75%** | n/a |
| Signature cards played (Apex Maw / Queen Cyst / Bulwark Heart, % of games) | **44 / 31 / 51** | n/a |
| Signature causal value (`npm run signatures`, points) | **+1.5 / −1.4 / +0.9** | n/a |
| Snowball: a 6+ HP lead after round 3 wins | **76.0%** | n/a |
| First mover wins (round-1 stance tie only, coin flip) | **50.2%** | n/a |
| Round with more Energy spent wins | **58.5%** | n/a |

Queen Cyst's causal value going negative (**−1.4**, was +3.9) is new and unresolved this pass — see "What is still weak".

### Fourth pass: the "still weak / still uneven" list

The previous version of this README listed these as unresolved. All of them are now addressed, and the changes that touch numbers you gave me are flagged as **deviations from your spec**.

**Rejections and Meltdown reach (were 15% and 33%; now 25% and 44%).** Tested first with `--config` what-ifs, then made permanent:
- **Specimen HP 30 → 40** (`specimen.hp`). Longer games, so Strain has time to matter. This changes a number from your spec. To go back to 30, set `specimen.hp` to 30 and re-run the simulator: the game gets about a round shorter and rejections rarer (the rule tests pin HP to 30 in their own kit, so they pass either way).
- **Meltdown adds 3 Strain per round instead of 2** (`match.meltdownStrain`, from round 7). Also a deviation. It is what pushes the late game into rejections.
- An **empty rejection still counts.** A Specimen with no graft to eject now still "rejects" (it counts for `rejectionsSuffered`, Frenzy Form's "no rejection" clause and the Hive Host trigger), instead of the check silently doing nothing. Before this a Strain-heavy player with an empty body was punished by nothing.
- The bot's Strain margin is now a per-faction table (`bot.graftStrainMarginByFaction`, all 2 today). It was not needed at the end, but it is the knob if one faction's bot plays too safe.

What I would have expected to work and did not: a bigger Strain margin for the bot and cheaper Toxins both left rejections at about 15% earlier on; the HP and Meltdown levers did the work.

**The evolutions, retuned again** (numbers in `config.evolutions`; the "was" column is the previous pass):

| Form | Condition (was → now) | Effect (was → now) |
|---|---|---|
| Apex Stalker | 24 total damage → **25** | +2 attack, ignore Fortify halving: unchanged |
| Frenzy Form | Strain 6 at round end: unchanged | Overclock bonus +3, +1 attack: unchanged |
| Hive Host | **opponent's peak Strain reaches 8** (was "1 rejection", then 11) | heal 4 on each later rejection and +1 armor: unchanged; **+2 attack** (was +1) |
| Leech Form | opponent peak Strain 10 → 8, later **7** (sixth pass) | Toxins drain 2 (unchanged), **+3 attack** (was +2) |
| Carapace | vent 3 → 4, then back to **3** in the fifth pass | +5 armor → **+2**; Fortify vent 3: unchanged |
| Juggernaut | block 12 → 14, later **11** (sixth pass) | armor adds to attack, up to **+1** (was +4) |

Hive Host now keys off the opponent's *peak Strain* instead of a rejection. The old condition almost never fired because a rejection needs the opponent to be over the threshold at the check, and Strain peaks were usually vented away first (Hive Host was 5% of Parasite games). It is now reached in 34% of them (Leech Form 44% after the sixth pass made it easier). The numbers of the Bastion forms are much smaller than before because HP 40 and Meltdown +3 lengthened games, which made armor much stronger (Bastion had become dependent on evolving: with no evolution it sat at 37% / 25% against Predator / Parasite; now 52% / 46%).

**Evolution-row nodes** (`trees.json`):

| Node | Was | Now |
|---|---|---|
| Hair Trigger | conditions ×0.75, bonuses −1, a +1 bonus stays +1 | same, but **bonuses never fall below +2** (`bonusFloor`), so a +2 stays +2 |
| Late Bloomer | conditions ×1.1, bonuses +1 | unchanged |
| Surge | evolving sets Strain to 0 | evolving lowers Strain to **2** if it is higher (`setTo`) |

Hair Trigger was the weak node for Parasite (its bonuses are small, so −1 wiped a large share of them). Surge at 0 Strain was best for Bastion and worst for Predator (which lives in Overclock); at 2 it is close to neutral. Per faction the three nodes now score (Hair Trigger / Late Bloomer / Surge): Predator 50.6 / 47.7 / 52.2, Parasite 47.8 / 48.1 / 53.3, Bastion 49.4 / 51.3 / 49.6.

**Outlier nodes** (all in `trees.json`):

| Node | Was | Now | Win rate (was → now) |
|---|---|---|---|
| Feint | re-pick after a tie, free | re-pick after a tie, but **gain 2 Strain and take 3 damage** (`strain`, `damage`) | 54.9 → 50.1 |
| Mirror | draw 1 on every stance tie | draw 1 on a tie on **even rounds** (`period`) | 53.7 → 52.1 |
| Stripped Frame | grafts add 1 less Strain, +1 attack | grafts add **2** less Strain, +1 attack (a +2 attack version overshot to 60%) | 45.4 → 47.1 (the lowest node) |
| Counterweight | Fortify counter 2 | Fortify counter **3** | 46.4 → 48.2 |
| Heat Sink | vent 1 extra on Hold | vent **2** extra on Hold | now 47.5 (46.0 with adaptive loadouts) |
| Pounce, Symbiote | | Pounce adds 2 Strain (was 1); Symbiote's first graft adds 1 Strain (was 0) | 48.1 and 52.0 |

Feint's problem was that it is a guaranteed stance win (you already know the opponent's pick when you re-pick), so a Strain cost alone did nothing for Predator, who likes Strain. Adding damage priced it correctly.

**Cards and decks.** Some starter cards moved a point to keep the three factions level at the new length (Bastion Shell Limb, Reflex Ganglion, Ablative Plating, Bone Helm and Predator Bone Spur stats). Every card is still inside its power budget (`npm run budget`). Parasite's tech slot swaps Emergency Bleed for **Armor Piercer**; that alone took Parasite from about 47% to 50% against the other two.

### Forced-evolution diagnostics

`--force-evolution first|second|none --force-round 4` makes every player take the same form after round 4 regardless of condition (`none`: never). These runs ignore the conditions, which are what set each form's price, so they show *raw power per use*, not natural balance (`docs/balance-report-forced-*.txt`).

| Forced | Predator vs Parasite | Predator vs Bastion | Parasite vs Bastion |
|---|---|---|---|
| No evolution | 47.8 | 53.0 | 48.4 |
| First form (Apex / Hive Host / Carapace) | 47.6 | 53.1 | **57.8** |
| Second form (Frenzy / Leech / Juggernaut) | 39.3 | 46.1 | **59.6** |

- **Bastion still does not depend on evolving** (no-evolution overall score is 49.5%, close to even, per `docs/balance-report-forced-none.txt`).
- **The Parasite forms are the strongest per use**: forced, Parasite beats Bastion 58–60% and Predator 53–61%. This is a deliberate part of the design ("rarer forms hit harder"): Leech Form is reached in only 28% of Parasite's natural games. In the natural game the matchups land inside the 45–55% band (see above), but if you change a form's condition, re-run all the forced runs and not just the natural one.

### Fifth pass: an audit beyond the faction matchups, and making face-down matter

`npm run audit` and `npm run energy` (reports in `docs/balance-audit.txt` and `docs/energy-report.txt`, 9,000 and 4,000 bot matches) look at things the win-rate table cannot see. What they found, in order of how much it matters:

**Energy (you asked).** Energy grows 1, 2, 3 ... up to a cap of 6 at round 6. That curve is right for the first half of the game and does nothing in the second half.

| Round | Energy available | Energy spent | Round ends with a card in hand that costs more than the Energy left |
|---|---|---|---|
| 1 | 1 | **41%** | 100% |
| 2 | 2 | 94% | 100% |
| 3 | 3 | 90% | 99% |
| 4 | 4 | 84% | 92% |
| 5 | 5 | 69% | 63% |
| 6 | 6 | 47% | 31% |
| 7 | 6 | 38% | 19% |
| 8 | 6 | **33%** | 14% |

- **Round 1 is nearly dead**: one Energy, and only a 0–1 cost card can be played, so players spend 0.41 Energy on average and most of the time nothing happens. Round 1 also carries the first-mover advantage below.
- **Rounds 2–4 are where Energy is a real constraint**, which is what you want from a resource.
- **From round 6 the cap of 6 never binds**: players spend about 2 of 6. My first guess (slots fill up, so grafts have nowhere to go) was wrong: only 5–6% of leftover cards are grafts with no free slot and about 1% are blocked by Strain. Hands are small (3.3–3.5 cards) and 70–82% of what is left is situational stuff held on purpose (Toxins waiting for the opponent's Strain, heals at full HP, Sabotage with no good target). The late game is card-starved, not Energy-starved.
- **Expensive cards barely exist in play**: 99% of cards played cost 4 or less, and the three cost-5/6 signatures are played in 2–11% of games (Apex Maw 2%, Bulwark Heart 5%, Queen Cyst 11%). A 6-Energy cap is decoration.
- The player who spent more Energy over the whole match won **63.5%** of decided games, so spending it well is a real skill, and a good sign.

Fixes I would make (not done, they change tuned numbers): give round 1 a second Energy (or a free 1-cost play), lower the cap to 5 or add late Energy sinks (a 5-cost card that scales with the Energy left, "spend all your Energy" effects), and either make the 6-cost signatures worth their price or drop their cost to 4.

**Other balance issues found** (all in `docs/balance-audit.txt`; every one of them was handled in the Sixth pass below):
1. **The bot never plays Emergency Bleed** (0% of games; its score, 1.2, is under the bot's 1.5 cut-off). Predator's two Bleeds are dead cards in the simulator, so Predator is really being measured with a 23-card deck. Scanner Probe was dead the same way until this pass. Humans will use both. Easy bot fix, but it will move Predator by a point or two, so it needs a re-balance.
2. **The stance triangle is lopsided.** Mean HP swing per round: Aggress **−0.62**, Adapt +0.26, Fortify +0.35. Fortify beats Aggress by 3.3 HP a round, but Aggress beats Adapt by only 1.6 and Adapt beats Fortify by 2.3. Solving that matrix, the unexploitable mix is about 32% Aggress, **46% Adapt**, 22% Fortify, so Adapt is the "right" pick and Aggress is a trap. Bots pick near uniformly, which hides it. Levers: `stances.aggressBeatsAdaptBonus` up, `fortifyCounterDamage` or `fortifyDamageDivisor` down.
3. **First mover** wins **53.1%** of decided games (round 1's coin flip; it alternates afterwards). Small, but it compounds with the next point.
4. **Snowballing**: with a 6+ HP lead after round 3, the leader wins **83%** of games that continue. There is little catch-up (no comeback mechanic, and armor/attack scale with grafts you already have).
5. **Draws**: 10% overall, but **35% in Predator mirrors** and 17% in Predator vs Parasite (Overclock self-damage plus trades). Real players will call that a bug.
6. **Rarely used cards**: Nerve Pinch (7% of Parasite games), the 5–6 cost signatures (above). The per-card win rates in the audit are mostly not usable as balance signals: reactive cards look terrible because you play them when you are behind (Brace for Impact 35.9%), cheap early cards look great because you play them when you are ahead (Bone Spur 59%).

**Face-down grafts (you asked).** Before this pass a face-down graft was free: it still counted its stats and text, and the ATK / ARM readout gave it away anyway. In the simulator, always playing face-down scored 50.1 / 51.0 / 49.5% (Predator / Parasite / Bastion), i.e. it changed nothing, and the bot's Scanner Probe never fired. Now it is the asleep mechanic described under "Modes". I picked the numbers with a sweep of Strain saved (`quietStrain`) and Ambush size (`ambushAttack`) against a side that never sleeps, using mirror matches:

| Policy for the face-down side | Predator | Parasite | Bastion |
|---|---|---|---|
| Every graft face-down | 43.7% | 44.6% | 50.8% |
| Only in rounds 1–2 | 49.9% | 51.1% | 52.3% |
| Only grafts costing 2 or less | 47.9% | 48.7% | 56.8% |
| The bot's own choice (25% in rounds 1–3, plus when a graft would not fit under the Strain margin) | 49.1% | 48.0% | 51.1% |

(3,000 games per cell, `--config` sweeps in `scripts/audit.ts --only-facedown`.) With Ambush at +2 or +3, sleeping rarely beat 50% (never for Predator or Parasite: it cost more than it gave), and at +5 with 2 Strain saved, blind sleeping became good for Parasite and Bastion (51% / 59%). At +4 with 1 Strain saved, sleeping everything loses, and choosing when to sleep is worth a point or two, which is what I wanted. **Bastion benefits most**, because its base attack is 2 and +4 is a huge burst for it, so watch that if you playtest.

Side effects, all fixed in this pass:
- Because sleeping grafts add nothing to ATK / ARM, the old leak (the opponent's panel and the bot could see a hidden graft's stats) is gone; the README's "the bot uses only public information" is now true.
- The bot's Strain-margin rescue ("sleep it to fit under the margin") is a small buff for Strain-heavy Parasite (+2 against Bastion), so I moved Carapace's condition from vent 4 to **vent 3** to bring it back to 51.1 / 48.9. That flipped Bastion's form split from 44% Carapace / 54% Juggernaut to 54% / 43%.
- Found while reading the config: Hive Host's text said "9+" while its condition was 8. The 8 is what all the measured numbers used, so the text and this README are corrected, not the tuning.
- New tests: 187 total (Dormant rewritten for asleep / wake / Ambush / forced wake / Strain accounting / ejection, plus the play-history privacy cases).
### Sixth pass: fixing the whole audit list, card drawing and Energy

You asked for all of it. Every item from the Fifth pass list got either a fix or a measured reason it is not a problem. Deviations from your spec are marked; every new rule is a config key that can be switched off (`replace.enabled`, `match.lateDraw`, `match.catchUpDraw`, `match.koTiebreak`, ...) and is pinned off in the rule tests, which cover each one separately.

| Problem (Fifth pass) | What I did | Result |
|---|---|---|
| **Draws**: 10% overall, 35% in Predator mirrors | **Deviation:** if both Specimens reach 0 HP together, the **lower Strain wins, then more total damage dealt**; only equal on both is a draw (`match.koTiebreak`) | draws **0.2%** (Predator mirror 0.1%) |
| **Stance triangle lopsided** (Aggress −0.62 HP / round) | **Deviation:** Aggress beats Adapt for **+3** (was +2), and Fortify's base counter is **0** (was 1; Counterweight still adds its 3). Found by sweeping three configurations with `npm run audit -- --config` | swings 2.43 / 2.25 / 2.50 and averages −0.03 / −0.06 / +0.08; the unexploitable mix is now about 31% / 35% / 34% (was 32 / 46 / 22) |
| **Card drawing**: hands shrink from 5.4 to 3.3 cards by round 8 | **From round 5 you draw 2 a round** (`match.lateDrawFromRound`, `lateDraw`) | late hands 4.6–5.1 cards |
| **Snowballing**: a 6+ HP lead after round 3 wins 83% | **Second wind**: at the start of a round, if you are 8+ HP behind you draw 1 extra (`catchUpHpGap`, `catchUpDraw`) | leader wins **77%**. A stronger version (5 HP, 2 cards) reached only 77% too, so I kept the mild one: a stronger board simply is stronger |
| **Energy**: nothing to spend it on after round 5; the cost-5/6 signatures were almost never played | **Replace grafts**: a graft can go on an occupied slot for **1 extra Energy** (`replace`); the old graft leaves with the Strain it had added. The bot replaces only for a clear upgrade | Energy spent in rounds 6 / 7 / 8: **73% / 69% / 63%** (was 47 / 38 / 33). The bot replaces about 0.33 grafts a game, 95% of them from round 5. Signatures played: Apex Maw 4% (was 2), Bulwark Heart 6% (5), Queen Cyst 18% (11) |
| **Round 1 is dead** (42% of Energy spent) | Not fixed in this pass: an Energy floor of 2 (`energy.min`) gave Bastion **+12 points** because Bone Helm's 4 armor becomes a round-1 play. **Fixed properly in the Seventh pass**, which retunes Bastion's armor cards | 90% of round-1 Energy is now spent |
| **First-mover edge 53%** | The metric was misleading: it mostly measures winning the round-1 stance, which is meant to be rewarded. On pure coin-flip rounds the first mover wins **48.6%**. I built a second-mover draw and Energy, and both overcorrected (47% and 40%) | no change; the options exist (`secondMoverDraw`, `secondMoverEnergy`, both 0) |
| **The bot never plays Emergency Bleed** | Fixed the bot's scoring (it now plays Bleed in 29% of games) and made it value Disable a bit more | Predator is now measured with a real deck |
| **Rarely used cards** (Nerve Pinch 7%) | Removed from Parasite's tech slots (Purge Serum instead) | Parasite up about 1 point overall |
| **Predator drifted low** once Bleed and the tiebreak were in | Tech: one Scanner Probe and one Emergency Bleed became **Armor Piercer** (two Piercers) | Predator vs Bastion back to 51.1 / 48.9 |

Node retunes this pass (all in `trees.json` / `config.json`): **Heat Sink** was 44.5%, so it now also vents **1 extra on even rounds** (2 more on a Hold round); vent 1 *every* round overshot to 53.3% and threw Bastion 3 points high. **Regenerator** heals **1 every third round** (was 1 on even rounds, and a heal of 2 on every third round overshot to 54.7%). **Leech Form** needs the opponent's peak Strain 7 (was 8), and **Juggernaut** needs 11 blocked damage (was 14) so Bastion's two forms are reached about equally (50% / 48%).

**Result** (30,000 matches per run, `docs/balance-report*.txt`): matchups within 1.3 points of even (random loadouts) and 2.3 (adaptive; Parasite vs Bastion 47.7 / 52.3 is the worst pair), all 27 faction nodes between 47.5% and 52.2%, forced-no-evolution matchups 47.3 / 49.8 / 50.2, 204 tests.

**Also new in this pass: evolutions and quality of life in the UI** (see "Modes"): evolution banners for both players, an evolved-form badge, the two possible forms and their boosts on the loadout screen and the choose prompt, a Help sheet, keyboard shortcuts, pass confirmation, a round recap, recent-stance chips and a Replace-graft hint. Verified in a real browser: the banner shows for both the player and the bot, nothing overflows the page at 1280×720 and 1366×768 during a whole match, and there are no console errors.
### Seventh pass: round 1, the signature cards, and making face-down worth it for everyone

Three things you asked for. All numbers below are from `docs/` (30,000-match runs for the matchups, 9,000 for `npm run audit`, 8,000 paired games per faction for `npm run signatures`).

**1. Round 1 is no longer empty (Energy floor of 2, Bastion retuned).** `energy.min` is now **2**, so round 1 gives 2 Energy (rounds then go 2, 2, 3, 4, 5, 6). Round-1 Energy spent went from **42% to 90%**. As predicted, the floor alone gave Bastion +12 points (Bone Helm's 4 armor became a round-1 play), and it hit Parasite and Predator unevenly too, so the whole cast was retuned, keeping every card inside its power budget:

| Faction | Changes |
|---|---|
| Bastion | Bone Helm armor 4 → 3; Ablative Plating armor 4 → 3; Fortress Frame node +1 → +2 armor (it was the weakest node at 44%); Pressure Valve node vent 3 → 2. The starter deck's tech slots are unchanged. |
| Parasite | Leech Sucker and Hooked Limb Strain 2 → 1; tech: Acid Spray → Emergency Bleed |
| Predator | tech: Purge Serum → Field Scalpel; **Adrenal Gland now starts on round 2** (its discount made cost-3 grafts castable in round 1, which had it winning 59.7%; starting on round 3 instead dropped it to 41%, so round 2 is the balance point; it is now 53%) |

Two further findings: armor, Strain and "first graft" discounts are still very steep levers (one Strain point on a Bastion limb moved Parasite vs Bastion by 3.6 points), and a cheap-card tweak that looks harmless (Lung Filter to cost 1) is worth +10 points to Bastion. **Result:** matchups within 1.0 point of even (random loadouts) and 1.7 (adaptive).

**2. The signature cards are balanced and playable.** I measured each signature's *causal* value with `npm run signatures`: each faction plays its deck with the signature and with it swapped for a weak card, on identical seeds and loadouts. They were worth about nothing: **−0.1 (Apex Maw), −1.6 (Queen Cyst), −0.8 (Bulwark Heart) points**. Reasons: the two 6-cost cards were castable only on round 6 into an *empty* slot (replacing costs +1, so 7 Energy), and they were played in 4–6% of games; and a Strain-pump signature is bad against Predator, who wants Strain (a Queen Cyst that pumped 3 Strain a round was worth **−5.3**). Fixes:
- **`budget.signatureBonus` 3 → 5** (**deviation from your spec's +3**, which is what the +3 became after measuring): a signature may exceed the normal budget by 5, which is worth about two Energy. Costs: Apex Maw 6 → **3**, Queen Cyst 5 → **4**, Bulwark Heart 6 → **4**.
- **Queen Cyst is redesigned** (still a Parasite Organ, cost 4, Strain 3): **4 attack, 4 armor; at the start of each round the opponent loses 1 Energy and you heal 2.** A signature that changes the *tempo* of the game rather than pumping Strain. Bulwark Heart's armor is 4 → 5.
- No card costs 5 or 6 any more (the Energy cap stays 6 for combinations), so the data test now checks a 0–4 cost curve.

**Result:** worth **+2.6 (Apex Maw), +3.9 (Queen Cyst), +1.3 (Bulwark Heart)** points; played in **44% / 35% / 48%** of games (were 4 / 18 / 6). A card that is one of 25 and worth two to four points of win rate is what "signature" should mean.

**3. Face-down is worth it for every faction.** The Ambush was a flat +4 attack, which suits Bastion (2 base attack) far more than the others. It is now **per faction** (`dormant.ambush`), each tuned by sweeping three settings at a time and reading the same policy study as before:

| Faction | Ambush (waking a graft on purpose after a round asleep) |
|---|---|
| Predator | +5 attack |
| Parasite | +2 attack, and the opponent gains 1 Strain |
| Bastion | +1 attack, +4 armor, heal 1 |

Two things surprised me: the Parasite's Ambush is a cliff (with 2 Strain to the opponent it won **64–66%** against a side that never sleeps; with 1 it was 40–50%, hence the extra 2 attack), and Bastion's armor alone (+3 to +5) never paid for the round of missing stats until a heal of 1 was added. Each faction's win rate against a side that never plays face-down, 3,000 games per cell:

| What the face-down side does | Predator | Parasite | Bastion |
|---|---|---|---|
| Every graft face-down | 49.0% | 51.5% | 54.7% |
| Only in rounds 1–2 | 54.0% | 58.9% | 51.0% |
| **Only grafts costing 2 or less** | 53.3% | 57.1% | 54.1% |
| Cheap grafts in rounds 1–2 | 55.8% | 58.4% | 50.5% |
| The bot's own choice (25% of cheap grafts in rounds 1–3) | 50.6% | 51.3% | 51.5% |

So sleeping **everything** is roughly neutral (49–55%), and sleeping **cheap grafts** wins 53–57% in every faction: the trade is "give up a cheap graft's stats for a round, keep the Strain relief, and flip it for a burst". A human who does that is 3 to 6 points ahead of a bot that only sleeps a quarter of its cheap grafts, which is deliberate: it rewards using the mechanic.

**Also fixed this pass:** the evolution banner intercepted clicks on the top slots for its 14 seconds (found by the browser test); it is now click-through except for its ✕ button. New tests: 209 (per-faction Ambush, signature costs, Adrenal's start round, and the existing node tests now read their numbers live).

### Eighth pass: fair evolution conditions, a real Hold, a smaller play pop-up, and more time to plan

Five things you asked for.

**1. Parasite's two forms shared a condition.** Hive Host and Leech Form were both keyed off `oppMaxStrain` at different targets (8 and 7), so whichever the opponent's Strain reached first is essentially the only one that ever fired — the other was a coin-flip at best. Every other faction already used two different metrics (Predator: damage dealt / your own end-of-round Strain; Bastion: Strain vented / damage blocked), so this was a real bug, not a design choice. **Leech Form now triggers on your own total damage dealt** (18, later **26**) instead of the opponent's Strain; Hive Host keeps `oppMaxStrain` (8). I tried switching Hive Host to `oppRejections` instead (closer to your original spec) and measured it: it collapsed to **4.6%** of Parasite's games, reproducing the exact "too rare" problem the Fourth pass already found and moved away from once. Reusing the opponent's-Strain metric for Hive Host and moving Leech Form onto the caster's own damage instead avoids that trap while still giving the two forms genuinely different paths — a data test now asserts every faction's two conditions use different metrics, so this can't silently regress.

**2. Evolving is now always a real choice: evolve, or hold off.** Previously, meeting a single condition evolved you immediately with no say in the matter; you only got a choice when *both* conditions happened to be met on the same Strain check. Since evolving is permanent, an automatic lock-in on the first condition you happen to reach — even though a possibly better form is close — was a real decision being taken away from you. Meeting any condition now opens a choice: **evolve now, or hold off** (`CHOOSE_EVOLUTION` with `id: null`, a new option alongside the existing evolution ids). Holding off costs nothing; if the condition (or another one) is still met at the next Strain check, you are offered again — it never locks you out. The bot always accepts the first form it becomes eligible for (so bot-vs-bot balance numbers are unaffected by the option existing), and a timed-out human choice does the same. Four dedicated engine tests cover offer / decline / re-offer / accept-later, plus that you cannot decline for your opponent or outside the evolve phase.

**3. Cross-faction fairness: some forms were much easier to reach than their counterparts.** Bastion evolved into *something* in about **99%** of games; Predator in about 84%; Parasite in about 78% (with the shared-metric bug from #1 baked in). That is not "hit the timing sweet spot vs. don't" — it is one faction's evolution being close to guaranteed while the others' is a real bet. Carapace and Juggernaut's conditions were simply much easier to satisfy incidentally, as a side effect of ordinary Bastion play (venting happens on its own; taking hits and blocking them happens on its own), where Predator and Parasite's conditions need you to build toward them on purpose.

| Form | Condition (was → now) |
|---|---|
| Carapace | vent 3 Strain → **7** |
| Juggernaut | block 11 damage → **20** |
| Leech Form | opponent's Strain 7+ → **deal 26+ total damage** (see #1) |

Retuned this way, Bastion's "no evolution" share rises from **0.7% to about 4%**, much closer to Predator's ~15–16% and Parasite's ~13%, without pushing any matchup outside the 45–55% band. I did not chase full parity: raising Carapace/Juggernaut further to exactly match Predator's ~15% "none" share cost Bastion 3–5 more win-rate points against Predator specifically in testing, which is a worse trade than a few extra points of reach-rate gap — see "What is still weak".

**4. Hold now matters.** Before this pass, Hold's only effect was "deal no Clash damage this round" — worse than doing nothing unless you specifically had Heat Sink and high Strain, so the bot almost never used it and there was no real reason to. Hold now also gives **+`strain.holdArmor` armor** this round (which reduces incoming Clash damage too, since armor is armor either way) and vents **`strain.holdVent` Strain** immediately, on top of whatever Heat Sink adds — and it still does not end your round: you can play cards, cycle or wake a graft on a later turn, only the Clash damage is given up. I widened the bot's heuristic from "Heat Sink + Strain ≥ 7" to weighing the armor saved and Strain relief against the attack given up (weighted more heavily at low HP or high Strain). In a 4,000-match check, the bot now Holds in about **61%** of games (about once a game on average), instead of almost never.

**5. The play pop-up is smaller and sits on the side that played it, with the effect spelled out.** It used to be a wide banner of full-size cards spanning the top of the arena, with the card's own text hidden (the small card layout dropped it to save space) — so "what did that do?" needed a tap. It is now a narrow (172px) stack of compact rows anchored on the **left if you played it, right if the opponent did** (matching where each Specimen sits), and every row already shows the card's own rules text, so the effect is obvious without opening anything. Tapping a row still opens the full card if you want the artwork; the header still dismisses the whole stack, and it still lets clicks through to the board everywhere except its own rows.

**Also this pass:** the action timer (once stances are revealed, where you actually read the board and play cards) is now **30 seconds** (was 20); the stance pick itself stays at **10 seconds**, since it is a fast, secret three-way pick, not the point where you need to sit and plan. `npm test`: 217 (was 209).

### Ninth pass: protocols answering protocols, calling the opponent's stance, and graft veterancy

Three new mechanics, plus the rebalance they required.

**1. A Protocol can now answer a Protocol.** Reactions used to resolve exactly one level deep (you play something, the opponent may answer with one Protocol, and that always ends it). Reactions now resolve as a real stack: whoever did **not** just act gets offered a window against the newest thing on it, all the way down, until someone declines or runs out of matching cards. In practice this means the four existing "respond to any play" Protocols (Blood Scent, Counter-Strike, Static Jam, Brace for Impact) can now counter each other, not just the original play — three new engine tests cover a full chain, a decline mid-chain, and negating a Protocol without touching the play it was answering.

**2. Calling the opponent's stance.** When picking your stance you can now also predict theirs: right pays **+`stances.callBonus` attack** that round, wrong costs **+`stances.callPenalty` Strain**, and not calling is free. It is judged against the *final* stance (after any Feint re-pick), not the one first shown. I tried giving the bot a "guess they repeat their last pick" heuristic so bot-vs-bot sims would exercise it; that heuristic was wrong more often than right and it injected enough extra Strain to visibly distort faction balance (Parasite spiked to 55%, Bastion dropped to 44% in one test run), so the bot never calls — this is a human-only skill lever, the same way the bot never bluffs with face-down grafts. **Retired in the Twelfth pass** (see below): a second betting layer stacked on top of the stance pick itself, removed at the user's request.

**3. Graft veterancy.** A Signature graft that survives `veterancy.signatureThreshold` (2) Strain checks unrejected gets **+`veterancy.signatureAttackBonus` attack** permanently, shown as a ★ badge. Bastion's Hardened node (previously the weakest node in the game at 46%) now also shortens that wait by one check for its holder, tying a genuinely weak node to the new mechanic instead of just handing it another flat number.

**Rebalance this pass:** adding the Protocol stack unexpectedly hit Bastion hard (its own Protocols are more defensive and less counter-capable than Predator's/Parasite's "any"-reacting pair), dropping it to 45% overall in testing. Traced with isolated sims rather than guessed at; the fix was **Carapace +2 → +3 armor** and **Juggernaut's armor-to-attack cap 1 → 2**, which brought Bastion back to 48–52% depending on seed. `npm test`: 229.

### Tenth pass: graft integrity, five status effects, and a bigger card pool

The biggest single addition. Full details are in "Adding a card" and the card list; this is the balance summary.

**Integrity.** Every graft now has its own small HP pool (2 for cheap grafts, up to 4 for expensive or Signature ones — the two existing Signatures, Apex Maw and Bulwark Heart, were deliberately kept at 2: big stats, fragile). A new `graftDamage` op lets a card chip a *specific* targeted graft's integrity directly, bypassing armor, reusing the same enemy-slot targeting Sabotage already had; a graft destroyed this way is not a rejection, so it does not confuse rejection-based evolution conditions.

**Five status effects**, all new player- or slot-level timers: **Bleed** (1 damage a round for 2 rounds), **Necrosis** (destroys the targeted graft and blocks that slot from refilling for a while — the fourth Sabotage mode alongside sever/poison/disable), **Numb** (no Protocols while it lasts), **Fever** (grafts cost 1 more while it lasts), and a Purge-style cleanse that clears all four at once (its card is named "Purifying Balm", not "Purge", since "Purge Serum" already existed as an unrelated vent card).

**Evolution-conditional cards.** The existing `cond` system that already let a graft's passive check "while Overclocked" now also accepts `cond.evolution`, so any graft's ability can read "only once you've evolved into X". One such card per faction demonstrates it (Feral Instinct / Apex Stalker, Adaptive Cyst / Hive Host, Scarring Plate / Carapace).

**9 new cards**, woven into the starter decks (not just added to the pool): Predator gained Rending Claw (integrity damage) and Feral Instinct; Parasite gained Hemorrhagic Spike (Bleed) and Adaptive Cyst; Bastion gained Scarring Plate and Purifying Balm; tech gained Paralytic Dart (Numb), Toxic Miasma (Fever) and Necrotic Charge (Necrosis). Card counts: 13 standard + 1 Signature per faction (was 11 + 1), 18 tech cards (was 15).

**A real bug and a real balance miss, both caught by simulation, not by inspection:**
- The bot could be offered an already-illegal Numb-blocked Protocol reaction (`reactionOptions` did not know about Numb, only `validateAction` did), which crashed the simulator outright the first time a bot actually got numbed. Fixed by filtering Numb out where the options are generated, not just where the action is validated.
- **Necrotic Charge** (destroy + block the slot for 2 rounds, cost 3) was badly undercosted: adding one copy to Bastion's deck swung it from ~50% to ~55–58% overall in a 12,000-match check. Isolating it (removing it, then reintroducing it alone) confirmed it was the entire cause, not a side effect of anything else this pass. Cost 3 → **5**, lockout 2 rounds → **1**; that cut the swing from +6 points to roughly +2–3, which is what shows up as Bastion's residual edge in the final numbers above.

`npm test`: 241 (was 229). See "What is still weak" for what this pass left unresolved.

### Eleventh pass: World Factions and Chips — a second, orthogonal build axis

You asked for the single Faction pick (Strain, cards, evolutions, and a 4-row skill tree of 27 nodes) to split into two independent choices: keep the Strain/cards/evolutions bundle as a renamed-in-spirit **Build**, and add a second axis — **World Faction** — built on something Strain is not, with its own loadout item. Full design is under "Two independent axes, not one pick" in Modes above; this is the implementation and balance summary.

**What changed, mechanically:**
- The 27 Build-tree nodes and the 3 shared evolution-modifier nodes (Hair Trigger, Late Bloomer, Surge) are **retired, not ported**. Builds are now exactly cards + two fixed evolutions; `evolutionTarget`/`evoEffects` read the config definition directly, with no multiplier or bonus-delta layer. `trees.json` is deleted.
- **World Faction is built on graft Integrity and the four status effects** (Bleed, Necrosis, Numb, Fever — added last pass) rather than a new Strain-like mechanic, so it is orthogonal to a Build by construction: Strain pressure and graft durability are different resources, and a bad Strain round does not have to mean a bad Integrity round or vice versa.
- **Chips carry the tree.** Each World Faction offers exactly 3 Chips; you equip one before a match, and its 3-row x 2-node tree is now the *only* place a skill node lives (`chips.json`, 72 nodes total across the 4 World Factions' 12 Chips). Most nodes work through ~17 shared, engine-implemented param keys (`sumLoadoutParam`) rather than one bespoke hook per node — the same "reuse a generic mechanism" approach the four status effects already used, extended to cover 72 nodes instead of hand-writing 72 special cases.
- **40 new cards**, ~10 per World Faction, added as entirely new cards (existing Build/tech cards are untouched — no existing card was re-tagged). Deck rules became `size 25, min 12 Build cards, min 8 World Faction cards, max 5 tech` (was `min 20 faction, max 5 tech`); every starter deck is `build[faction] (12) + world[worldFaction] (8) + tech (5)`.
- Feint (re-pick your stance after a tie) is gated by `hasNode(pl, 'feint')`, which just checks loadout-array membership — no chip grants that id any more, so the mechanic is unreachable in real play, but the reducer code is harmless and still directly tested via the test kit's `withNodes` helper.

**A moderate bot-vs-bot pass across the 12 archetypes** (3,000 matches, random Build x random World Faction x random Chip x random loadout each game — not the 30,000-match exhaustive tuning the table above uses; that is follow-up work):
- **Miasma (Numb/Fever) launched badly underpowered**: 27–29% against Corrosion and Hollow, and every one of its 18 Chip nodes scored well under 50% regardless of which node was picked — a sign the World Faction's own card pool was undertuned, not any one node. `config.status.numbRounds` and `feverRounds` went **1 -> 2** and `feverCostIncrease` **1 -> 2** (a mechanic-level buff: since the budget formula doesn't price duration, this strengthens every Numb/Fever card and node with no change to any card's budget number). That brought Miasma to 34–51% against the other three — better, not fully centered; it is still the weakest World Faction and the next thing to attack.
- **Four new cards were badly undercosted by their raw stats** relative to their signature-tier text (`aeg_vital_ward`, `mia_plague_matriarch`, `hol_reaper_pact`, all signatures at −3.5 to −5.5 off budget, plus the non-signature `mia_choking_spore`): brought inside tolerance by raising their stats/effect amounts, not their cost, following the same `npm run budget -- --write` loop used all session.
- **Predator vs Parasite remains the widest Build-axis gap** (~35–37%, already flagged as unresolved before this pass — see "What is still weak"). Frenzy Form's flat attack bonus went **+1 -> +2** as a first attempt (Frenzy Form is reached in about half of Predator's games but was winning only ~35% of them); a follow-up sim run showed only a small effect, so this matchup needs a dedicated pass rather than one speculative number change.
- **Corrosion (Bleed/graftDamage) is the strongest World Faction**, beating every other World Faction including a resurgent Miasma (57–66%); not yet investigated or retuned this pass.
- 40 new cards, all inside power-budget tolerance (`npm run budget`); 212 tests (several rewritten rather than just patched — `tests/setup.test.ts` is now the spec for the 3-argument `validateDeck`/`validateChipChoice`/`validateLoadout`, and a new `tests/data.test.ts` "Chips" suite pins the generic param-key list so a stale key in `chips.json` fails loudly).

### Twelfth pass: no more stance-calling, Integrity in every Clash, real uniqueness, and a 20-card deck

Four things you asked for, in order of how much they touched.

**1. Stance-calling removed.** The Ninth pass's "predict the opponent's stance alongside your own pick" (`PICK_STANCE.guess`, `stanceGuess`, `stances.callBonus`/`callPenalty`) was a second betting layer stacked on top of the stance pick itself. Gone end to end: the action field, the player-state flag, the resolution block in `resolveStances()`, the bot's (always-null) guess, the UI's guess picker, and the config keys. The stance pick itself, Feint, and stance momentum are untouched.

**2. Integrity is now dynamic every round, not just from Sabotage cards.** Clash damage itself now chips a little Integrity off the defender's toughest awake graft (`integrity.clashDamageDivisor`, default 4: `floor(damage / divisor)`), reusing the exact same `graftDamageBonus`/`graftDamageReduction` chip-node hooks the `graftDamage` card op already used — so those Corrosion/Aegis nodes matter every round now, not only when a Sabotage card is drawn. Main-exchange damage and a Fortify counter in the same round combine into one floored chip rather than two (each separately floored to 0 more often than not). A real bug turned up while wiring this in: the `integrityHeal` op was fully typed and priced but had no execution code at all — three Aegis cards (`aeg_mending_serum`, `aeg_regenerative_husk`, `aeg_vital_ward`) silently did nothing when played. Fixed alongside the new mechanic.

**3. Every Chip node and every card now has a genuinely different mechanical shape — not just different numbers.** Previously 72 Chip nodes reused only 17 param keys (`flatArmor` alone backed 9 of them), and the ~100-card pool collapsed into ~35 effect shapes reused across 100 cards (22 of 47 grafts had no ability at all). Both are now backed by a real, enforced definition of "different":
- **Chip nodes**: `TreeNode` gained an optional `cond` (reusing cards' existing `Cond` type, plus two new gates, `oppHasAnyStatus`/`selfHasAnyStatus`, formalizing what `attackVsAfflicted`/`armorVsHealthy` used to do as hardcoded logic). A node's shape is now `(param key, condition)`, not just the key — `flatAttack` unconditional and `flatAttack` while Overclocked are different nodes. ~15 new param keys (economy, draw, veterancy, Hold-vent, kill-triggers, per-graft scaling) round out the vocabulary; `chips.json` is fully rewritten, all 72 nodes distinct, checked by a new `tests/data.test.ts` assertion.
- **Cards**: a card's shape is its sorted set of trigger+op (+condition, +`reactsTo` for Protocols) combinations — different *numbers* on the same shape still collide. The pool is rewritten and expanded to **111 cards** (Build 15 each, World Faction 12 each, Tech 18, up from 100): every graft has a real ability now, every World Faction graft ties into that faction's own mechanic (Corrosion → `graftDamage`/Bleed, Aegis → `integrityHeal`/Purge, Miasma → Numb/Fever, Hollow → `sabotage:necrosis`/Purge or, where a triggered ability can't target a slot the way an instant card can, `drain`/`discard` instead), and no two cards anywhere share a shape — all three enforced by new `tests/data.test.ts` assertions. `graftDamage` and `sabotage` ops need an explicit target chosen at play time (`ctx.play.target`), so they only ever appear on instant-effect cards (serum/toxin/sabotage), never inside a graft's triggered ability — that constraint shaped which mechanic each World Faction's *grafts* specifically lean on.

**4. Deck size 20.** `deck.size/minBuild/minWorldFaction/maxTech` went `25/12/8/5` → `20/8/8/4` (an even split between the two axes now that both carry equal design weight, versus the old build-weighted 12:8 ratio); `decks.json` rebuilt from the new pool.

**Balance, `npm run sim` (3,000 matches, random Build x World Faction x Chip x loadout):**
- **Miasma launched badly broken by the rewrite**: 22–28% against every other World Faction. Cause: fitting an expensive triggered ability (Numb/Fever plus a high trigger multiplier) inside a small graft's power budget had forced 3 of its 4 non-Signature grafts down to 0 attack/0 armor — cheap text vehicles with no combat presence, destroyed by ordinary Clash (and now the new Integrity chip) before they could matter. Fix: raised their Strain (more budget headroom) and put real stats back on them (`mia_toxic_barb`, `mia_creeping_rot`, `mia_choking_spore`'s integrity) rather than re-inflating numbers that would just blow the budget again. That alone took Miasma to 43–57% against every other World Faction — no longer a faction-breaking outlier, though still the weakest.
- **Bastion dropped to ~42% overall** (35.6% vs. Parasite) in this pass's sample, and **Aegis vs. Hollow sits at ~39%** — both newly visible now that Miasma is no longer swamping the signal. Neither investigated yet; see "What is still weak."
- 215 tests (were 212); `npm run budget` clean across all 111 cards.

### Thirteenth pass: closing the two gaps the Twelfth pass left open

You asked for a general sweep — weak spots, mistakes, rebalance. Two real problems, both isolated with `npm run sim`/`npm run audit` at 5,000–9,000 matches (large enough that the 45–55% band means something) rather than guessed at.

**1. Two cards were bad regardless of who played them.** `npm run audit`'s per-card breakdown showed **Bulwark Protocol** (Aegis) at 26.7–37.8% and **Brace for Impact** (Bastion) at 27.6% across every Build that happened to draw them — a signal a card is just undertuned, not that one faction handles it badly (contrast with reactive cards that merely *look* weak because they get played from behind). Both are "respond to any play: armor buff" protocols; both were undercosted for their number. `aeg_bulwark_protocol`: **+4 → +6 armor**. `bast_brace`: **+6 → +8 armor**. Also fixed **Scale Patch** (Bastion's free 0-cost graft, played in 69% of Bastion's games — its floor, effectively): integrity **1 → 2**, staying under the zero-Strain-graft weak-card cap by design.

**2. Bastion was the worst Build by a wide margin, in every World Faction pairing** (38–45.6% depending on partner, confirmed at 9,000 matches) — not a one-archetype problem, a Build-level one. **Predator vs. Parasite was still the widest Build-axis gap** (44.8% / 55.2% at 6,000 matches), flagged as unresolved since the Eleventh pass. Both fixed the same way past sessions have found works when a Build is weak across the board and not just against one opponent — the evolution conditions, which cost nothing when the form is rare, or in these cases already common:
- Bastion: **Carapace's armor bonus 3 → 5** (two steps, checked with a sim run after each: 42.2% → 44.2% → 45.6% → 46.8% overall as the two node/evolution buffs and the card fixes landed). **Juggernaut's armor-to-attack cap 2 → 3.**
- Predator: **Frenzy Form's attack bonus 2 → 3** (already bumped once in the Twelfth pass with little effect; reached in ~70% of Predator's games, so a bonus that lands is worth more than a rare-condition tweak). This one worked: 48.2% / 51.8% afterward, inside the band.

**Net effect** (`npm run sim`, 6,000 matches, random Build x World Faction x Chip x loadout): Bastion **42.2% → 46.0%** overall; Predator vs. Parasite **44.8/55.2 → 48.2/51.8**. Neither is fully centered, and Bastion vs. Parasite specifically is still the worst single matchup at **42.4%** — one more push, most likely on Bastion's own build cards rather than its evolutions a third time, is the next step. 215 tests still green; `npm run budget` clean.

### Fourteenth pass: "fix everything in what is still weak" — a mechanical mistake, not just numbers

You asked to clear the Thirteenth pass's whole list. Buffing the armor *amount* on Bulwark Protocol and Brace for Impact (Thirteenth pass) had barely moved their scores, which was the tell that something structural was wrong, not just undertuned — found it in the bot's own code, not the cards.

**1. The bot was capping a defensive reaction's value at a bad guess.** `botReaction()`'s scoring for a `buff` op (an armor- or attack-boosting reaction, e.g. Brace for Impact, Bulwark Protocol) was `Math.min(op.amount, incoming) * 0.7`, where `incoming` is `opponent's attack − my armor` computed *before* Clash resolves — it does not know about Adapt ignoring armor, Fortify halving, or any graft the opponent has not played yet this round. When that guess came out low (often), the cap made the card's own armor number nearly irrelevant to the bot's evaluation, which is exactly why raising it from +6 to +8 in the Thirteenth pass did almost nothing. Fixed by scoring it near face value instead (`op.amount * 0.6`, no cap) — a real bot-heuristic bug, not a balance number, caught by the fact that a large content buff produced almost no measured effect.

**2. Aegis vs. Hollow (and vs. Corrosion) was a hard mechanical counter, not a power gap.** Both World Factions lean heavily on Sabotage-type cards (Hollow: Necrotic Blade, Soul Harvest; Corrosion: Corrosive Strike, Acid Spray, Venom Burst) to destroy or cripple grafts outright — which Aegis's whole kit (heal a graft's Integrity back up over time) cannot answer, because there is no graft left to heal once Sabotage has resolved. Aegis already had the right tool for this, **Ward Pact** ("Respond to a Sabotage: negate it") — it just was not in Aegis's own starter deck, so neither the bot nor the balance sim ever used it. Added it (swapped in for Shield Serum, cost also dropped 2 → 1 to make it reliably affordable) and gave **Bastion** the equivalent: `bast_reflective_carapace` retargeted from "respond to a Toxin" to **"respond to a Sabotage: it targets its caster instead"** (added to Bastion's starter deck too, swapped in for Field Repair) — Bastion had no Sabotage answer at all before this.

**3. A modest comeback buff.** `match.catchUpDraw` (extra cards for the side 6+ HP behind) **1 → 2**, to push back on snowballing a little further now that the matchup numbers underneath it are no longer the bigger problem.

**Net effect** (`npm run sim`, 7,000 matches): **all three Build matchups landed inside the 45–55% band for the first time** — Predator 49.4%, Parasite 51.6%, Bastion 49.0% overall; Bastion vs. Parasite 46.8% (was 35.3% at the start of the Thirteenth pass). Aegis vs. Hollow **38.7% → 53.4%**; Aegis vs. Corrosion also flipped in Aegis's favor (a side effect of the same fix — Corrosion is Sabotage-heavy too). Snowball rate **74–76% → 70.6%**. 215 tests, `npm run budget` clean, `tsc`/`vite build` clean.

**What this leaves.** Round 2's Energy plateau was not retried — the one earlier attempt broke Predator vs. Parasite badly, and that matchup is only now stable, so it is not the moment to reintroduce that risk blind; if it is retried, do it in isolation with its own `--config` sweep before touching anything else. Parasite vs. Aegis (59.7%) and Predator/Parasite vs. Miasma (44–48%) are the next-widest gaps, but neither is close to the 33–45% "outlier" territory everything above started in — this is genuinely a full sweep landing, not a partial one, and the remaining gaps look like normal tuning noise rather than a mistake to go hunting for.

### Fifteenth pass: the plateau, the Parasite gaps, archetype evenness, and snowballing

You asked to clear the Fourteenth pass's whole "what is still weak" list. Three of the four items had clean fixes; the fourth (Parasite vs. Aegis/Miasma) turned out to be a structural mismatch that resisted every lever tried, and is documented as such rather than forced.

**1. Round 2's Energy plateau — fixed with a one-round ramp, not a curve reshape.** The floor (`energy.min = 2`) makes rounds 1 and 2 tie at 2 Energy before the curve (`round`, capped at 6) takes over in round 3. Reshaping the whole curve was tried two sessions ago and broke Predator vs. Parasite badly. Instead, added `match.energyRampBonus` (1): it fires *only* on the round where `round === energy.min`, i.e. exactly the round the floor stops naturally binding — round 2 becomes 3 Energy instead of tying round 1's 2, and round 3 onward is untouched. Covered by a new rule test (`tests/balance-rules.test.ts`) that checks all three rounds individually so a future change can't silently turn this back into a plateau or a full reshape.

**2. Parasite vs. Aegis / Miasma — partially closed, and the remainder looks structural.** Nerfed Parasite's Hive Host evolution (`attack` 2 → 1, keeping the Strain-8+ heal-on-reject and its armor bonus) — this alone brought overall Build balance to close to perfect (50.0% / 49.8% / 49.9%) but moved Parasite vs. Aegis only 61.2% → 58.8% and Parasite vs. Miasma only 42.5% → 41.6%, both nearly unchanged. That's the signature of a matchup gap that isn't about Parasite's raw power level: a broad Parasite nerf fixes Parasite's *other* matchups (which were fine) while barely touching these two. Tried the opposite lever next — buffed Miasma's signature (`mia_plague_matriarch`: attack 1 → 3, strain 3 → 4 to keep it in budget) to give Miasma raw pressure that doesn't depend on Numb/Fever landing — Parasite vs. Miasma moved 41.6% → ~43–44%, still short. Working theory, not yet acted on further: Aegis's kit (integrity-heal, armor, Ward Pact) and Miasma's kit (Numb disables Protocols, Fever raises cost) both target things Parasite's own kit barely touches — Parasite doesn't lean on Protocols or high-cost grafts, and doesn't force rejections hard enough to make Aegis's integrity-heal matter — so the fix likely needs a card on *Aegis's or Miasma's* side that specifically punishes Parasite's strain-drain/heal-on-reject pattern, not another stat pass on either side. Left open — see "What is still weak."

**3. Archetype evenness — mostly a side effect of #1 and #2, plus one real find.** Re-running `npm run sim` while chasing #2 turned up that Hollow (Energy-drain / necrosis kit) had quietly become the weakest World Faction overall (~45–47% against all three others) — an overcorrection from the Fourteenth pass's Aegis-vs-Hollow fix (giving Aegis a hard Sabotage counter also hit Hollow, whose whole kit leans on Sabotage). Buffed three of Hollow's non-signature grafts by a small amount each (Bone Ward and Gravekeeper +1 attack; the signature Reaper's Pact +2 attack) — note a first attempt that buffed *three* grafts plus the signature overshot to ~54% across the board, confirming these small, low-cost cards are more sensitive to flat stat changes than their budget cost suggests; dialed back to two graft buffs plus the signature, landing Hollow at 51–53% against everyone. Corrosion vs. Aegis (44.6%) was the one cell that didn't move at all across every change this pass — it looks like a genuine standing asymmetry independent of everything else tried, not noise.

**4. Snowballing — a second lever alongside the existing catch-up draw.** Added `match.catchUpEnergy` (1): the Specimen 6+ HP behind now also gets +1 Energy the round it triggers, on top of the existing extra draw. Covered by a new rule test that checks the trailing player's Energy against the leading player's in the same round (comparing round-to-round energy directly was a first-draft mistake — the curve itself changes every round independent of the catch-up bonus, so the test compares both players within one round instead).

**Net effect** (`npm run sim`, 8,000 matches; `npm run audit`, 6,000 matches): Build balance 50.0% / 49.4% / 49.9%, all three cross-Build matchups inside 45–55%. Snowball rate **70.6% → 59.8%**. First-mover advantage stayed healthy (50.2%, 51.6% on a stance tie). World Faction cells: Hollow's across-the-board weakness closed (45–47% → 51–53%); Parasite vs. Aegis eased slightly (59.7% → 56.5%) and Parasite vs. Miasma barely (41.6% → ~43%) — both still open, see below. 217 tests (was 215), `npm run budget` clean, `tsc`/`vite build` clean.

### Sixteenth pass: 2x2 Chips, and Clash wear you can actually see

**Chips shrink to 2 rows x 2 nodes** (4 unique nodes per Chip, one pick per row, 48 nodes total). Each Chip lost the row that was off-theme, redundant, or dead: e.g. Null Field's Vacancy (only worked for Bastion's evolutions), Contaminant's Persistence (a duplicate of Infection), Acid Fang's Bite (a generic +2 attack winning 68%). Rustbite lost its Harvest row and was left weak (~37%), so its Corrosion row now holds Deep Corrosion (Bleed +2 rounds) and a new Rusting Strike (+1 integrity damage from round 4, reusing a node shape freed by the trim). Saved loadouts that point at removed nodes fall back to the Chip's defaults automatically.

**Clash wear was real but invisible.** Measured: ~3.5 wear events per match across both players, because `floor(damage / 4)` rounds most 1-3 damage hits to 0, and nothing on the board reacted when it did land (the log line was styled like a card play, and the Help sheet never mentioned it). Now: `ceil(damage / 4)`, so every damaging hit wears at least 1 (graft destructions from wear 1.6 -> 2.9 per match); the slot pulses and floats "-N INT" (or "destroyed"); the Integrity badge turns amber when worn and red at 1; wear has its own `wear` log kind; and the Help sheet explains it.

**Rebalancing around it.** Frequent wear exposed that Integrity was never tuned: Aegis grafts averaged 3.4 Integrity, Corrosion's 1.4, so Aegis lost 0.8 grafts a match to everyone else's ~2 and jumped to ~58%. Rather than gut Aegis's identity, no graft that costs Strain now starts at 1 Integrity, Signatures start at 3+, and Bastion grafts got +1 (the tough Build was at 2.0). Mending Serum (4 -> 2) and Vital Ward's on-hit repair (2 -> 1) were rolled back to pre-wear values. Miasma's grafts carried 3-4 Strain because the budget overpriced Fever (2 -> 1.5) and Numb (3 -> 2); repriced, and four Miasma grafts dropped 1 Strain each. Hive Host's attack went back to +2 (Parasite lost ~3 points to wear). Corroding Bite / Opportunistic Strike swapped values (+1 always vs +2 against a status), and Caustic Edge's discount went 1 -> 2.

**Net** (`npm run sim`, 10,000 matches): Builds 50.0 / 48.5 / 51.4, all cross-Build matchups in 45-55%; World Factions all 44-56%; Aegis ~51% (was ~58% mid-pass). 218 tests, budget clean, build clean.

### Seventeenth pass: Parasite x Miasma, fixed with a Build trait instead of stats

Parasite/Miasma had been the worst archetype for several passes (40.7%) and survived every stat lever. A per-archetype diagnostic showed why: Parasite's engine is loading Strain onto the opponent (Hive Host needs their Strain at 8+), and Miasma's 8 cards add none — they inflict Fever/Numb instead. Parasite/Miasma reached Hive Host in 60% of games (72-86% with any other World Faction) and ended with no evolution 16% of the time.

**Infect** (`status.parasiteInfectStrain`, 2): whenever a Parasite gives the opponent a Bleed, Numb or Fever they did not already have, the opponent also gains 2 Strain. Refreshing a status they already have does nothing, so round-start status grafts cannot farm it. This keeps the Build on its own axis (Strain) while letting a status-heavy World Faction feed it, so each Parasite pairing plays differently: strongest with Miasma, some with Corrosion's Bleed, nothing with Aegis (which inflicts no statuses). At 1 Strain it fixed Hive Host reach (60% -> 75%) but barely moved the score (43.4%); 2 is what converted it into wins.

**Net** (`npm run sim`, 10,000 matches): Parasite/Miasma **40.7% -> 48.0%**; archetype spread tightened from 40.7-55.0% to 44.0-54.5%; Builds 48.7 / 50.8 / 50.5. Also fixed: the Fever log line said grafts cost "1 more" when Fever adds 2. 221 tests.

### Eighteenth pass: even evolutions, and Predator x Aegis

**Evolution reach was very uneven.** Measured with a reach-curve script (every player holds off evolving, and the round each condition is first met is recorded, over a ladder of candidate thresholds), the old conditions were met by round 5 in anywhere from ~30% (Leech Form, deal 26) to 72% (Frenzy Form) of games, and Apex Stalker and Leech Form shared the same condition (damage dealt). New conditions, each met by ~40% of games by round 4, 57-67% by round 5 and 79-98% by match end, all on different metrics:

| Form | Condition (was) |
|---|---|
| Apex Stalker | deal 18 damage (25) |
| Frenzy Form | end a round at 7+ Strain, no rejection (6+) |
| Hive Host | opponent Strain reaches 8 (unchanged) |
| Leech Form | **take 15 damage** (deal 26) — new `damageTaken` metric; Parasite's comeback form |
| Carapace | vent 5 Strain (6) |
| Juggernaut | block 11 damage (16) |

In real play each Build now splits roughly evenly between its two forms (43-54% each). With reach evened out, the forms' *strength* was then measured with `--force-evolution first|second --force-round 4` (everyone takes the same form at the same time) and it ranged 36-60%. Retuned: Apex Stalker +2 -> +4 attack, Frenzy Form +3 -> +4 attack, Carapace +5 -> +3 armor, Leech Form +3 -> +2 attack, Juggernaut gains +2 armor (cap stays +3). Forced strength now 47-53% for all six.

**Predator x Aegis (44% -> 39.6% after the reach change, now 49.3%).** Most of Predator's deficit was Frenzy Form (reached in half of Predator's games but winning ~40% of them), fixed above. What was left was Aegis-specific: Predator/Aegis beat other Predators (53-56%) but lost 36-39% to armored opponents (Bastion/Aegis, Parasite/Aegis, Bastion/Hollow), because Aegis's grafts carried almost no attack (0, 0, 1, 1). Three Aegis grafts traded 1 armor for 1 attack (Scaled Plate, Bastion Shell, Warding Core; budget-neutral), which also trims the armor stacking that fed Bastion/Aegis.

**Net** (`npm run sim`, 10,000 matches): Builds 50.9 / 48.6 / 50.5; World Factions 46-54% against each other; archetypes 45.8-56.0%, only Bastion/Aegis (56.0%) outside 45-55%. 222 tests.

### UI pass: containment-lab look and quality of life

- **Art direction.** A dim containment-lab look: culture-plate grid background, bioluminescent accent, Chakra Petch display type (Google Fonts; falls back to system fonts offline), hazard tape for Meltdown. Every card has procedural "specimen plate" art (`src/ui/components/CardArt.tsx`), drawn from its type (and a graft's slot), tinted by faction and seeded by card id, so there are no image assets to maintain. Each Specimen is the bio-engineered creature from `src/assets/specimen.jpg` (cropped from the provided concept card art) in a containment tank, mirrored for the opponent, with graft sockets placed on its anatomy (helmet, neck cables, chest, resting hand, far forearm, hip; see `POS` in `Specimen.tsx`) and grafts shown as mini plates.
- **Readability.** Hand cards always show their full text (they used to drop it once you held more than 6); the hand is one sideways-scrolling row. Unplayable cards say why on the card. Player names no longer truncate. Hollow's colour was lightened (it was near-invisible on the dark background). A clear YOUR TURN / RESPOND? pill in the header.
- **Quality of life.** Quick match from the menu (your last Vs Bot picks against a random bot build); setup remembers your last picks per mode, has a sticky Start bar and a Randomize opponent button; leaving a match asks first; Rematch is the primary post-match action; Integrity destructions appear in post-match key events; deck builder adds a card on click and confirms deck deletion; keyboard hints hidden on phones.
- **Bug fixed.** The evolution announcement never auto-dismissed during a timed turn (its 3-second timer restarted on every re-render, and the turn timer re-renders every second), so it could cover the board on phones.

### Findings from the first simulation pass, and what was changed

The first pass found three problems.

**1. Skill nodes were uneven.** Adrenal Gland won 67.5% and Regenerator 61.9%; Stripped Frame won 35.9% and Fortress Frame 26.7%. Under the adaptive policy Parasite fell to about 41%. Because these nodes had numbers you specified, **the changes below deviate from your spec** (all values are in `trees.json`):

| Node | Was | Now |
|---|---|---|
| Adrenal Gland | first graft each round costs 1 less | ...but never below cost 2 (`floor`) |
| Stripped Frame | −1 slot (Organ); grafts add 1 less Strain | −1 slot (**Nerve**: it costs Predator the least); grafts add 2 less Strain; **+1 attack** |
| Fortress Frame | +1 Organ B slot; **all** grafts cost 1 more | +1 Organ B slot; **+1 armor**; only **Organ** grafts cost 1 more |
| Regenerator | heal 1 at every Strain check while Stable | ...on **even rounds** only (`period`) |

Stripped Frame's "less Strain" is nearly worthless because Strain rarely limits anyone, and Fortress Frame's extra slot is almost never filled, so both needed a small flat bonus. Flat bonuses are potent: +2 attack took Stripped Frame from 37% to 61%, and again from 47% to 60% in the last pass.

**2. Rejections were rare and games too short.** Predator and Parasite had almost no armor and Bastion almost no attack, so damage never got absorbed, and 92% of games ended by KO before Strain mattered. **Every faction now has a mix of attack and armor** (previously Predator ~0 armor, Bastion ~1 attack), which did most of the early work (5.0 → 6.15 rounds); the HP and Meltdown changes above did the rest.

### What the tuning taught me (worth knowing before you change cards)

1. **Direct damage was mispriced** at 0.5 pt/HP: 5-damage cards were far too strong because armor can't stop them. It is now 1 pt/HP in `config.budget`.
2. **Armor, healing and flat attack are steep levers.** At this scale one armor point on a two-copy card swings a matchup by 5–20 points, and +1 attack on a node about 6 points. To fine-tune, use one-of cards (Signatures move things by ~0.5 points), starter-deck tech slots (a near-dead card like Scanner Probe is worth ~2 points, one tech swap 3–6) and evolution *conditions* (which cost nothing when the form is rare), and always re-run at 10,000+ matches. 1,000 is too noisy for a 45–55% band.
3. **Armor's value depends on the opponent's attack and on game length.** Armor is wasted against a low-attack faction and decisive against a high-attack one, and every extra round makes it worth more (that is why Carapace and Juggernaut shrank when HP went to 40).
4. **Node values depend on game length and reach.** A node that trades Strain for power looks worthless when 90% of games end before Strain matters; an evolution-timing node is dead if the evolution rarely happens. Fix length and reach first, then nodes.
5. **A stronger Strain source can backfire.** A stronger Cytokine Storm (+4 Strain) or a "+2 Strain per round" Gland made Predator *better*, because Predator lives in Overclock. The same goes for pricing a Predator node in Strain (Feint).

### What is still weak

Numbers below are from the Sixteenth pass's sample (10,000 matches) where stated, otherwise the Fifteenth pass's (8,000 for `sim`, 6,000 for `audit`; snowball was not re-measured after Clash wear got stronger). Everything here predates full 30,000-match tuning, and bullets from earlier passes that no longer apply were removed rather than left stale.

- **Miasma is still slightly below the others**: 46.4% vs. Corrosion and 46.8% vs. Hollow (Eighteenth pass sample); Parasite/Miasma 46.3%, Predator/Miasma 48.7%. Its denial kit still converts to wins a little worse than raw stats.
- **Rustbite's Deep Corrosion (44.6%)** trails its row partner Rusting Strike (51.7%): extra Bleed rounds are 1 damage each, which is not much.
- **The 12 Build x World Faction archetypes are close but not perfectly even**: after the Eighteenth pass only Bastion/Aegis (56.0%) is outside 45-55% (Aegis armor makes Juggernaut's damage-blocked condition come early), with Bastion/Corrosion (45.8%) and Predator/Corrosion (54.9%) at the edges. Predator is also the Build most likely to finish with no evolution (7.7%, vs 0.5% Parasite and 3.3% Bastion): its forms are reached on the same curve as the others by round 5, but its conditions are slightly less likely to ever be met in games that go long. A full 30,000-match-per-cell pass is the natural follow-up.
- **Small, cheap cards are surprisingly sensitive to flat stat buffs.** Buffing three of Hollow's low-cost grafts by +1 attack each (plus its signature) overshot its target band by ~9 points in one sim run; dialing back to two of the three landed it correctly. Worth remembering before making multiple small simultaneous changes to any one World Faction or Build — verify with a sim between each change, not after all of them.
- These are all bot-vs-bot numbers, from a heuristic bot that does not bluff, plans few Ambushes, and replaces conservatively. Human players will use Cycling, Hold, Dormant, replacement and Protocols differently, so a real playtest is the next test for all of the above.

## Assumptions

Where the rules were ambiguous I picked the simplest reading. Change them in `config.json` where a toggle exists.

**Setup and flow**
1. Round 1 also draws 1 card, and from round 5 you draw 2 a round. If you start a round 8 or more HP behind you draw 1 extra (second wind). No hand limit. An empty deck simply stops drawing.
2. The mulligan returns the whole hand to the deck, reshuffles, and draws a new 5. Each player may do it once, for free.
3. On a stance tie in round 1, the coin flip for who acts first comes from the match seed. Afterwards the player who acted second last round goes first.
4. Two passes in a row end the actions phase. Any non-pass action resets the count.

**Cards and reactions**
5. Cost (and Strain for non-grafts) is paid when a card is played. The Protocol window opens **before** the card resolves (stack-like), so a Protocol can negate or reflect it.
6. A window opens only after a card play — not after Cycle, Reveal, Hold or Pass. The opponent gets one Protocol per window, paid from their current Energy. If they have no legal response the window is skipped automatically, so in hotseat that skip reveals "no Protocol in hand".
7. Protocols cannot be played on your own turn.
8. A graft goes into a slot of its type. If the slot is occupied and replacement is on (default), it **replaces** the graft there for 1 extra Energy: the old graft is discarded and takes out exactly the Strain it had added (a sleeping one loses the Strain it saved). If the new graft is negated, nothing is replaced. Limb grafts fit Limb A or B; Organ grafts fit Organ or Organ B.
9. A negated graft never attaches and adds no Strain.
10. Pressure Valve (Bastion) costs no Energy, is available while your Strain is above 0, and only appears in a reaction window.

**Damage and Strain**
11. Direct damage (Serums, Protocols, Burnout, Overclock self-damage) ignores armor. Healing is capped at the starting HP.
12. Clash damage = attack + modifiers − armor (min 0), then Fortify halves it (rounded down) if it is beating Aggress. The Fortify counter is 0 by default, ignores armor, and happens whenever Fortify beats Aggress — even if you Hold.
12b. Clash also chips Integrity: whatever a side takes this round (main exchange plus any Fortify counter, combined into one number first) is floored by `integrity.clashDamageDivisor` and taken off their own toughest awake graft, using the same `graftDamageBonus`/`graftDamageReduction` Chip-node hooks the `graftDamage` card op uses. A graft reduced to 0 this way is destroyed exactly like a `graftDamage` kill (including `killHeal`/`killStrain`/etc. hooks), independent of Strain or rejection.
13. Damage "blocked" (Juggernaut) = damage prevented by armor plus damage removed by Fortify's halving.
14. The Rejection zone (11+) has no Overclock bonus and no Overclock self-damage; it just ejects a graft at the check. Rejection is judged after venting, and if you have no graft nothing is ejected, but the Specimen still counts as having rejected (log line "has no graft to eject").
15. Strain is a pool. A graft records the Strain it added when attached; ejecting it removes exactly that. **Sever does not remove Strain** (`severRemovesStrain` toggles this). Hardened ties also break toward the most recent graft.
16. Strain-check extras (Regenerator, graft "at the Strain check" text) run after rejection and before evolution. Death is checked after Clash and after each check step. If both Specimens reach 0 HP together, the lower Strain wins, then the player who dealt more total damage; only if both are equal is it a draw (`match.koTiebreak`).
17. The Stable/Overclocked boundary is a fixed `floor(threshold x stableMaxRatio)`; no Chip node changes it any more (the retired Dormancy/Redline nodes used to). Overclock bonus stacking: Frenzy Form sets the base bonus to 3 and nothing stacks on top of it.

**Stances and Hold**
18. Hold is a once-per-round action: no Clash damage from you this round, but **+`strain.holdArmor` armor** (this round, so it also reduces what you take) and **`strain.holdVent` Strain vented** immediately, plus any Chip node's `holdVentBonus`. It does not end your turn or the round — you can still play cards, cycle or wake a graft afterward. The bot weighs the armor saved against the attack given up (more so at low HP or high Strain).
19. Stance momentum: repeating last round's stance gives +1 to that stance's winning effect (Aggress bonus, Adapt damage, Fortify counter) and +1 Fortify venting.
20. Feint is offered on ties, in initiative order, and is skipped once the tie is broken. (Nothing currently grants the Feint node, so in practice this never triggers — see the Eleventh pass.)

**Depth features**
21. Poison "2 rounds" = the round it lands plus the next; Disable "1 round" = the round it lands. Poison zeroes a graft's printed and node-granted stats but not its text; Disable turns off its text (including passive text bonuses) but not its stats.
22. Dormant: a face-down graft is asleep (no stats, no text, 1 less Strain until it wakes). It wakes by its owner's Wake action, Scanner Probe, or a Sabotage that targets it; waking pays the saved Strain and fires any on-attach text. Owner-chosen wake after at least one full round asleep gives that faction's Ambush for the round (Predator +5 attack; Parasite +2 attack and 1 Strain to the opponent; Bastion +1 attack, +4 armor, heal 1). A graft with on-attach text may sleep. The match log never names a face-down graft, and an ejected face-down graft is shown to everyone.
23. Neural links: each non-poisoned Nerve graft gives +1 attack per non-poisoned graft in an adjacent slot.
24. Energy banking carries `min(unspent, 2)` into the next round.
25. Slot layout is fixed (Head, Limb A, Limb B, Organ, Nerve) — no Chip node currently changes it, though `slotsFor()` still exists as the mechanism should a future node want to (the retired Stripped Frame/Fortress Frame nodes used to remove/add a slot).

**Evolution**
26. Conditions are checked at the Strain check. "Total damage" counts every point of damage you deal to the opponent (Clash, counters, direct; Apex Stalker and Leech Form both use it, at different targets). "End a round at 9+ Strain with no rejection" uses your Strain after the check, and is 0 on a round you rejected. Hive Host's 8+ uses the opponent's peak Strain ever, before venting. Each faction's two forms always use two **different** metrics, so they are reachable in visibly different ways (enforced by a data test).
26b. Meeting a condition never evolves you on its own: it is always offered as a choice, **evolve now or hold off** (`CHOOSE_EVOLUTION` with `id: null`). Holding off costs nothing and is not remembered between checks — if the same or another condition is still met at the next Strain check, you are asked again. A player who meets two conditions in the same check is offered both, plus hold off. The bot always accepts the first form it becomes eligible for and never holds off; a timed-out human choice does the same.
27. Hive Host heals on every opponent rejection **after** it evolves (it triggers on the opponent's peak Strain, so it normally evolves before the first one).
28. Evolution conditions and evolved bonuses are fixed per Build — no Chip node scales or modifies them (the retired Hair Trigger/Late Bloomer nodes used to).
28b. The play history records every card played (including reactions) and each Pressure Valve use, but never the name of a **cycled** card, and it hides a face-down graft's name from the opponent until it is revealed.

**Bot and UI**
29. The bot uses only public information (a sleeping graft adds nothing to the ATK / ARM it can read). It plays the highest-value graft that keeps it 2 below the threshold, uses Toxins at 7+ opponent Strain, targets the best visible enemy graft with Sabotage (face-down grafts are valued by their Strain), uses Scanner Probe whenever the opponent has a face-down graft, replaces a graft only for a clear upgrade, and would always use Feint to beat the revealed stance if it were ever offered one (nothing currently grants the node). It sleeps a cheap graft (cost 2 or less) on purpose 25% of the time in rounds 1-3, sleeps any graft that would not otherwise fit under its Strain margin, and wakes each sleeper as soon as it can Ambush and the saved Strain fits. It Holds when the armor and Strain relief it would get outweigh the attack it would give up (weighted more heavily at low HP or high Strain), and it always accepts an evolution choice rather than holding off.
30. Timers live in the UI only. The engine has no clock.

## Known limits

- The engine is deterministic and replayable, but the UI does not offer a replay viewer; use the JSON export with `replay()`.
- Bot-vs-bot spectating exists in the simulator only.
- Rules tests use frozen card copies (`tests/fixtures/cards.json`, ids `t_…`), a frozen fixture Chip (`tests/fixtures/chips.json`, id `t_chip`, covering every generic loadout-param hook) and the original evolution numbers (`tests/fixtures/evolutions.json`), so tuning `cards.json`, `chips.json` or `config.evolutions` never breaks them. The data tests (`tests/data.test.ts`) check the real card and Chip pools against structure, budget rules, and the known set of engine-implemented param keys.
