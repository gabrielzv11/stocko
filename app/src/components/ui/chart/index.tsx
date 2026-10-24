import { cn } from '@/lib/cn';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts-for-react/lib/types';
import { useMemo } from 'react';

// Só os módulos usados entram no bundle (remote do Module Federation). Novo tipo de gráfico → registrar aqui.
echarts.use([BarChart, GridComponent, TooltipComponent, SVGRenderer]);

/** Tema a partir dos tokens do globals.css; o renderer SVG aceita oklch direto. */
function tokensTheme() {
	const css = getComputedStyle(document.documentElement);
	const token = (name: string) => css.getPropertyValue(name).trim();
	const muted = token('--muted-foreground');
	const border = token('--border');
	return {
		color: [token('--primary')],
		backgroundColor: 'transparent',
		textStyle: { color: muted, fontFamily: css.getPropertyValue('--font-body').trim() || 'sans-serif' },
		grid: { left: 8, right: 8, top: 16, bottom: 8 },
		categoryAxis: {
			axisLine: { lineStyle: { color: border } },
			axisTick: { show: false },
			axisLabel: { color: muted },
			splitLine: { show: false },
		},
		valueAxis: {
			axisLine: { show: false },
			axisLabel: { color: muted },
			splitLine: { lineStyle: { color: border } },
		},
		tooltip: {
			backgroundColor: token('--muted'),
			borderColor: border,
			textStyle: { color: token('--foreground') },
			extraCssText: 'border-radius: 8px;',
		},
	};
}

interface ChartProps {
	option: EChartsOption;
	/** Altura em px; a largura acompanha o container. */
	height?: number;
	className?: string;
	/** Descrição para leitor de tela (o SVG em si não é legível). */
	label: string;
}

function Chart({ option, height = 240, className, label }: ChartProps) {
	const theme = useMemo(tokensTheme, []);
	return (
		<div role='img' aria-label={label} className={cn('w-full', className)}>
			<ReactEChartsCore echarts={echarts} option={option} theme={theme} opts={{ renderer: 'svg' }} style={{ height }} />
		</div>
	);
}

export { Chart };
export type { EChartsOption };
