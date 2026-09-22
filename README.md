# Specimen (working title) — playable rules prototype

A 2D digital prototype of a two-player card game where both players control the **same creature**. Built for playtesting the core rules, not for polish.

```
npm install
npm run dev          # play at http://localhost:5173
npm test             # 209 unit tests
npm run sim -- --matches 1000
```

TypeScript, React, Vite, Tailwind. No backend. Node 20+.

> Tip: the project sits in a OneDrive folder. `node_modules` has thousands of files; if syncing is slow, pause OneDrive or move the folder.

## Modes

| Mode | What it does |
|---|---|
| **Vs Bot** | You are Player 1. The bot plays grafts while staying 2 below the Rejection threshold, uses Toxins when you are at 7+ Strain, and weights its stance toward countering your last stance. |
| **Hotseat** | Two players, one device. A "pass the device" screen appears before **every** private decision (mulligan, stance, each action, each reaction). While it shows, the hand is not even in the page. |
| **Decks & skill trees** | Build a 25-card deck (live validation) and pick a loadout (one node per row). Saved in `localStorage`, usable in match setup. |
| **Settings** | Timers, Cycling, Dormant, Neural links, Energy banking, Stance momentum. |

**Layout.** On a phone (portrait) the match is one stacked column. On desktop (window at least 1024 px wide) it becomes a single-screen board: your panel, the two Specimens facing each other, and the opponent's panel on one row; your hand next to the selected-card detail and the Pass / Hold / Cycle buttons underneath; the match log in a fixed column on the right. It fits without page scrolling at 1280×720, 1366×768 and 1920×1080 in every phase (mulligan, stance, actions, reaction, evolution choice).

**Seeing what the opponent played.** Three layers, all built from the engine's public play history (`state.plays`):
- When the opponent plays, the actual card pops up over the arena for about 5 seconds (in hotseat it shows as soon as the next player taps in). The pop-up lets clicks through to the board, so you can still target enemy slots under it; tap a card in it for the full text, or tap its header to dismiss.
- A **"Played this round"** strip under the Specimens keeps every card of the current round as a chip (player, name, where it went or what it targeted, "negated" if it was), newest highlighted.
- The **Plays** button in the header opens the whole match grouped by round; tap any chip to see the card.

Privacy is enforced in one place (`publicPlay`): a face-down graft played by the opponent shows only as "Face-down graft -> Head" until it is woken, forced awake, ejected or negated, and a **cycled** card is never named. Reactions (Protocols, Pressure Valve) appear like any other play.

**Face-down grafts are asleep.** Tick "Face-down" when you place a graft. While it is face-down it is **asleep**:

- it gives **no attack, no armor and no text** (passives, triggers and node bonuses all off), so it cannot leak through the ATK / ARM readout either;
- it adds **1 less Strain** now (`dormant.quietStrain`); the saved Strain is added when it wakes;
- the opponent sees only its slot and that Strain.

It wakes when you choose (the **Wake** button on the graft, a free action that uses your turn), or when the opponent forces it: **Scanner Probe** or any **Sabotage** that targets it wakes it against your will (and you pay its saved Strain). A graft you wake yourself after it has **slept through at least one round** also gives an **Ambush** for that round, and the Ambush depends on the faction (`dormant.ambush`): **Predator +5 attack**; **Parasite +2 attack and the opponent gains 1 Strain**; **Bastion +1 attack, +4 armor and heals 1**. Waking the same round you played it gives no Ambush, and a forced wake never does. An ejected sleeping graft leaves with only the Strain it had added.

So it is a real choice: you give up a graft's stats for a round or more, in exchange for Strain relief, a hidden card the opponent has to respect (or spend a Scanner / Sabotage on), and a burst when you flip it. It pays most for **cheap grafts** (cost 2 or less), because a sleeping cheap graft gives up little while it waits; see the Seventh pass for the measurements per faction.

**Evolution is announced.** When either Specimen evolves, a banner drops in for both players: who evolved, the form's name, the condition that was met, and every boost as a plain-language line with the numbers already adjusted for Hair Trigger / Late Bloomer ("+2 attack", "Your attacks ignore Fortify's damage halving", ...), plus a note if a skill node changed it (Surge, Hair Trigger, Late Bloomer). It stays about 14 seconds or until dismissed. Afterwards the evolved player's panel shows a glowing "★ form · boosts" badge instead of the progress bars, and the ATK / ARM chips get a ▲ when part of the number is the form's bonus. Before the match, the loadout screen lists both players' two possible forms with what each needs and gives, and the "choose your form" prompt shows the boosts of each option.

**Quality of life.**
- **Help sheet** (`?` button or the `?` key): stances, Strain zones, Energy and draws, replacement, face-down and the shortcut list, all read from the live config so the numbers are right.
- **Keyboard shortcuts** (Settings toggle): `A` / `D` / `F` (or `1`-`3`) pick a stance, `K` / `M` keep / mulligan, `1`-`9` select a card, `P` pass, `H` hold, `C` cycle, `W` wake a sleeping graft, `N` no response, `Esc` cancel.
- **Confirm before passing** (Settings toggle, on by default): if you can still afford and play a card, Pass asks first ("Pass anyway" / "Keep playing"). When you truly have nothing to play the Pass button pulses and says so.
- **Round recap** while you pick the next stance: HP and Strain change for both sides last round.
- **Recent stances** of each player (public once revealed) as chips on their panel, so counter-picking is not a memory test.
- **Replace grafts** (Settings toggle): with a graft card selected, occupied slots glow too and say what they cost.
- The stance buttons and their descriptions read the current numbers from `config.json`.
Timers: 10 s per stance; **90 s for the opening keep/mulligan decision** (it does not draw on your reserve, and running out keeps your hand); 20 s per other action plus a 30 s reserve bank per player per match. Running out passes / auto-picks (and the auto-action is logged like any other action, so replays stay exact). Turn timers off in Settings.

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
src/data/      config.json, cards.json, trees.json, decks.json   <- everything tunable
src/ui/        React screens and components
scripts/       sim.ts (simulator), audit.ts (cards, stances, first mover, snowball, face-down), energy.ts, budget.ts, match-log.ts, diag.ts
tests/         Vitest (rules, cards, nodes, evolutions, determinism, data integrity)
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
| `deck` | 25 cards, min 20 faction, max 5 tech, 2 copies, 1 signature |
| `timers` | stance / mulligan / action / reserve seconds |
| `evolutions` | each evolution's condition metric and target, and its numeric effects |
| `budget` | the card power-budget formula and price list |
| `bot` | strain margin (global and `graftStrainMarginByFaction`), toxin threshold, stance weights, dormant chance and latest round (`dormantChance`, `dormantMaxRound`), delay |

Config can also be overridden per match: `createMatch({ seed, players, config: { strain: { threshold: 12 } } })`.

**`src/data/trees.json`** — each skill node has `params` (numbers the engine reads, e.g. Serrated Limbs `limbAttack`, Pressure Valve `vent`). Edit the number and, if you like, the `text`. A few nodes have optional balance params: Adrenal Gland `floor` (the discount never takes a graft below this cost), Fortress Frame `costIncreaseSlot` (the cost penalty only applies to grafts of that slot type) and `armor`, Stripped Frame `removeSlot`, `strainReduction` and `attack`, Regenerator and Mirror `period` (act only on rounds divisible by it), Feint `strain` and `damage` (its price), Surge `setTo` (Strain after evolving). The Evolution-row nodes take `conditionMult` and `bonusDelta` (Hair Trigger also `bonusFloor`). In `config.evolutions`, a `condition.metric` is one of `damageDealt`, `endRoundStrain`, `oppRejections`, `oppMaxStrain`, `strainVented`, `damageBlocked` or `round`, and an evolution's `effects` may include `attack`, `armor`, `overclockBonus`, `fortifyVent`, `healOnOppReject`, `toxinDrain`, `ignoreFortifyHalving` and `armorToAttack` (with an optional `armorToAttackCap`).

**`src/data/decks.json`** — the three starter decks (validated by tests).

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

- `faction`: `predator | parasite | bastion | tech`. `type`: `graft | serum | protocol | toxin | sabotage`. `slot` (grafts only): `Head | Limb | Organ | Nerve`.
- For non-graft cards, `strain` is the Strain **you** gain when you play it.
- There is no free-text-only effect: `text` is for humans, `effect` is what the engine runs.

**Effect shapes**

- Grafts: `effect.abilities` = `[{ trigger, cond?, ops }]`. Triggers: `passive` (stat `mod` ops), `onAttach`, `onRoundStart`, `onStrainCheck`, `onDealDamage`, `onTakeDamage`, `onReject`.
- Serum / Toxin / Sabotage: `effect.ops`. Sabotage (and Scanner-style serums) set `"target": "enemySlot"`.
- Protocol: `effect.ops` plus `"reactsTo": ["any"]` or a list of `graft | serum | toxin | sabotage`.
- `cond` (all optional, ANDed): `zone`, `stance`, `strainAtLeast`, `strainAtMost`, `oppStrainAtLeast`, `hpAtMost`, `minRound`.

**Ops** (`who` is `self` or `opp`; defaults are sensible): `heal`, `damage` (direct, ignores armor), `strain` (add), `vent`, `draw`, `discard` (random), `energy` (gain), `drain` (opponent loses Energy), `buff` (`attack|armor`, this round, negative on `opp` = debuff), `sabotage` (`sever|poison|disable`), `reveal`, `negate`, `reflect`, `mod` (passive stat, optionally `per` graft/Strain/missing HP).

Adding a new *kind* of op needs one `case` in `runOps` (`src/engine/rules.ts`); everything else is data.

**Power budget.** Target ≈ `1.5 × Strain + 1 + Cost` (1 attack = 1 pt, 1 armor = 1 pt); signatures get `budget.signatureBonus` (**+5**; it was +3, see the Seventh pass). Text effects are priced from `config.budget.prices`. After editing cards run:

```
npm run budget              # prints target vs actual for every card (WARN if outside ±2)
npm run budget -- --write   # also rewrites every card's "budgetNote"
```

`npm test` fails if a card drifts outside the tolerance. Add the card to a deck in `decks.json` (a deck needs exactly 25 cards).

## Simulator

```
npm run sim -- --matches 1000
```

Options: `--seed N` (match *i* uses seed N+i), `--jobs J` (parallel processes; results do not depend on J), `--policy random|adaptive`, `--json FILE`, and `--config X` for what-if runs: `X` is inline JSON such as `'{"specimen":{"hp":40}}'` or the path of a JSON file, deep-merged over `config.json` for that run only (nothing is written). Use a file on Windows shells, which mangle inline quotes. `--force-evolution first|second|none` makes every player evolve into that form right after round 1 (or never), to measure raw form strength without selection bias (`--force-round N` moves that from round 1 to round N; round 1 is misleading because the factions reach their forms at very different times). Section 7 of the report lists, per faction, how often each form is reached and each Evolution-row node's win rate and evolve rate.

**Sample size matters.** 1,000 matches is only about 220 games per matchup, so a single cell can be 8 points off by chance (the same seed shows Parasite vs Bastion at 41.7% with 1,000 matches, 51.6% with 6,000 and 50.9% with 20,000). Use 10,000+ before trusting the 45–55% band.

It plays bot-vs-bot matches over every faction pairing and prints: win rate per matchup (score = wins + ½ draws, with W/D shown), average match length and round histogram, % of games with a rejection, evolution split per faction, stance pick rates, and each skill-node's pick rate and win rate.

- `random` (default): each bot rolls a uniformly random loadout, so pick rates are ~33% by construction and the node **win rate** is what is informative.
- `adaptive`: bots drift toward nodes that have been winning, so pick rate becomes a "what a rational pool would take" signal.

Other tools: `npm run log -- --a predator --b bastion --seed 5` prints one full match in plain English; `npm run diag -- --a parasite --b predator` shows average attack/armor/grafts/Strain by round.

## Final balance numbers

30,000 bot-vs-bot matches per column, fresh seeds, starter decks (`docs/balance-report.txt` and `docs/balance-report-adaptive.txt`):

| Matchup (score, draws = ½) | Random loadouts | Adaptive loadouts |
|---|---|---|
| Predator vs Parasite | **51.0%** / 49.0% | 51.7% / 48.3% |
| Predator vs Bastion | **50.4%** / 49.6% | 50.1% / 49.9% |
| Parasite vs Bastion | **49.7%** / 50.3% | 49.5% / 50.5% |

All three cross-faction matchups are within 1.0 point of even with random loadouts and within 1.7 with adaptive ones (the spec asked for 45–55%). Overall: Predator 50.5%, Parasite 49.6%, Bastion 50.0%. Mirror matchups sit at 50% by construction. With 30,000 matches one matchup cell has about ±0.6 points of noise (one standard deviation), so differences under about a point are not real.

| Other headline numbers | Now | Before the seventh pass | Before any tuning |
|---|---|---|---|
| Average match length | **6.45 rounds** | 6.53 | 4.97 |
| Matches that reach round 8 (Meltdown) | **38%** | 40% | 12% |
| Matches ended by KO | 68% | 69% | 92% |
| Draws (simultaneous KO) | **0.4%** | 0.2% | ~13% |
| Games with at least one rejection | **25%** | 25% | 4.5% |
| Skill-node win rates (27 faction nodes, random loadouts) | **47.5% – 52.6%** | 47.5% – 52.2% | 26.7% – 67.5% |
| Evolution-row nodes (Hair Trigger / Late Bloomer / Surge) | 48.7 / 49.8 / 51.5% | 49.3 / 49.0 / 51.7% | ~50% each, but 84% vs 18% evolve rates |
| Predator evolves into Apex / Frenzy / not at all | 49% / 36% / 16% | 54% / 27% / 19% | 82% / 0.6% / 17% |
| Parasite: Hive Host / Leech / not at all | 33% / 45% / 22% | 34% / 44% / 22% | 1.4% / 27% / 71% |
| Bastion: Carapace / Juggernaut / not at all | 52% / 47% / 1% | 50% / 48% / 2% | 9% / 77% / 14% |
| Stance mean HP swing (Aggress / Adapt / Fortify) | −0.02 / +0.15 / −0.13 | −0.03 / −0.06 / +0.08 | n/a |
| Round-1 Energy spent | **90%** | 42% | n/a |
| Energy spent in round 8 | **67%** | 63% | n/a |
| Signature cards played (Apex Maw / Queen Cyst / Bulwark Heart, % of games) | **44 / 35 / 48** | 4 / 18 / 6 | n/a |

(Predator mirrors used to be a third draws; now under 0.1%.)
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
| No evolution | 49.7 | 52.1 | 52.0 |
| First form (Apex / Hive Host / Carapace) | 50.0 | 54.8 | **62.5** |
| Second form (Frenzy / Leech / Juggernaut) | 46.8 | 52.9 | **61.1** |

- **Bastion no longer depends on evolving** (no-evolution results were 37% / 25% and are now 48% / 48%).
- **The Parasite forms are the strongest per use**: forced, Parasite beats Bastion 61–63%. This is a deliberate part of the design ("rarer forms hit harder"): the Parasite reaches a form in 78% of games against Bastion's 98%. In the natural game they land at 50%, but if you change a form's condition, re-run all the forced runs and not just the natural one.

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

- **Round 2 is a plateau**: the Energy curve is 2, 2, 3, 4, 5, 6, so round 2 has the same Energy as round 1 and only 76% of it is spent. Smoothing it (2, 3, 4, ...) would speed everything up and needs another retune.
- **Snowballing (77%)**: a lead after round 3 mostly decides the game. Second wind softened it, not removed it.
- **Face-down**: sleeping blindly is worth +5 for Bastion (54.7%), and Parasite gains the most from the smart rule (about +8). If playtesters find it too strong, lower the Parasite Ambush attack or Bastion's armor by 1.
- **Signatures**: Bulwark Heart is the weakest (+1.3 points); Queen Cyst the strongest (+3.9).
- **Forced-early Parasite forms** (above): 61–63% against Bastion when forced. Natural play is even.
- **Parasite's Hair Trigger** is 47.2% (47.4% adaptive) and Bastion's Hair Trigger 48.1%, because their bonuses are small and Hair Trigger shrinks them. Adrenal Gland (53.1%) and Contagion (53.4%) are the highest nodes; all faction nodes are inside 47.5–52.6%.
- **Bastion mirrors** end in a draw 2.7% of the time (equal Strain and equal damage are common with symmetric armor).
- These are bot-vs-bot numbers, from a heuristic bot that does not bluff, plans few Ambushes and replaces conservatively. Human players will use Cycling, Hold, Dormant, replacement and Protocols differently, so a real playtest is the next test.
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
12. Clash damage = attack + modifiers − armor (min 0), then Fortify halves it (rounded down) if it is beating Aggress. The Fortify counter is 0 by default (3 with Counterweight), ignores armor, and happens whenever Fortify beats Aggress — even if you Hold.
13. Damage "blocked" (Juggernaut) = damage prevented by armor plus damage removed by Fortify's halving.
14. The Rejection zone (11+) has no Overclock bonus and no Overclock self-damage; it just ejects a graft at the check. Rejection is judged after venting, and if you have no graft nothing is ejected, but the Specimen still counts as having rejected (log line "has no graft to eject").
15. Strain is a pool. A graft records the Strain it added when attached; ejecting it removes exactly that. **Sever does not remove Strain** (`severRemovesStrain` toggles this). Hardened ties also break toward the most recent graft.
16. Strain-check extras (Regenerator, graft "at the Strain check" text) run after rejection and before evolution. Death is checked after Clash and after each check step. If both Specimens reach 0 HP together, the lower Strain wins, then the player who dealt more total damage; only if both are equal is it a draw (`match.koTiebreak`).
17. "Stable extends to 6" (Dormancy) and "Overclocked starts at 7" (Redline) are the same number. Overclock bonus stacking: Frenzy sets the base bonus to 2, then Redline adds +1.

**Stances and Hold**
18. Hold is a once-per-round action whose only effect is no Clash damage. It has no other upside except Heat Sink, which vents 2 extra on a Hold round (`holdVent` is the knob to give it one). The bot never Holds except with Heat Sink at high Strain.
19. Stance momentum: repeating last round's stance gives +1 to that stance's winning effect (Aggress bonus, Adapt damage, Fortify counter) and +1 Fortify venting.
20. Pounce/Latch trigger on winning the stance (Aggress / Adapt). Feint is offered on ties, in initiative order, and is skipped once the tie is broken.

**Depth features**
21. Poison "2 rounds" = the round it lands plus the next; Disable "1 round" = the round it lands. Poison zeroes a graft's printed and node-granted stats but not its text; Disable turns off its text (including passive text bonuses) but not its stats.
22. Dormant: a face-down graft is asleep (no stats, no text, 1 less Strain until it wakes). It wakes by its owner's Wake action, Scanner Probe, or a Sabotage that targets it; waking pays the saved Strain and fires any on-attach text. Owner-chosen wake after at least one full round asleep gives that faction's Ambush for the round (Predator +5 attack; Parasite +2 attack and 1 Strain to the opponent; Bastion +1 attack, +4 armor, heal 1). A graft with on-attach text may sleep. The match log never names a face-down graft, and an ejected face-down graft is shown to everyone.
23. Neural links: each non-poisoned Nerve graft gives +1 attack per non-poisoned graft in an adjacent slot.
24. Energy banking carries `min(unspent, 2)` into the next round.
25. Stripped Frame removes the Nerve slot (`removeSlot` in `trees.json`; your spec did not say which slot). Fortress Frame's Organ B accepts Organ grafts. A Stripped Frame or Fortress Frame flat bonus is added to the Specimen's derived attack / armor.

**Evolution**
26. Conditions are checked at the Strain check. "Total damage" counts every point of damage you deal to the opponent (Clash, counters, direct). "End a round at 9+ Strain with no rejection" uses your Strain after the check, and is 0 on a round you rejected. "Opponent reaches 8+" (Leech Form) and Hive Host's 8+ use their peak Strain ever, before venting.
27. Hive Host heals on every opponent rejection **after** it evolves (it triggers on the opponent's peak Strain, so it normally evolves before the first one).
28. Hair Trigger / Late Bloomer scale targets with ceil (for example a target of 24 becomes 18 with ×0.75) and change every numeric evolved bonus by ∓1; boolean effects are unchanged. A reduction never takes a bonus below Hair Trigger's `bonusFloor` (2), so Hair Trigger turns +4 into +3 but leaves +1 and +2 alone, and it never goes below 0.
28b. The play history records every card played (including reactions) and each Pressure Valve use, but never the name of a **cycled** card, and it hides a face-down graft's name from the opponent until it is revealed.

**Bot and UI**
29. The bot uses only public information (a sleeping graft adds nothing to the ATK / ARM it can read). It plays the highest-value graft that keeps it 2 below the threshold, uses Toxins at 7+ opponent Strain, targets the best visible enemy graft with Sabotage (face-down grafts are valued by their Strain), uses Scanner Probe whenever the opponent has a face-down graft, replaces a graft only for a clear upgrade, and always uses Feint to beat the revealed stance. It sleeps a cheap graft (cost 2 or less) on purpose 25% of the time in rounds 1-3, sleeps any graft that would not otherwise fit under its Strain margin, and wakes each sleeper as soon as it can Ambush and the saved Strain fits.
30. Timers live in the UI only. The engine has no clock.

## Known limits

- The engine is deterministic and replayable, but the UI does not offer a replay viewer; use the JSON export with `replay()`.
- Bot-vs-bot spectating exists in the simulator only.
- Rules tests use frozen card copies (`tests/fixtures/cards.json`, ids `t_…`) and the original evolution numbers (`tests/fixtures/evolutions.json`), so tuning `cards.json` or `config.evolutions` never breaks them. Node tests read node params live from `trees.json`. The data tests (`tests/data.test.ts`) check the real pool against the structure and budget rules.
