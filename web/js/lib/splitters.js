// Draggable column splitters for the three-column layouts (inputs | stage | results).
// Widths live in the grid's --lw / --rw custom properties and are remembered per module.
// Double-click a splitter to return to the default width.
import { store } from './dom.js';

export function columnSplitters(grid, key, { minSide = 200, minCenter = 320 } = {}) {
  const saved = store.get(key, {});
  const prop = { l: '--lw', r: '--rw' };
  const apply = (side, px) => grid.style.setProperty(prop[side], `${Math.round(px)}px`);
  for (const side of ['l', 'r']) {
    if (Number.isFinite(saved[side])) apply(side, saved[side]);
    const bar = document.createElement('div');
    bar.className = `col-split ${side}`;
    bar.title = 'Drag to resize · double-click to reset';
    bar.setAttribute('role', 'separator');
    bar.setAttribute('aria-orientation', 'vertical');
    grid.append(bar);
    let drag = false;
    bar.onpointerdown = (e) => {
      drag = true; bar.setPointerCapture(e.pointerId);
      bar.classList.add('drag'); document.body.classList.add('col-dragging');
      e.preventDefault();
    };
    bar.onpointermove = (e) => {
      if (!drag) return;
      const r = grid.getBoundingClientRect();
      const other = parseFloat(getComputedStyle(grid).getPropertyValue(prop[side === 'l' ? 'r' : 'l'])) || 0;
      const twoCol = getComputedStyle(grid).gridTemplateColumns.split(' ').length < 3;
      const w = side === 'l' ? e.clientX - r.left : r.right - e.clientX;
      const max = r.width - (twoCol ? 0 : other) - minCenter;
      apply(side, Math.max(minSide, Math.min(max, w)));
    };
    const end = () => {
      if (!drag) return;
      drag = false;
      bar.classList.remove('drag'); document.body.classList.remove('col-dragging');
      const cur = parseFloat(getComputedStyle(grid).getPropertyValue(prop[side]));
      store.set(key, { ...store.get(key, {}), [side]: cur });
    };
    bar.onpointerup = end;
    bar.onpointercancel = end;
    bar.ondblclick = () => {
      grid.style.removeProperty(prop[side]);
      const s = store.get(key, {}); delete s[side]; store.set(key, s);
    };
  }
}
