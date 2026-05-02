import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "plantr_session";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type AuthUser = {
  id: string;
  username: string;
  mustChangePass: boolean;
};

async function fetchUser(token: string): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      method: "GET",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      cache: "no-store",
    });
    if (res.status !== 200) return null;
    const data = (await res.json()) as { user: AuthUser };
    return data.user;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (pathname === "/login") {
    if (!token) return NextResponse.next();
    const user = await fetchUser(token);
    if (!user) {
      const res = NextResponse.next();
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    return NextResponse.redirect(
      new URL(user.mustChangePass ? "/change-password" : "/", req.url),
    );
  }

  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const user = await fetchUser(token);
  if (!user) {
    const res = NextResponse.redirect(new URL("/login", req.url));
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (pathname === "/change-password") {
    if (!user.mustChangePass) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (user.mustChangePass) {
    return NextResponse.redirect(new URL("/change-password", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
