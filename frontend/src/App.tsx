import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useStore } from "./store/useStore";
import AuthGuard from "./components/AuthGuard";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import Home from "./pages/Home";
import Ledger from "./pages/Ledger";
import Record from "./pages/Record";
import Insights from "./pages/Insights";
import Profile from "./pages/Profile";
import Onboarding from "./pages/Onboarding";
import Inventory from "./pages/Inventory";

export default function App() {
  const { hasOnboarded } = useStore();

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        {/* ── Public ──────────────────────────────────────────────────────── */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin/login" element={<AdminLogin />} />

        {/* ── Vendor Onboarding (kept inside auth guard) ─────────────────── */}
        <Route
          path="/onboarding"
          element={
            <AuthGuard role="vendor">
              {hasOnboarded ? <Navigate to="/app" replace /> : <Onboarding />}
            </AuthGuard>
          }
        />

        {/* ── Vendor Dashboard ─────────────────────────────────────────────── */}
        <Route
          path="/app"
          element={
            <AuthGuard role="vendor">
              {hasOnboarded ? <Layout /> : <Navigate to="/onboarding" replace />}
            </AuthGuard>
          }
        >
          <Route index element={<Home />} />
          <Route path="ledger"    element={<Ledger />} />
          <Route path="record"    element={<Navigate to="/app/ledger" replace />} />
          <Route path="insights"  element={<Insights />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="profile"   element={<Profile />} />
          <Route path="*"         element={<Navigate to="/app" replace />} />
        </Route>

        {/* ── Admin Dashboard ──────────────────────────────────────────────── */}
        <Route
          path="/admin"
          element={
            <AuthGuard role="admin">
              <AdminDashboard />
            </AuthGuard>
          }
        />

        {/* ── Fallback ─────────────────────────────────────────────────────── */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
