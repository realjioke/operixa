"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, Organization } from "@/lib/api";
import { realtime } from "@/lib/ws";
import { useSessionStore } from "@/store/session";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, setUser, organizations, setOrganizations, activeOrgId, setActiveOrg } = useSessionStore();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: typeof user }>("/api/auth/me"),
    retry: false,
  });

  const orgsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: () => api.get<{ organizations: Organization[] }>("/api/organizations"),
    enabled: Boolean(meQuery.data),
  });

  useEffect(() => {
    if (meQuery.isError) router.replace("/login");
  }, [meQuery.isError, router]);

  useEffect(() => {
    if (meQuery.data?.user) setUser(meQuery.data.user as any);
  }, [meQuery.data, setUser]);

  useEffect(() => {
    if (orgsQuery.data) setOrganizations(orgsQuery.data.organizations);
  }, [orgsQuery.data, setOrganizations]);

  // A single websocket connection for the whole authenticated app shell,
  // torn down on logout/unmount. Individual pages subscribe/unsubscribe to
  // the specific rooms they care about (see the kanban board and document editor).
  useEffect(() => {
    if (!user) return;
    realtime.connect();
    return () => realtime.disconnect();
  }, [user]);

  async function logout() {
    await api.post("/api/auth/logout");
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r border-forge-border flex flex-col">
        <div className="p-4 border-b border-forge-border">
          <span className="font-display text-forge-ember text-lg">Operixa</span>
        </div>

        <div className="p-3">
          <p className="sf-label mb-2">Workspace</p>
          <select
            className="sf-input w-full"
            value={activeOrgId ?? ""}
            onChange={(e) => setActiveOrg(e.target.value)}
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {activeOrgId && (
            <Link href={`/org/${activeOrgId}`} className="block text-sm px-2 py-1.5 rounded hover:bg-forge-surface">
              Projects
            </Link>
          )}
        </nav>

        <div className="p-3 border-t border-forge-border flex items-center justify-between">
          <span className="text-sm truncate">{user?.name ?? "…"}</span>
          <button onClick={logout} className="sf-btn-ghost">
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
