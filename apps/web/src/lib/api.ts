export const SESSION_COOKIE = "plantr_session";

const SERVER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type AuthUser = {
  id: string;
  username: string;
  mustChangePass: boolean;
};

export async function fetchMeServerSide(cookieHeader: string | undefined): Promise<AuthUser | null> {
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${SERVER_API_URL}/auth/me`, {
      method: "GET",
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (res.status !== 200) return null;
    const data = (await res.json()) as { user: AuthUser };
    return data.user;
  } catch {
    return null;
  }
}
