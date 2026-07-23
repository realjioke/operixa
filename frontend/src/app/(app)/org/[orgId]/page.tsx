"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Project } from "@/lib/api";

export default function OrgProjectsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [showForm, setShowForm] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ["projects", orgId],
    queryFn: () => api.get<{ projects: Project[] }>(`/api/projects/organization/${orgId}`),
  });

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/api/projects", { organizationId: orgId, name });
    setName("");
    setShowForm(false);
    queryClient.invalidateQueries({ queryKey: ["projects", orgId] });
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-xl">Projects</h1>
        <button className="sf-btn-primary" onClick={() => setShowForm((s) => !s)}>
          New project
        </button>
      </div>

      {showForm && (
        <form onSubmit={createProject} className="sf-card p-4 mb-6 flex gap-3">
          <input
            autoFocus
            className="sf-input flex-1"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button type="submit" className="sf-btn-primary">
            Create
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projectsQuery.data?.projects.map((project) => (
          <Link
            key={project.id}
            href={`/org/${orgId}/project/${project.id}`}
            className="sf-card p-4 block hover:border-forge-ember transition"
          >
            <p className="font-medium">{project.name}</p>
            {project.description && <p className="text-sm text-forge-muted mt-1 line-clamp-2">{project.description}</p>}
            <span className="sf-label mt-3 inline-block">{project.status}</span>
          </Link>
        ))}
        {projectsQuery.data?.projects.length === 0 && (
          <p className="text-forge-muted text-sm">No projects yet — create one to get started.</p>
        )}
      </div>
    </div>
  );
}
