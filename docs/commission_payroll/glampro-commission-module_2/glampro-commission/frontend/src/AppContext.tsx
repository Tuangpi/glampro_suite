/** App-wide context: API client, current user (role), staff list, toast. */
import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import { Actor, CommissionApi, HttpApi, Role } from './api/client';
import { DemoApi } from './api/demoApi';
import type { StaffOption } from './components/SplitEditor';

interface Ctx {
  api: CommissionApi;
  actor: Actor;
  setRole: (r: Role) => void;
  staff: StaffOption[];
  setStaff: (s: StaffOption[]) => void;
  toast: (msg: string) => void;
}
const AppCtx = createContext<Ctx | null>(null);

// TODO(Glampro): take salonId / userId / role from the logged-in session instead of these demo values.
const DEMO_ACTOR: Actor = { salonId: 'salon_eurosense', userId: 'u_kenny', role: 'SUPER_ADMIN' };

export function AppProvider({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState<Actor>(DEMO_ACTOR);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const actorRef = useMemo(() => ({ current: actor }), []); // eslint-disable-line react-hooks/exhaustive-deps
  actorRef.current = actor;
  const api = useMemo<CommissionApi>(() => {
    const url = import.meta.env.VITE_API_URL as string | undefined;
    return url ? new HttpApi(url.replace(/\/$/, ''), () => actorRef.current) : new DemoApi(() => actorRef.current);
  }, [actorRef]);
  const toast = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2600); };
  return (
    <AppCtx.Provider value={{ api, actor, setRole: (role) => setActor({ ...actor, role }), staff, setStaff, toast }}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp must be inside AppProvider');
  return c;
}
