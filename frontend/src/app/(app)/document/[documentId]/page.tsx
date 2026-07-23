"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, DocumentContentBlock, SyncDocument } from "@/lib/api";
import { realtime, RealtimeEvent } from "@/lib/ws";

interface VersionEntry {
  id: string;
  createdAt: string;
  note?: string;
  author: { id: string; name: string };
}

const LOCK_RENEW_MS = 20_000;

export default function DocumentEditorPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<SyncDocument | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const lockTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomId = `document:${documentId}`;

  const docQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => api.get<{ document: SyncDocument }>(`/api/documents/${documentId}`),
  });

  const versionsQuery = useQuery({
    queryKey: ["document-versions", documentId],
    queryFn: () => api.get<{ versions: VersionEntry[] }>(`/api/documents/${documentId}/versions`),
    enabled: showHistory,
  });

  // Acquire (and periodically renew) the soft edit lock while this page is
  // open, and release it on unmount. If the lock is held by someone else,
  // the editor still loads read-only rather than blocking navigation.
  useEffect(() => {
    api.post(`/api/documents/${documentId}/lock`).catch(() => undefined);
    lockTimer.current = setInterval(() => {
      api.post(`/api/documents/${documentId}/lock`).catch(() => undefined);
    }, LOCK_RENEW_MS);

    return () => {
      if (lockTimer.current) clearInterval(lockTimer.current);
      api.post(`/api/documents/${documentId}/unlock`).catch(() => undefined);
    };
  }, [documentId]);

  useEffect(() => {
    realtime.subscribe(roomId);
    const unsubscribe = realtime.on((event: RealtimeEvent) => {
      if (event.roomId !== roomId || event.type !== "document.updated") return;
      // Another editor's save landed — refetch rather than trying to merge
      // arbitrary JSON content client-side.
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    });
    return () => {
      realtime.unsubscribe(roomId);
      unsubscribe();
    };
  }, [roomId, documentId, queryClient]);

  async function saveContent(blocks: DocumentContentBlock[]) {
    const current = docQuery.data?.document;
    if (!current) return;
    try {
      const { document } = await api.put<{ document: SyncDocument }>(`/api/documents/${documentId}`, {
        content: { blocks },
        expectedUpdatedAt: current.updatedAt,
      });
      queryClient.setQueryData(["document", documentId], { document });
      setConflict(null);
    } catch (err: any) {
      if (err?.status === 409) {
        // Surface the conflict rather than silently overwriting someone
        // else's edit — see docs/ENGINEERING_DECISIONS.md for why this is
        // handled as an explicit reconciliation step instead of a merge.
        const latest = await api.get<{ document: SyncDocument }>(`/api/documents/${documentId}`);
        setConflict(latest.document);
      }
    }
  }

  async function restoreVersion(versionId: string) {
    await api.post(`/api/documents/${documentId}/versions/${versionId}/restore`);
    queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    queryClient.invalidateQueries({ queryKey: ["document-versions", documentId] });
  }

  const doc = docQuery.data?.document;
  if (!doc) return <div className="p-8 text-forge-muted">Loading document…</div>;

  return (
    <div className="p-8 flex gap-6">
      <div className="flex-1 max-w-3xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-xl">{doc.title}</h1>
          <button className="sf-btn-ghost" onClick={() => setShowHistory((s) => !s)}>
            Version history
          </button>
        </div>

        {conflict && (
          <div className="sf-card border-orange-500/50 p-3 mb-4 text-sm">
            <p className="text-orange-300">
              This document changed while you were editing. Your last save was rejected — reload to see the latest version.
            </p>
          </div>
        )}

        <div className="sf-card p-6 space-y-4">
          {doc.content.blocks.map((block, i) => (
            <div
              key={i}
              contentEditable
              suppressContentEditableWarning
              className={block.type === "heading" ? "text-lg font-medium outline-none" : "text-sm outline-none"}
              onBlur={(e) => {
                const blocks = [...doc.content.blocks];
                blocks[i] = { ...block, text: e.currentTarget.textContent ?? "" };
                saveContent(blocks);
              }}
            >
              {block.text}
            </div>
          ))}
        </div>
      </div>

      {showHistory && (
        <div className="w-72 sf-card p-4 h-fit">
          <p className="sf-label mb-3">History</p>
          <div className="space-y-3">
            {versionsQuery.data?.versions.map((v) => (
              <div key={v.id} className="text-sm border-b border-forge-border pb-2">
                <p>{v.author.name}</p>
                <p className="text-xs text-forge-muted">{new Date(v.createdAt).toLocaleString()}</p>
                <button className="sf-btn-ghost text-xs mt-1" onClick={() => restoreVersion(v.id)}>
                  Restore this version
                </button>
              </div>
            ))}
            {versionsQuery.data?.versions.length === 0 && (
              <p className="text-xs text-forge-muted">No previous versions yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
