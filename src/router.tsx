import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/layout';
import Home from './features/home';
import Login from './features/login';
import Projects from './features/projects';
import { getToken } from './lib/auth';

function RequireAuth() {
	return getToken() ? <Layout /> : <Navigate to='/login' replace />;
}

function Router() {
	return (
		<Routes>
			<Route path='login' element={<Login />} />
			<Route element={<RequireAuth />}>
				<Route index element={<Home />} />
				<Route path='projects' element={<Projects />} />
			</Route>
		</Routes>
	);
}

export { Router };
