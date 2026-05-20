"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (opts: {
            client_id: string;
            callback: (resp: { credential?: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            target: HTMLElement,
            opts: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              logo_alignment?: "left" | "center";
              width?: number;
            },
          ) => void;
        };
      };
    };
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

function ensureGisScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("gis_load_failed")), {
        once: true,
      });
      return;
    }
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("gis_load_failed"));
    document.head.appendChild(s);
  });
}

/**
 * Renders Google Identity Services' "Sign in with Google" button. The
 * GIS script invokes our callback with a JWT credential, which we POST to
 * /api/auth/oauth/google.
 *
 * Renders nothing if NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset — keeps the page
 * usable without OAuth configured.
 */
export default function GoogleButton({ mode }: { mode: "signin" | "signup" }) {
  const target = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureGisScript();
        if (cancelled) return;
        const gis = window.google?.accounts?.id;
        if (!gis || !target.current) return;
        gis.initialize({
          client_id: CLIENT_ID,
          callback: async (resp) => {
            if (!resp.credential) return;
            try {
              const res = await fetch("/api/auth/oauth/google", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ idToken: resp.credential }),
                credentials: "include",
              });
              if (!res.ok) {
                setError("Google sign-in failed.");
                return;
              }
              router.replace("/");
              router.refresh();
            } catch {
              setError("Network error.");
            }
          },
        });
        gis.renderButton(target.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: mode === "signup" ? "signup_with" : "signin_with",
          shape: "rectangular",
          logo_alignment: "left",
        });
      } catch {
        setError("Could not load Google sign-in.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, router]);

  if (!CLIENT_ID) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={target} />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
