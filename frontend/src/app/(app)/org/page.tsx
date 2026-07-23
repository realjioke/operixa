"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSessionStore } from "@/store/session";

export default function OrgIndexPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { organizations, activeOrgId } = useSessionStore();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (activeOrgId) router.replace(`/org/${activeOrgId}`);
  }, [activeOrgId, router]);

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/api/organizations", { name });
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
    } finally {
      setCreating(false);
    }
  }

  if (organizations.length > 0) {
    return (
      <div className="p-8">
        <p className="sf-label">Loading workspace…</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-md">
      <h1 className="font-display text-xl mb-1">Create your first workspace</h1>
      <p className="text-forge-muted text-sm mb-6">Organizations hold your projects, documents, and team.</p>
      <form onSubmit={createOrg} className="space-y-3">
        <input
          className="sf-input w-full"
          placeholder="Acme Inc."
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button type="submit" disabled={creating} className="sf-btn-primary">
          {creating ? "Creating…" : "Create workspace"}
        </button>
      </form>
    </div>
  );
}
