import { useEffect, useRef, useState } from 'react';
import { canVibrate, play, setSoundPref, useSoundPref } from '../sfx';

const SIZE = { xs: 'h-5 w-6 rounded text-[11px]', sm: 'h-7 w-8 rounded-md text-xs', md: 'h-9 w-9 rounded-lg text-base' };

function Row({ label, on, onToggle, volume, onVolume }: { label: string; on: boolean; onToggle: () => void; volume?: number; onVolume?: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <label className="flex cursor-pointer items-center justify-between gap-3 text-xs font-semibold">
        {label}
        <input type="checkbox" role="switch" checked={on} onChange={onToggle} className="h-4 w-4 accent-[var(--color-accent)]" />
      </label>
      {onVolume && volume !== undefined && <input type="range" min={0} max={100} value={Math.round(volume * 100)} disabled={!on} onChange={(e) => onVolume(Number(e.target.value) / 100)} className="w-full accent-[var(--color-accent)] disabled:opacity-40" aria-label={`${label} volume`} />}
    </div>
  );
}

/** The speaker button: tap for sound effects, music and vibration settings. */
export function SoundToggle({ size = 'md' }: { size?: 'xs' | 'sm' | 'md' }) {
  const p = useSoundPref();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const sfxOn = !p.muted && p.volume > 0;
  const anyOn = sfxOn || (p.music && p.musicVolume > 0);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`grid place-items-center border border-line hover:border-mute ${SIZE[size]} ${anyOn ? 'text-ink2' : 'text-mute opacity-70'}`}
        aria-label="Sound settings"
        aria-expanded={open}
        title="Sound, music and vibration"
      >
        {anyOn ? '🔊' : '🔇'}
      </button>
      {open && (
        <div className="pop absolute right-0 top-full z-[60] mt-1 w-56 space-y-3 rounded-xl border border-line bg-panel p-3 text-left shadow-[0_8px_30px_rgba(0,0,0,0.6)]" role="dialog" aria-label="Sound settings">
          <Row
            label="Sound effects"
            on={sfxOn}
            onToggle={() => {
              setSoundPref({ muted: sfxOn, volume: p.volume > 0 ? p.volume : 0.6 });
              if (!sfxOn) setTimeout(() => play('click'), 0);
            }}
            volume={p.volume}
            onVolume={(volume) => setSoundPref({ volume, muted: false })}
          />
          <Row label="Music" on={p.music && p.musicVolume > 0} onToggle={() => setSoundPref({ music: !(p.music && p.musicVolume > 0), musicVolume: p.musicVolume > 0 ? p.musicVolume : 0.35 })} volume={p.musicVolume} onVolume={(musicVolume) => setSoundPref({ musicVolume, music: true })} />
          {canVibrate() && <Row label="Vibration" on={p.haptics} onToggle={() => setSoundPref({ haptics: !p.haptics })} />}
        </div>
      )}
    </div>
  );
}
