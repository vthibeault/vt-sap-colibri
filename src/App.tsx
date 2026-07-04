import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { useAuth } from '@/state/AuthContext';
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Projects } from '@/pages/Projects';
import { ProjectDetail } from '@/pages/ProjectDetail';
import { BrandStudio } from '@/pages/BrandStudio';
import { Integration } from '@/pages/Integration';

function Splash() {
  return (
    <div className="login">
      <div className="rise" style={{ textAlign: 'center', color: 'var(--text-3)' }}>
        <div className="logo-mark" style={{ margin: '0 auto 14px' }}>·</div>
        Connecting…
      </div>
    </div>
  );
}

export function App() {
  const { user, restoring } = useAuth();

  if (restoring) return <Splash />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/studio" element={<BrandStudio />} />
        <Route path="/integration" element={<Integration />} />
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
