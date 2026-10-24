import { Chart } from '@/components/ui/chart';
import { day as dayjs } from '@/lib/dayjs';
import { useUsage, type Sum, type Usage } from './api';

const usd = (n: number) =>
	n.toLocaleString('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: n && n < 1 ? 4 : 2 });
const tokens = (n: number) => n.toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
	return (
		<div className='border-card-border bg-card rounded-2xl border p-4'>
			<p className='text-muted-foreground text-sm'>{label}</p>
			<p className='mt-1 text-2xl font-semibold tabular-nums'>{value}</p>
			{hint && <p className='text-muted-foreground mt-0.5 text-xs'>{hint}</p>}
		</div>
	);
}

/** Custo por dia, com os dias sem uso preenchidos com zero. */
function DailyCost({ data }: { data: Usage }) {
	const byDay = new Map(data.byDay.map((d) => [d.day, d]));
	const days = Array.from({ length: data.days }, (_, i) => {
		const day = dayjs()
			.subtract(data.days - 1 - i, 'day')
			.format('YYYY-MM-DD');
		return { day, cost: byDay.get(day)?.cost ?? 0, tokens: (byDay.get(day)?.inputTokens ?? 0) + (byDay.get(day)?.outputTokens ?? 0) };
	});
	const max = Math.max(...days.map((d) => d.cost));

	return (
		<section className='border-card-border bg-card rounded-2xl border p-4'>
			<h2 className='text-base font-semibold'>Custo por dia</h2>
			<p className='text-muted-foreground text-xs'>Máximo no período: {usd(max)}</p>

			<Chart
				className='mt-2'
				height={200}
				label='Gráfico de custo por dia; tabela abaixo'
				option={{
					// Tooltip por coluna inteira (sombra): alvo de hover maior que a barra.
					tooltip: {
						trigger: 'axis',
						axisPointer: { type: 'shadow' },
						formatter: ([p]: { dataIndex: number }[]) => {
							const d = days[p!.dataIndex]!;
							return `${dayjs(d.day).format('DD/MM')}<br/><b>${usd(d.cost)}</b><br/>${tokens(d.tokens)} tokens`;
						},
					},
					xAxis: { type: 'category', data: days.map((d) => dayjs(d.day).format('DD/MM')) },
					yAxis: { type: 'value', axisLabel: { formatter: (v: number) => usd(v) } },
					series: [
						{
							type: 'bar',
							data: days.map((d) => d.cost),
							barCategoryGap: '20%',
							itemStyle: { borderRadius: [4, 4, 0, 0], opacity: 0.7 },
							emphasis: { itemStyle: { opacity: 1 } },
						},
					],
				}}
			/>

			<details className='mt-3 text-sm'>
				<summary className='text-muted-foreground cursor-pointer'>Ver tabela</summary>
				<table className='mt-2 w-full tabular-nums'>
					<thead className='text-muted-foreground text-left'>
						<tr>
							<th className='font-normal'>Dia</th>
							<th className='text-right font-normal'>Tokens</th>
							<th className='text-right font-normal'>Custo</th>
						</tr>
					</thead>
					<tbody>
						{days
							.filter((d) => d.cost || d.tokens)
							.map((d) => (
								<tr key={d.day}>
									<td>{dayjs(d.day).format('DD/MM')}</td>
									<td className='text-right'>{tokens(d.tokens)}</td>
									<td className='text-right'>{usd(d.cost)}</td>
								</tr>
							))}
					</tbody>
				</table>
			</details>
		</section>
	);
}

/** Ranking por custo; a barrinha mostra a fatia do maior item. */
function Breakdown({ title, rows, empty }: { title: string; rows: ({ key: string; label: string } & Sum)[]; empty: string }) {
	const max = rows[0]?.cost ?? 0;
	return (
		<section className='border-card-border bg-card rounded-2xl border p-4'>
			<h2 className='text-base font-semibold'>{title}</h2>
			{!rows.length && <p className='text-muted-foreground mt-2 text-sm'>{empty}</p>}
			<ul className='mt-3 flex flex-col gap-3'>
				{rows.map((r) => (
					<li key={r.key} className='text-sm'>
						<div className='flex items-baseline justify-between gap-3'>
							<span className='truncate'>{r.label}</span>
							<span className='shrink-0 font-medium tabular-nums'>{usd(r.cost)}</span>
						</div>
						<div className='mt-1 flex items-center gap-2'>
							<div className='bg-muted h-1 flex-1 rounded-full'>
								<div className='bg-primary/70 h-full rounded-full' style={{ width: max ? `${(r.cost / max) * 100}%` : 0 }} />
							</div>
							<span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
								{tokens(r.inputTokens + r.outputTokens)} tokens · {r.turns} resp.
							</span>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}

export default function UsagePage() {
	const { data, isPending, isError, dataUpdatedAt } = useUsage();

	if (isPending) return <p className='text-muted-foreground p-6 text-sm'>Carregando uso...</p>;
	if (isError) return <p className='p-6 text-sm text-red-500'>Não foi possível carregar o uso.</p>;

	const { totals } = data;
	return (
		<div className='mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6'>
			<div>
				<h1 className='text-2xl font-semibold'>Uso de tokens</h1>
				<p className='text-muted-foreground text-sm'>
					Últimos {data.days} dias · atualizado {dayjs(dataUpdatedAt).format('HH:mm')}
				</p>
			</div>

			<p role='note' className='rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm'>
				Cálculo ainda impreciso para provedores diferentes do OpenRouter: o Mangaba Router não informa o custo (entra como US$ 0) e a contagem
				de tokens depende do que o provedor reporta.
			</p>

			<div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
				<Stat label='Custo' value={usd(totals.cost)} hint={`${totals.turns} respostas`} />
				<Stat label='Tokens de entrada' value={tokens(totals.inputTokens)} />
				<Stat label='Tokens de saída' value={tokens(totals.outputTokens)} />
				<Stat
					label='Entrada do cache'
					value={tokens(totals.cachedTokens)}
					hint={totals.inputTokens ? `${Math.round((totals.cachedTokens / totals.inputTokens) * 100)}% da entrada` : undefined}
				/>
			</div>

			<DailyCost data={data} />

			<div className='grid gap-4 lg:grid-cols-3'>
				<Breakdown title='Por modelo' empty='Nenhum uso ainda.' rows={data.byModel.map((m) => ({ ...m, key: m.model, label: m.model }))} />
				<Breakdown
					title='Por projeto'
					empty='Nenhuma conversa vinculada a projeto.'
					rows={data.byProject.map((p) => ({ ...p, key: p.id, label: p.name }))}
				/>
				<Breakdown
					title='Conversas mais caras'
					empty='Nenhuma conversa ainda.'
					rows={data.byConversation.map((c) => ({ ...c, key: c.id, label: c.title }))}
				/>
			</div>
		</div>
	);
}
