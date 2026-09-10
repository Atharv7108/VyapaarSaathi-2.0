import { Navigate } from "react-router-dom";
import { useStore } from "../store/useStore";
import type { UserRole } from "../store/useStore";

interface AuthGuardProps {
  role: UserRole;
  children: React.ReactNode;
}

/** Wraps a route — redirects to the correct login if not authenticated or wrong role. */
export default function AuthGuard({ role, children }: AuthGuardProps) {
  const { isLoggedIn, userRole } = useStore();

  if (!isLoggedIn) {
    return <Navigate to={role === "admin" ? "/admin/login" : "/login"} replace />;
  }

  if (userRole !== role) {
    // Vendor trying to access admin area → go back to vendor app
    // Admin trying to access vendor area → send to admin panel
    return <Navigate to={userRole === "admin" ? "/admin" : "/app"} replace />;
  }

  return <>{children}</>;
}
