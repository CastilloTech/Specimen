import { chipsFor } from '../../engine';
import type { WorldFactionId } from '../../engine';
import { ChipArt } from './Emblem';
import { Pills } from './Pills';
import { Flavor } from './Flavor';
import { CHIP_FLAVOR } from '../lore';

/** Pick one of the 3 Chips your World Faction offers; the chosen Chip's idea is shown underneath. */
export function ChipPicker({ worldFaction, value, onChange, label = 'Chip' }: { worldFaction: WorldFactionId; value: string; onChange: (chipId: string) => void; label?: string }) {
  const chips = chipsFor(worldFaction);
  const cur = chips.find((c) => c.id === value);
  return <Pills label={label} labelIcon={<ChipArt id={worldFaction} size={18} />} cols={3} options={chips.map((c) => ({ id: c.id, label: c.name, title: c.text }))} value={value} onChange={onChange} hint={cur && (<>{cur.text}<Flavor text={CHIP_FLAVOR[cur.id]} className="mt-1" /></>)} />;
}
