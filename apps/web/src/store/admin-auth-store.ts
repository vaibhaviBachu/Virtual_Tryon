import { create } from "zustand";

/**
 * Admin session state for the catalogue UI. Deliberately in-memory only (no
 * localStorage/cookies) — Milestone 2's auth scope is intentionally minimal (login +
 * /me, see apps/api/v1/routers/auth.py), and a full "remember me" session strategy is a
 * Milestone 7 concern. This means a page refresh logs the admin out, which is an honest
 * tradeoff for now, not a hidden limitation — see docs/milestone-2-verification.md.
 */
interface AdminAuthState {
  token: string | null;
  email: string | null;
  role: string | null;
  setSession: (token: string, email: string, role: string) => void;
  clearSession: () => void;
}

export const useAdminAuthStore = create<AdminAuthState>((set) => ({
  token: null,
  email: null,
  role: null,
  setSession: (token, email, role) => set({ token, email, role }),
  clearSession: () => set({ token: null, email: null, role: null }),
}));
