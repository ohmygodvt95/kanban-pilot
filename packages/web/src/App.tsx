import { Navigate, Route, Routes } from 'react-router-dom';
import { TokenGate } from './components/TokenGate';
import { BoardPage } from './pages/BoardPage';
import { IntegrationPage } from './pages/IntegrationPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <>
      <TokenGate />
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/p/:projectId" element={<BoardPage />} />
        <Route path="/p/:projectId/settings" element={<SettingsPage />} />
        <Route path="/p/:projectId/integration" element={<IntegrationPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
