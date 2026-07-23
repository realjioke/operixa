"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    api
      .get("/api/auth/me")
      .then(() => router.replace("/org"))
      .catch(() => router.replace("/login"));
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="sf-label">Loading Operixa…</p>
    </div>
  );
}
