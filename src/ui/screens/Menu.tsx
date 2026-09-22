interface Props {
  onHotseat: () => void;
  onBot: () => void;
  onDecks: () => void;
  onSettings: () => void;
}

export function Menu({ onHotseat, onBot, onDecks, onSettings }: Props) {
  const btn = 'w-full rounded-xl border border-line bg-panel px-4 py-4 text-left transition hover:border-accent';
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-4">
      <div className="mb-4 text-center">
        <div className="text-xs uppercase tracking-[0.35em] text-mute">Playtest prototype</div>
        <h1 className="mt-1 text-5xl font-black tracking-tight text-accent">SPECIMEN</h1>
        <p className="mt-2 text-sm text-ink2">One creature. Two players. Graft it, strain it, break your opponent's before yours rejects.</p>
      </div>
      <button className={btn} onClick={onBot}>
        <div className="font-bold">Vs Bot</div>
        <div className="text-xs text-ink2">Play a heuristic bot. It counters your last stance.</div>
      </button>
      <button className={btn} onClick={onHotseat}>
        <div className="font-bold">Hotseat</div>
        <div className="text-xs text-ink2">Two players, one device, with pass-the-device privacy screens.</div>
      </button>
      <button className={btn} onClick={onDecks}>
        <div className="font-bold">Decks &amp; skill trees</div>
        <div className="text-xs text-ink2">Build a 25-card deck and pick a loadout, with rules validation.</div>
      </button>
      <button className={btn} onClick={onSettings}>
        <div className="font-bold">Settings</div>
        <div className="text-xs text-ink2">Timers and optional rules (neural links, banking, momentum...).</div>
      </button>
    </div>
  );
}
