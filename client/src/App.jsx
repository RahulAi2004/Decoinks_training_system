import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/intern/Home';
import Study from './pages/intern/Study';
import Practice from './pages/intern/Practice';
import Scenarios from './pages/intern/Scenarios';
import Quiz from './pages/intern/Quiz';
import Progress from './pages/intern/Progress';
import Dashboard from './pages/admin/Dashboard';
import Content from './pages/admin/Content';
import Interns from './pages/admin/Interns';
import InternDetail from './pages/admin/InternDetail';
import Review from './pages/admin/Review';
import Readiness from './pages/admin/Readiness';
import Settings from './pages/admin/Settings';
import AiChat from './pages/admin/AiChat';
import Prompts from './pages/admin/Prompts';
import { Spinner } from './components/ui';

function Guard({ role, children }) {
  const { user } = useAuth();
  if (user === undefined) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/'} replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Guard role="intern"><Layout /></Guard>}>
            <Route path="/" element={<Home />} />
            <Route path="/study" element={<Study />} />
            <Route path="/practice" element={<Practice />} />
            <Route path="/scenarios" element={<Scenarios />} />
            <Route path="/quiz" element={<Quiz />} />
            <Route path="/progress" element={<Progress />} />
          </Route>
          <Route element={<Guard role="admin"><Layout /></Guard>}>
            <Route path="/admin" element={<Dashboard />} />
            <Route path="/admin/ai-chat" element={<AiChat />} />
            <Route path="/admin/prompts" element={<Prompts />} />
            <Route path="/admin/content" element={<Content />} />
            <Route path="/admin/interns" element={<Interns />} />
            <Route path="/admin/interns/:id" element={<InternDetail />} />
            <Route path="/admin/review" element={<Review />} />
            <Route path="/admin/readiness" element={<Readiness />} />
            <Route path="/admin/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
