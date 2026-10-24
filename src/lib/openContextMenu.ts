/** O ContextMenu do Radix só abre por contextmenu: botões (⋮, …) dentro do trigger disparam um, ancorado abaixo deles. */
export function openContextMenu(e: React.MouseEvent<HTMLElement>) {
	const { left, bottom } = e.currentTarget.getBoundingClientRect();
	e.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: left, clientY: bottom }));
}
