import { findNode } from '../../engine';
import type { GameState, MatchSetup } from '../../engine';
import { LineChart } from '../components/LineChart';
import { FACTION_META, PLAYER_COLORS, WORLD_FACTION_META } from '../meta';

interface Props {
  state: GameState;
  setup: MatchSetup;
  onRematch: () => void;
  onMenu: () => void;
}

export function exportMatchJson(state: GameState, setup: MatchSetup): string {
  return JSON.stringify(
    {
      game: 'Specimen',
      exportedAt: new Date().toISOString(),
      note: 'Replay: createMatch(setup) then reduce() each entry of actions in order. Same seed + actions = same match.',
      setup,
      result: state.result,
      rounds: state.round,
      actions: state.history,
      log: state.log.map(({ n, round, kind, player, text }) => ({ n, round, kind, player, text })),
      snapshots: state.snapshots,
      players: state.players.map((p) => ({ name: p.name, faction: p.faction, worldFaction: p.worldFaction, chip: p.chip, loadout: p.loadout, evolution: p.evolution, finalHp: p.hp, finalStrain: p.strain, stats: p.stats })),
    },
    null,
    2,
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function PostMatch({ state, setup, onRematch, onMenu }: Props) {
  const [a, b] = state.players;
  const names: [string, string] = [a.name, b.name];
  const rounds = state.snapshots.map((s) => s.round);
  const hp: [number[], number[]] = [state.snapshots.map((s) => s.hp[0]), state.snapshots.map((s) => s.hp[1])];
  const strain: [number[], number[]] = [state.snapshots.map((s) => s.strain[0]), state.snapshots.map((s) => s.strain[1])];
  const T = state.config.strain.threshold;
  const yStrain = Math.max(T + 3, ...strain[0], ...strain[1]);
  const key = state.log.filter((l) => ['reject', 'evolve', 'hit', 'end'].includes(l.kind) || (l.kind === 'wear' && /integrity depleted/.test(l.text)));
  const w = state.result?.winner ?? null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-3 p-3">
      <header className="lab-panel rounded-xl border border-accent/60 p-4 text-center">
        <div className="lab-label">Specimen report · {state.round} rounds</div>
        <div className="mt-1 font-display text-3xl font-bold" style={{ color: w === null ? 'var(--color-accent)' : PLAYER_COLORS[w] }}>
          {w === null ? 'Draw' : `${state.players[w].name} wins`}
        </div>
        <div className="text-sm text-ink2">{state.result?.reason}</div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-left text-xs">
          {state.players.map((p) => (
            <div key={p.id} className="rounded-lg bg-black/30 p-2">
              <div className="flex items-center gap-1.5 font-bold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLAYER_COLORS[p.id] }} />
                {p.name} <span style={{ color: FACTION_META[p.faction].color }}>{FACTION_META[p.faction].name}</span> <span style={{ color: WORLD_FACTION_META[p.worldFaction].color }}>{WORLD_FACTION_META[p.worldFaction].name}</span>
              </div>
              <div className="mt-1 text-ink2">
                HP {p.hp} · Strain {p.strain}
              </div>
              <div className="text-ink2">Damage dealt {p.stats.damageDealt} · blocked {p.stats.damageBlocked}</div>
              <div className="text-ink2">Rejections {p.stats.rejectionsSuffered} · vented {p.stats.strainVented}</div>
              <div className="text-ink2">
                Evolution: {p.evolution ? (state.config.evolutions as Record<string, { id: string; name: string }[]>)[p.faction].find((d) => d.id === p.evolution)?.name : 'none'}
              </div>
              <div className="mt-1 text-[10px] text-mute">{p.loadout.map((id) => findNode(id)?.name).join(' · ')}</div>
            </div>
          ))}
        </div>
      </header>

      <LineChart title="HP by round" names={names} rounds={rounds} values={hp} yMax={state.config.specimen.hp} yStep={10} />
      <LineChart title="Strain by round" names={names} rounds={rounds} values={strain} yMax={yStrain} yStep={5} refLine={{ y: T, label: `T=${T}` }} />

      <section className="lab-panel rounded-xl border border-line p-3">
        <h2 className="font-display text-sm font-bold">Key events</h2>
        <ul className="mt-2 space-y-1 text-xs">
          {key.map((e) => (
            <li key={e.n} className="flex gap-2">
              <span className="w-8 shrink-0 text-mute">R{e.round}</span>
              <span className={e.kind === 'reject' ? 'text-red-300' : e.kind === 'evolve' ? 'text-violet-300' : e.kind === 'hit' ? 'text-amber-200' : e.kind === 'wear' ? 'text-orange-300' : 'text-accent'}>{e.text}</span>
            </li>
          ))}
          {key.length === 0 && <li className="text-mute">Nothing dramatic happened.</li>}
        </ul>
      </section>

      <div className="mt-auto flex flex-wrap gap-2">
        <button onClick={() => download(`specimen-match-seed${state.seed}.json`, exportMatchJson(state, setup))} className="flex-1 rounded-lg bg-panel2 px-4 py-3 text-sm font-semibold">
          Export match log (JSON)
        </button>
        <button onClick={onMenu} className="flex-1 rounded-lg bg-panel2 px-4 py-3 text-sm font-semibold">
          Menu
        </button>
        <button onClick={onRematch} autoFocus className="flex-1 rounded-lg bg-accent px-4 py-3 font-display text-sm font-bold text-black">
          Rematch (same builds)
        </button>
      </div>
    </div>
  );
}

