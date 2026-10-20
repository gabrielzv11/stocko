import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './header';
import { isMobile, Sidebar } from './sidebar';

function Layout() {
	// Desktop: recolhida = trilho de ícones. Mobile: recolhida = escondida; aberta = drawer que empurra o conteúdo.
	const [collapsed, setCollapsed] = useState(isMobile);

	return (
		<div className='flex h-dvh overflow-hidden'>
			<Sidebar collapsed={collapsed} onCollapsedChange={setCollapsed} />
			<div className='flex min-w-full flex-1 flex-col overflow-hidden md:min-w-0'>
				<Header onMenuClick={() => setCollapsed((c) => !c)} />
				<main className='min-h-0 flex-1 overflow-auto'>
					<Outlet />
				</main>
			</div>
		</div>
	);
}

export { Layout };
