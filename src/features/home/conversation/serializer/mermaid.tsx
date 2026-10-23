import Dialog from '@/components/ui/dialog';
import { Icon, type IconName } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import type { Mermaid } from 'mermaid';
import { useEffect, useId, useRef, useState } from 'react';
import { zoomAt } from './zoom';

// Importado só quando aparece um diagrama: o mermaid pesa alguns MB.
let ready: Promise<Mermaid> | undefined;
const load = () =>
	(ready ??= import('mermaid').then(({ default: mermaid }) => {
		// strict: o texto vem do modelo, então o SVG passa pelo DOMPurify e não roda script nem clique.
		mermaid.initialize({
			startOnLoad: false,
			theme: 'dark',
			securityLevel: 'strict',
			suppressErrorRendering: true,
			// O tema dark liga gradiente nas bordas (claro à esquerda, apagado à direita): bordas sólidas.
			themeVariables: { useGradient: false },
			// Visual só de bordas: sem sombra nem preenchimento. Nós com a cor do card (não transparentes)
			// para esconder arestas que passem por trás; !important vence os estilos inline do mermaid.
			themeCSS: `
				* { filter: none !important; }
				.node rect, .node polygon, .node circle, .node ellipse, .node path, rect.actor, .note { fill: var(--card) !important; }
				.cluster rect { fill: transparent !important; }
				.labelBkg, .edgeLabel, .edgeLabel p, .edgeLabel rect, .relationshipLabelBox, .relationshipLabelBox rect, .classLabel .box, .stateLabel .box {
					background-color: var(--card) !important; fill: var(--card) !important; opacity: 1 !important;
				}
			`,
		});
		return mermaid;
	}));

const START = { x: 0, y: 0, k: 1 };

function Tool({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
	return (
		<button
			type='button'
			onClick={onClick}
			aria-label={label}
			title={label}
			className='text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors'
		>
			<Icon icon={icon} size='sm' />
		</button>
	);
}

// Pan arrastando e zoom pelos botões. No modo `fullscreen` (dialog) a roda e o toque também,
// porque ali não há página para rolar.
// ponytail: sem pinça (dois dedos); no celular o zoom é pelos botões.
function PanZoom({
	svg,
	fullscreen,
	className,
	children,
	onDoubleClick,
}: {
	svg: string;
	fullscreen?: boolean;
	className?: string;
	children?: React.ReactNode;
	onDoubleClick?: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const drag = useRef<{ x: number; y: number } | null>(null);
	const [view, setView] = useState(START);

	// onWheel do React é passivo: não deixa cancelar a rolagem da página.
	useEffect(() => {
		const el = ref.current;
		if (!fullscreen || !el) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const box = el.getBoundingClientRect();
			setView((v) => zoomAt(v, Math.exp(-e.deltaY / 300), e.clientX - box.left, e.clientY - box.top));
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	}, [fullscreen]);

	const zoom = (factor: number) => {
		const el = ref.current;
		if (el) setView((v) => zoomAt(v, factor, el.clientWidth / 2, el.clientHeight / 2));
	};

	const tools = (position: string) => (
		<div className={cn('border-border bg-card/90 absolute right-2 flex gap-0.5 rounded-lg border p-0.5 backdrop-blur', position)}>
			<Tool icon='zoom-in' label='Aproximar' onClick={() => zoom(1.25)} />
			<Tool icon='zoom-out' label='Afastar' onClick={() => zoom(0.8)} />
			<Tool icon='rotate-ccw' label='Centralizar' onClick={() => setView(START)} />
			{children}
		</div>
	);

	return (
		<div className={cn('relative overflow-hidden', className)}>
			<div
				ref={ref}
				className={cn('h-full cursor-grab select-none active:cursor-grabbing', fullscreen && 'touch-none')}
				onPointerDown={(e) => {
					e.currentTarget.setPointerCapture(e.pointerId);
					drag.current = { x: e.clientX - view.x, y: e.clientY - view.y };
				}}
				onPointerMove={(e) => {
					const start = drag.current;
					if (start) setView((v) => ({ ...v, x: e.clientX - start.x, y: e.clientY - start.y }));
				}}
				onPointerUp={() => (drag.current = null)}
				onPointerCancel={() => (drag.current = null)}
				onDoubleClick={onDoubleClick}
			>
				<div
					className={cn(
						'flex origin-top-left items-center justify-center p-4',
						fullscreen ? 'size-full [&_svg]:size-full [&_svg]:max-w-none!' : '[&_svg]:h-auto',
					)}
					style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
					dangerouslySetInnerHTML={{ __html: svg }}
				/>
			</div>
			{/* Diagrama alto: atalhos em cima e embaixo. No dialog cabe tudo e o topo é do botão de fechar. */}
			{!fullscreen && tools('top-2')}
			{tools('bottom-2')}
		</div>
	);
}

/** Diagrama do bloco ```mermaid; mostra `fallback` (o código) enquanto carrega ou se a sintaxe for inválida. */
export function MermaidDiagram({ code, fallback }: { code: string; fallback: React.ReactNode }) {
	const id = `mermaid-${useId().replace(/\W/g, '')}`;
	const [svg, setSvg] = useState<string>();
	const [expanded, setExpanded] = useState(false);

	useEffect(() => {
		let alive = true;
		load()
			.then((mermaid) => mermaid.render(id, code))
			.then(
				(result) => alive && setSvg(result.svg),
				() => alive && setSvg(undefined),
			);
		return () => {
			alive = false;
		};
	}, [id, code]);

	if (!svg) return fallback;
	return (
		<>
			<PanZoom svg={svg} onDoubleClick={() => setExpanded(true)}>
				<Tool icon='maximize-2' label='Expandir (ou duplo clique)' onClick={() => setExpanded(true)} />
			</PanZoom>
			<Dialog open={expanded} onClose={() => setExpanded(false)} closeButton className='flex h-[85vh] w-[80vw] max-w-none flex-col'>
				<PanZoom svg={svg} fullscreen className='min-h-0 flex-1' />
			</Dialog>
		</>
	);
}
