export type View = { x: number; y: number; k: number };

/** Aplica o zoom mantendo parado o ponto (px, py) do container. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
	const k = Math.min(8, Math.max(0.25, view.k * factor));
	const r = k / view.k;
	return { k, x: px - (px - view.x) * r, y: py - (py - view.y) * r };
}
