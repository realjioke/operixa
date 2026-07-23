"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, SyncDocument, Task, TaskStatus } from "@/lib/api";
import { realtime, RealtimeEvent } from "@/lib/ws";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "TODO", label: "To Do" },
  { status: "IN_PROGRESS", label: "In Progress" },
  { status: "IN_REVIEW", label: "In Review" },
  { status: "DONE", label: "Done" },
];

const PRIORITY_COLOR: Record<string, string> = {
  LOW: "bg-forge-border text-forge-muted",
  MEDIUM: "bg-blue-500/20 text-blue-300",
  HIGH: "bg-orange-500/20 text-orange-300",
  URGENT: "bg-red-500/20 text-red-300",
};

export default function ProjectBoardPage() {
  const { projectId } = useParams<{ orgId: string; projectId: string }>();
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [addingTo, setAddingTo] = useState<TaskStatus | null>(null);

  const tasksQuery = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api.get<{ tasks: Task[] }>(`/api/tasks/project/${projectId}`),
  });

  const roomId = `project:${projectId}`;

  // Subscribe to this project's room and reconcile every task.* event into
  // the React Query cache directly — this is what makes a change one user
  // makes appear live for everyone else viewing the same board, with no
  // polling involved.
  useEffect(() => {
    realtime.subscribe(roomId);
    const unsubscribe = realtime.on((event: RealtimeEvent) => {
      if (event.roomId !== roomId) return;

      queryClient.setQueryData<{ tasks: Task[] }>(["tasks", projectId], (old) => {
        if (!old) return old;
        const task = event.payload as Task;

        if (event.type === "task.created") {
          if (old.tasks.some((t) => t.id === task.id)) return old;
          return { tasks: [...old.tasks, task] };
        }
        if (event.type === "task.updated") {
          return { tasks: old.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)) };
        }
        if (event.type === "task.deleted") {
          const deletedId = (event.payload as { id: string }).id;
          return { tasks: old.tasks.filter((t) => t.id !== deletedId) };
        }
        return old;
      });
    });

    return () => {
      realtime.unsubscribe(roomId);
      unsubscribe();
    };
  }, [roomId, projectId, queryClient]);

  async function createTask(status: TaskStatus) {
    if (!newTitle.trim()) return;
    // Optimistic local update happens implicitly: we don't wait for the
    // realtime echo before clearing the form, and the POST response plus
    // the task.created broadcast reconcile the cache moments later.
    await api.post("/api/tasks", { projectId, title: newTitle, status });
    setNewTitle("");
    setAddingTo(null);
  }

  async function moveTask(task: Task, newStatus: TaskStatus) {
    const previous = queryClient.getQueryData<{ tasks: Task[] }>(["tasks", projectId]);
    queryClient.setQueryData<{ tasks: Task[] }>(["tasks", projectId], (old) =>
      old ? { tasks: old.tasks.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t)) } : old,
    );
    try {
      await api.patch(`/api/tasks/${task.id}`, { status: newStatus });
    } catch {
      queryClient.setQueryData(["tasks", projectId], previous); // roll back on failure
    }
  }

  const tasks = tasksQuery.data?.tasks ?? [];

  const documentsQuery = useQuery({
    queryKey: ["documents", projectId],
    queryFn: () => api.get<{ documents: SyncDocument[] }>(`/api/documents/project/${projectId}`).catch(() => ({ documents: [] })),
  });

  async function createDocument() {
    const { document } = await api.post<{ document: SyncDocument }>("/api/documents", {
      projectId,
      title: "Untitled document",
      content: { blocks: [{ type: "heading", text: "Untitled document" }, { type: "paragraph", text: "" }] },
    });
    window.location.href = `/document/${document.id}`;
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-3">
        <p className="sf-label">Documents</p>
        <button className="sf-btn-ghost" onClick={createDocument}>+ New document</button>
      </div>
      <div className="flex gap-2 flex-wrap mb-8">
        {documentsQuery.data?.documents.map((d) => (
          <Link key={d.id} href={`/document/${d.id}`} className="sf-card px-3 py-2 text-sm hover:border-forge-ember">
            {d.title}
          </Link>
        ))}
      </div>

      <h1 className="font-display text-xl mb-6">Board</h1>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {COLUMNS.map((col) => (
          <div key={col.status} className="sf-card p-3 min-h-[300px]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const taskId = e.dataTransfer.getData("text/task-id");
              const task = tasks.find((t) => t.id === taskId);
              if (task && task.status !== col.status) moveTask(task, col.status);
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="sf-label">{col.label}</p>
              <span className="text-xs text-forge-muted">{tasks.filter((t) => t.status === col.status).length}</span>
            </div>

            <div className="space-y-2">
              {tasks
                .filter((t) => t.status === col.status)
                .map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/task-id", task.id)}
                    className="bg-forge-bg border border-forge-border rounded-md p-3 cursor-grab active:cursor-grabbing"
                  >
                    <p className="text-sm">{task.title}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${PRIORITY_COLOR[task.priority]}`}>
                        {task.priority}
                      </span>
                      {task.assignee && (
                        <span className="text-[10px] text-forge-muted">{task.assignee.name}</span>
                      )}
                    </div>
                  </div>
                ))}
            </div>

            {addingTo === col.status ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createTask(col.status);
                }}
                className="mt-2"
              >
                <input
                  autoFocus
                  className="sf-input w-full text-sm"
                  placeholder="Task title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onBlur={() => !newTitle && setAddingTo(null)}
                />
              </form>
            ) : (
              <button
                className="sf-btn-ghost mt-2 text-xs"
                onClick={() => setAddingTo(col.status)}
              >
                + Add task
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
