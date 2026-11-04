import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useAuth } from './lib/auth';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Overview from './pages/Overview';
import LiveMap from './pages/LiveMap';
import Sites from './pages/Sites';
import SiteDetail from './pages/SiteDetail';
import EnergyAnalytics from './pages/EnergyAnalytics';
import PVPerformance from './pages/PVPerformance';
import BESSAnalytics from './pages/BESSAnalytics';
import GridGenerator from './pages/GridGenerator';
import LoadAnalysis from './pages/LoadAnalysis';
import Alarms from './pages/Alarms';
import Events from './pages/Events';
import Reports from './pages/Reports';
import Gateways from './pages/Gateways';
import Devices from './pages/Devices';
import ModbusMapping from './pages/ModbusMapping';
import Users from './pages/Users';
import AuditTrail from './pages/AuditTrail';
import Settings from './pages/Settings';
import SystemHealth from './pages/SystemHealth';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="boot"><Spinner label="Establishing secure session…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  const routes = (
    <Routes>
      <Route path="/login" element={import.meta.env.VITE_STATIC_DEMO === 'true' ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<Protected><Overview /></Protected>} />
      <Route path="/map" element={<Protected><LiveMap /></Protected>} />
      <Route path="/sites" element={<Protected><Sites /></Protected>} />
      <Route path="/sites/:id" element={<Protected><SiteDetail /></Protected>} />
      <Route path="/analytics" element={<Protected><EnergyAnalytics /></Protected>} />
      <Route path="/pv" element={<Protected><PVPerformance /></Protected>} />
      <Route path="/bess" element={<Protected><BESSAnalytics /></Protected>} />
      <Route path="/grid" element={<Protected><GridGenerator /></Protected>} />
      <Route path="/load" element={<Protected><LoadAnalysis /></Protected>} />
      <Route path="/alarms" element={<Protected><Alarms /></Protected>} />
      <Route path="/events" element={<Protected><Events /></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/gateways" element={<Protected><Gateways /></Protected>} />
      <Route path="/devices" element={<Protected><Devices /></Protected>} />
      <Route path="/modbus" element={<Protected><ModbusMapping /></Protected>} />
      <Route path="/users" element={<Protected><Users /></Protected>} />
      <Route path="/audit" element={<Protected><AuditTrail /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="/system" element={<Protected><SystemHealth /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
  return routes;
}
