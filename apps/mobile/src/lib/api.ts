const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export type AuthUser = {
  id: string;
  username: string;
  mustChangePass: boolean;
};

type LoginResult =
  | { ok: true; token: string; user: AuthUser }
  | { ok: false; error: string };

type SimpleResult = { ok: true } | { ok: false; error: string };

async function authFetch(
  path: string,
  init: RequestInit & { token?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

export async function login(username: string, password: string): Promise<LoginResult> {
  try {
    const res = await authFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (res.status !== 200) {
      return { ok: false, error: "invalid_credentials" };
    }
    const data = (await res.json()) as { token: string; user: AuthUser };
    return { ok: true, token: data.token, user: data.user };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function fetchMe(token: string): Promise<AuthUser | null> {
  try {
    const res = await authFetch("/auth/me", { method: "GET", token });
    if (res.status !== 200) return null;
    const data = (await res.json()) as { user: AuthUser };
    return data.user;
  } catch {
    return null;
  }
}

export async function changePassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<SimpleResult> {
  try {
    const res = await authFetch("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
      token,
    });
    if (res.status === 200) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? "unknown" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function logout(token: string): Promise<void> {
  await authFetch("/auth/logout", { method: "POST", token }).catch(() => {});
}
