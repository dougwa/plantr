"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GoogleButton from "../GoogleButton";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: name.trim() || undefined,
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          body.error === "email_taken"
            ? "An account with that email already exists."
            : "Could not create account.",
        );
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
        >
          <h1 className="text-2xl font-semibold">Create your PlantR account</h1>
          <div className="space-y-1">
            <label htmlFor="name" className="block text-sm text-neutral-700">
              Name (optional)
            </label>
            <input
              id="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-500"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="email" className="block text-sm text-neutral-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-500"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="password" className="block text-sm text-neutral-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-50"
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>
          <p className="text-center text-sm text-neutral-600">
            Already have an account?{" "}
            <Link href="/login" className="text-neutral-900 underline">
              Sign in
            </Link>
          </p>
        </form>
        <GoogleButton mode="signup" />
      </div>
    </main>
  );
}
