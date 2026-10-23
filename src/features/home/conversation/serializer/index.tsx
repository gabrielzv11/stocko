import { CopyButton } from '@/components/ui/copyButton';
import { Icon } from '@/components/ui/icons';
import { motion } from 'motion/react';
import { MermaidDiagram } from './mermaid';
import { parseBlocks, type Block, type Inline } from './parse';

// ponytail: um motion.span por letra, só enquanto a mensagem está em streaming; agrupar por palavra se respostas longas pesarem
function StreamingText({ text }: { text: string }) {
	return (
		<>
			{Array.from(text).map((char, i) => (
				<motion.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
					{char}
				</motion.span>
			))}
		</>
	);
}

function Inlines({ nodes, streaming }: { nodes: Inline[]; streaming?: boolean }) {
	return nodes.map((node, i) => {
		switch (node.type) {
			case 'text':
				return streaming ? <StreamingText key={i} text={node.text} /> : node.text;
			case 'strong':
				return (
					<strong key={i} className='font-semibold'>
						<Inlines nodes={node.children} streaming={streaming} />
					</strong>
				);
			case 'em':
				return (
					<em key={i}>
						<Inlines nodes={node.children} streaming={streaming} />
					</em>
				);
			case 'link':
				return (
					<a key={i} href={node.href} target='_blank' rel='noreferrer' className='underline underline-offset-2'>
						<Inlines nodes={node.children} streaming={streaming} />
					</a>
				);
			case 'code':
				return (
					<code key={i} className='bg-muted rounded-md px-1.5 py-0.5 font-mono text-[0.85em]'>
						{node.text}
					</code>
				);
			case 'ref':
				return (
					<a
						key={i}
						href={node.ref.href}
						target='_blank'
						rel='noreferrer'
						title={node.ref.title}
						className='border-border bg-card hover:bg-muted inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline font-mono text-[0.8em] whitespace-nowrap transition-colors'
					>
						<Icon icon='file-code' size='xs' className='text-muted-foreground shrink-0' />
						{node.ref.label}
					</a>
				);
		}
	});
}

function BlockView({ block, streaming }: { block: Block; streaming?: boolean }) {
	switch (block.type) {
		case 'paragraph':
			return (
				<p className='whitespace-pre-wrap'>
					<Inlines nodes={block.children} streaming={streaming} />
				</p>
			);
		case 'heading': {
			const Tag = `h${block.level}` as 'h1';
			return (
				<Tag className={block.level === 1 ? 'text-xl font-semibold' : 'text-lg font-semibold'}>
					<Inlines nodes={block.children} streaming={streaming} />
				</Tag>
			);
		}
		case 'list': {
			const Tag = block.ordered ? 'ol' : 'ul';
			return (
				<Tag
					start={block.ordered ? block.start : undefined}
					className={`marker:text-muted-foreground flex flex-col gap-1.5 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
				>
					{block.items.map((item, i) => (
						<li key={i} className='pl-1'>
							<Inlines nodes={item} streaming={streaming} />
						</li>
					))}
				</Tag>
			);
		}
		case 'code': {
			const source = (
				<pre className='overflow-x-auto p-3 font-mono text-sm leading-relaxed'>
					<code>{block.text}</code>
				</pre>
			);
			return (
				<div className='border-border bg-card overflow-hidden rounded-xl border'>
					<div className='text-muted-foreground flex items-center justify-between py-1 pr-1 pl-3 text-xs'>
						{/* <span className='font-mono'>{block.lang || 'código'}</span> */}
						<div></div>
						<CopyButton text={block.text} label='Copiar código' />
					</div>
					{/* Só renderiza com o bloco fechado: durante o streaming o código está incompleto. */}
					{block.lang === 'mermaid' && block.closed ? <MermaidDiagram code={block.text} fallback={source} /> : source}
				</div>
			);
		}
		case 'table':
			return (
				<div className='border-border overflow-x-auto rounded-xl border'>
					<table className='w-full text-sm'>
						<thead className='bg-muted/50'>
							<tr>
								{block.head.map((cell, i) => (
									<th key={i} className='border-border border-b px-3 py-2 text-left font-semibold'>
										<Inlines nodes={cell} streaming={streaming} />
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{block.rows.map((row, r) => (
								<tr key={r} className='border-border border-b last:border-0'>
									{row.map((cell, i) => (
										<td key={i} className='px-3 py-2 align-top'>
											<Inlines nodes={cell} streaming={streaming} />
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
	}
}

/** Formata a resposta do agente (markdown) em blocos React. */
export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
	return (
		<div className='flex flex-col gap-3 leading-relaxed'>
			{parseBlocks(text).map((block, i) => (
				<BlockView key={i} block={block} streaming={streaming} />
			))}
		</div>
	);
}
