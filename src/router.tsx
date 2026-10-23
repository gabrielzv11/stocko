import { generateId } from 'ai';
import { useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Layout } from './components/layout';
import Home from './features/home';
import { unsentIds } from './features/home/api';
import Login from './features/login';
import Projects from './features/projects';
import ProjectPage from './features/projects/projectPage';
import Settings from './features/settings';
import SharedConversation from './features/shared';
import Usage from './features/usage';
import { getToken } from './lib/auth';

function RequireAuth() {
	return getToken() ? <Layout /> : <Navigate to='/login' replace />;
}

// Cada "Nova conversa" ganha um id já na URL; a conversa só é salva no primeiro envio.
function NewConversation() {
	const [id] = useState(() => {
		const id = generateId();
		unsentIds.add(id);
		return id;
	});
	return <Navigate to={`/c/${id}`} replace />;
}

function ConversationPage() {
	const { id } = useParams();
	return <Home key={id} id={id} />;
}

function Router() {
	return (
		<Routes>
			<Route path='login' element={<Login />} />
			{/* Link público: fora do RequireAuth. */}
			<Route path='s/:token' element={<SharedConversation />} />
			<Route element={<RequireAuth />}>
				<Route index element={<NewConversation />} />
				<Route path='c/:id' element={<ConversationPage />} />
				<Route path='projects' element={<Projects />} />
				<Route path='projects/:id' element={<ProjectPage />} />
				<Route path='usage' element={<Usage />} />
				<Route path='settings' element={<Settings />} />
			</Route>
		</Routes>
	);
}

export { Router };
