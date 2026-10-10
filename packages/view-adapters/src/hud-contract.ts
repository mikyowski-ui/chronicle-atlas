export type HudPosition = Readonly<{ x: number; y: number }>;
export type HudBounds = Readonly<{ width: number; height: number; top: number; bottom: number }>;
export function clampHudPosition(position: HudPosition, size: Readonly<{ width: number; height: number }>, bounds: HudBounds): HudPosition {
  return {
    x: Math.max(10, Math.min(position.x, bounds.width - size.width - 10)),
    y: Math.max(bounds.top, Math.min(position.y, bounds.height - bounds.bottom - size.height - 10)),
  };
}
export function queryShortcut(event: Readonly<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean; editing: boolean }>): boolean {
  return !event.isComposing && !event.altKey && ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' || !event.ctrlKey && !event.metaKey && !event.editing && event.key === '/');
}
export function matchesCursor(start: number, end: number, cursor: number): boolean {
  return Number.isFinite(cursor) && start <= Math.floor(cursor) && Math.floor(cursor) <= end;
}
