"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("ada@syncforge.dev");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/auth/login", { email, password });
      router.push("/org");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={onSubmit} className="sf-card w-full max-w-sm p-8 space-y-5">
        <div>
          <h1 className="font-display text-2xl text-forge-ember">Operixa</h1>
          <p className="text-forge-muted text-sm mt-1">Sign in to your workspace</p>
        </div>

        <div className="space-y-2">
          <label className="sf-label" htmlFor="email">Email</label>
          <input id="email" type="email" required className="sf-input w-full" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div className="space-y-2">
          <label className="sf-label" htmlFor="password">Password</label>
          <input id="password" type="password" required className="sf-input w-full" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button type="submit" disabled={loading} className="sf-btn-primary w-full">
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-sm text-forge-muted text-center">
          No account? <Link href="/register" className="text-forge-ember">Create one</Link>
        </p>
        <p className="text-xs text-forge-muted text-center">Demo: ada@syncforge.dev / password123</p>
      </form>
    </div>
  );
}
