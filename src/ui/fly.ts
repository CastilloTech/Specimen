// A card added to a deck flies there: a small chip with its name travels from the card to the deck counter,
// which pops when it lands. Plain DOM and the Web Animations API, so any screen can use it with no state.

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Re-run a one-shot CSS animation class on an element (remove, reflow, add). */
export function replay(el: Element | null, cls: string): void {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/** The first visible element marked as a deck counter (`data-deck-target`). */
export const deckTarget = (): Element | null => [...document.querySelectorAll<HTMLElement>('[data-deck-target]')].find((e) => e.offsetParent !== null) ?? null;

export function flyTo(from: Element | null, to: Element | null, label: string, color = '#7be0b0'): void {
  if (!to) return;
  if (!from || reduced()) return replay(to, 'count-pop');
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const chip = document.createElement('div');
  chip.className = 'fly-chip';
  chip.textContent = label;
  chip.style.left = `${a.left + a.width / 2}px`;
  chip.style.top = `${a.top + a.height / 3}px`;
  chip.style.borderColor = color;
  document.body.appendChild(chip);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 3);
  const anim = chip.animate(
    [
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 40}px)) scale(0.9)`, opacity: 1, offset: 0.45 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.5)`, opacity: 0.3 },
    ],
    { duration: 480, easing: 'cubic-bezier(0.45, 0, 0.7, 1)' },
  );
  anim.onfinish = () => {
    chip.remove();
    replay(to, 'count-pop');
  };
}
