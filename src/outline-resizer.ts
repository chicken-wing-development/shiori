import { readPreference, writePreference } from './storage';

// Keep an editor visible even when a saved width came from a larger window.
export function setupOutlineResizer(app: HTMLElement): void {
  const layout = app.querySelector<HTMLElement>('.editing-layout')!;
  const outline = app.querySelector<HTMLElement>('#outline')!;
  const handle = app.querySelector<HTMLElement>('#outline-resizer')!;
  const saved = readPreference<unknown>('outlineWidth', null);
  let preferred = typeof saved === 'number' && Number.isFinite(saved) ? Math.max(125, Math.min(520, saved)) : undefined;
  let drag: { id: number; x: number; width: number; preferred: number | undefined } | undefined;

  function limits(): { min: number; max: number; defaultWidth: number } {
    const available = layout.clientWidth;
    const min = available <= 500 ? 125 : 150;
    const editorMinimum = available <= 500 ? 180 : available <= 760 ? 280 : 480;
    return { min, max: Math.max(min, Math.min(520, available - editorMinimum - 7)), defaultWidth: available <= 500 ? 125 : available <= 760 ? 150 : available <= 1000 ? 180 : 215 };
  }
  function apply(width = preferred): void {
    const { min, max, defaultWidth } = limits();
    const actual = Math.round(Math.max(min, Math.min(max, width ?? defaultWidth)));
    layout.style.setProperty('--outline-width', `${actual}px`);
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(actual));
    handle.setAttribute('aria-valuetext', `${actual} ピクセル`);
  }
  function setWidth(width: number): void {
    const { min, max } = limits();
    preferred = Math.round(Math.max(min, Math.min(max, width)));
    apply();
  }
  function finish(cancelled: boolean): void {
    if (!drag) return;
    const { id, preferred: previous } = drag;
    drag = undefined;
    if (cancelled) { preferred = previous; apply(); }
    else writePreference('outlineWidth', preferred ?? null);
    app.classList.remove('resizing-outline');
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  }
  handle.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || drag) return;
    event.preventDefault();
    handle.focus();
    drag = { id: event.pointerId, x: event.clientX, width: outline.getBoundingClientRect().width, preferred };
    handle.setPointerCapture(event.pointerId);
    app.classList.add('resizing-outline');
  });
  handle.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) setWidth(drag.width + event.clientX - drag.x);
  });
  handle.addEventListener('pointerup', event => { if (drag?.id === event.pointerId) finish(false); });
  handle.addEventListener('pointercancel', event => { if (drag?.id === event.pointerId) finish(true); });
  handle.addEventListener('lostpointercapture', () => finish(true));
  window.addEventListener('blur', () => finish(true));
  handle.addEventListener('dblclick', () => { finish(true); preferred = undefined; writePreference('outlineWidth', null); apply(); });
  handle.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); finish(true); return; }
    if (event.ctrlKey || event.metaKey || event.altKey || drag) return;
    const { min, max } = limits();
    const width = outline.getBoundingClientRect().width;
    const step = event.shiftKey ? 40 : 10;
    const next = event.key === 'ArrowLeft' ? width - step : event.key === 'ArrowRight' ? width + step
      : event.key === 'Home' ? min : event.key === 'End' ? max : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setWidth(next);
    writePreference('outlineWidth', preferred);
  });
  new ResizeObserver(() => apply()).observe(layout);
  apply();
}
