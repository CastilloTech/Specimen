import { useRef, useState } from 'react';
import { decodeCode, encodeCode } from '../codec';
import { exportSave, importSave, loadSaveIndex, parseBackup, SAVE_SLOTS } from '../storage';
import { Collapsible } from './Collapsible';

// Backups: everything lives in this browser's storage, which the browser can clear (site data, private
// windows, or Safari's cleanup of sites unused for a week). A save can leave as a file or a text code and
// come back on any device.

const SAVE_TAG = 'SPS1';

function ago(t?: number): string {
  if (!t) return 'never backed up';
  const d = Math.floor((Date.now() - t) / 86400000);
  return d <= 0 ? 'backed up today' : d === 1 ? 'backed up yesterday' : `backed up ${d} days ago`;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BackupPanel({ onChange }: { onChange: () => void }) {
  const idx = loadSaveIndex();
  const saves = idx.slots.map((m, slot) => ({ m, slot })).filter((x) => x.m);
  const stale = saves.filter(({ m }) => !m!.backedUp || Date.now() - m!.backedUp > 14 * 86400000).length;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [code, setCode] = useState<{ slot: number; text: string } | null>(null);
  const [paste, setPaste] = useState('');
  const firstEmpty = idx.slots.findIndex((m) => !m);
  const [target, setTarget] = useState(firstEmpty >= 0 ? firstEmpty : 0);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveFile = (slot: number) => {
    const b = exportSave(slot);
    if (!b) return;
    const safe = b.meta.name.replace(/[^A-Za-z0-9_-]+/g, '-') || 'save';
    download(`specimen-${safe}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b));
    setMsg({ ok: true, text: `Saved "${b.meta.name}" as a file. Keep it somewhere safe (cloud drive, email to yourself).` });
    onChange();
  };
  const makeCode = async (slot: number) => {
    const b = exportSave(slot);
    if (!b) return;
    const text = await encodeCode(SAVE_TAG, b);
    setCode({ slot, text });
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      /* the code stays visible to copy by hand */
    }
    setMsg({ ok: true, text: copied ? `Code for "${b.meta.name}" copied (${Math.ceil(text.length / 1000)}k characters). Paste it into notes or a message to yourself.` : 'Select the code below and copy it.' });
    onChange();
  };

  const bring = (raw: unknown) => {
    const b = parseBackup(raw);
    const there = loadSaveIndex().slots[target];
    if (there && !window.confirm(`Replace "${there.name}" in slot ${target + 1} with "${b.meta.name}"? Everything in "${there.name}" is erased.`)) return;
    importSave(target, b);
    setMsg({ ok: true, text: `"${b.meta.name}" is back in slot ${target + 1} and loaded.` });
    setPaste('');
    onChange();
  };
  const fromFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      bring(JSON.parse(await f.text()));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof SyntaxError ? "That file isn't a Specimen save." : (e as Error).message });
    }
    if (fileRef.current) fileRef.current.value = '';
  };
  const fromCode = async () => {
    try {
      bring(await decodeCode(SAVE_TAG, paste, 'save code (they start with SPS1.)'));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <Collapsible id="backup" defaultOpen={false} title="Backup & transfer" meta={saves.length === 0 ? 'no saves yet' : stale ? <span className="text-amber-300">{stale} not backed up</span> : 'all backed up'} bodyClass="space-y-3">
      <p className="text-xs text-ink2">Saves live only in this browser, and browsers can clear site data. Keep a backup as a file or a code; bring it back here on this or any other device.</p>
      {msg && (
        <p className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200' : 'border-red-500/40 bg-red-950/30 text-red-200'}`} role="status">
          {msg.text}
        </p>
      )}
      {saves.length > 0 && (
        <ul className="space-y-1.5">
          {saves.map(({ m, slot }) => (
            <li key={slot} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-black/20 px-2.5 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{m!.name}</span>
                <span className={`block text-[11px] ${m!.backedUp ? 'text-mute' : 'text-amber-300'}`}>
                  Slot {slot + 1} · {ago(m!.backedUp)}
                </span>
              </span>
              <button onClick={() => saveFile(slot)} className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-bold text-black">
                ⬇ Save file
              </button>
              <button onClick={() => void makeCode(slot)} className="rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold text-ink2 hover:border-mute">
                Copy code
              </button>
            </li>
          ))}
        </ul>
      )}
      {code && (
        <textarea readOnly value={code.text} onFocus={(e) => e.currentTarget.select()} className="h-20 w-full rounded-lg border border-line bg-black/40 p-2 font-mono text-[10px] text-ink2" aria-label="Save code" />
      )}

      <div className="rounded-lg border border-line bg-black/20 p-2.5">
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-display text-sm font-bold">Restore a save</span>
          <label className="ml-auto flex items-center gap-1 text-ink2">
            into
            <select value={target} onChange={(e) => setTarget(Number(e.target.value))} className="rounded-md border border-line bg-black/40 px-1.5 py-1 text-xs" aria-label="Slot to restore into">
              {Array.from({ length: SAVE_SLOTS }, (_, i) => (
                <option key={i} value={i}>
                  Slot {i + 1}
                  {idx.slots[i] ? `: ${idx.slots[i]!.name} (replaced)` : ' (empty)'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => fileRef.current?.click()} className="rounded-md bg-panel2 px-3 py-1.5 text-xs font-semibold">
            ⬆ From a file
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void fromFile(e.target.files?.[0])} aria-label="Save file" />
        </div>
        <div className="mt-2 flex gap-2">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…or paste a save code (starts with SPS1.)" className="h-14 min-w-0 flex-1 rounded-lg border border-line bg-black/40 p-2 font-mono text-[11px]" aria-label="Paste a save code" />
          <button onClick={() => void fromCode()} disabled={!paste.trim()} className="self-end rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-40">
            Restore
          </button>
        </div>
      </div>
    </Collapsible>
  );
}
