import { create } from "zustand";
import { Organization } from "../lib/api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

interface SessionState {
  user: SessionUser | null;
  organizations: Organization[];
  activeOrgId: string | null;
  setUser: (user: SessionUser | null) => void;
  setOrganizations: (orgs: Organization[]) => void;
  setActiveOrg: (orgId: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  organizations: [],
  activeOrgId: null,
  setUser: (user) => set({ user }),
  setOrganizations: (organizations) =>
    set((state) => ({ organizations, activeOrgId: state.activeOrgId ?? organizations[0]?.id ?? null })),
  setActiveOrg: (orgId) => set({ activeOrgId: orgId }),
}));

interface PresenceState {
  onlineUserIds: Set<string>;
  typingByRoom: Record<string, Set<string>>;
  setOnline: (userId: string, online: boolean) => void;
  setTyping: (roomId: string, userId: string, isTyping: boolean) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  onlineUserIds: new Set(),
  typingByRoom: {},
  setOnline: (userId, online) =>
    set((state) => {
      const next = new Set(state.onlineUserIds);
      if (online) next.add(userId);
      else next.delete(userId);
      return { onlineUserIds: next };
    }),
  setTyping: (roomId, userId, isTyping) =>
    set((state) => {
      const roomSet = new Set(state.typingByRoom[roomId] ?? []);
      if (isTyping) roomSet.add(userId);
      else roomSet.delete(userId);
      return { typingByRoom: { ...state.typingByRoom, [roomId]: roomSet } };
    }),
}));
