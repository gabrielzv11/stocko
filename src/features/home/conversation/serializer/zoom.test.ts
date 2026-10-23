// bun test src/features/home/conversation/serializer
import { expect, test } from 'bun:test';
import { zoomAt } from './zoom';

test('zoom mantém o ponto sob o cursor e respeita os limites', () => {
	const view = zoomAt({ x: 10, y: 20, k: 1 }, 2, 100, 50);
	expect(view.k).toBe(2);
	// Ponto (100, 50) do container aponta para o mesmo ponto do diagrama antes e depois.
	expect((100 - view.x) / view.k).toBe((100 - 10) / 1);
	expect((50 - view.y) / view.k).toBe((50 - 20) / 1);
	expect(zoomAt({ x: 0, y: 0, k: 1 }, 100, 0, 0).k).toBe(8);
	expect(zoomAt({ x: 0, y: 0, k: 1 }, 0.01, 0, 0).k).toBe(0.25);
});
