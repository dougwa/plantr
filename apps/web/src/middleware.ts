import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "plantr_session";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type AuthUser = {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  mustChangePass: boolean;
  mustCompleteProfile: boolean;
};

const PUBLIC_PATHS = new Set(["/login", "/signup"]);

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

  // Public auth pages: send already-signed-in users home.
  if (PUBLIC_PATHS.has(pathname)) {
    if (!token) return NextResponse.next();
    const user = await fetchUser(token);
    if (!user) {
      const res = NextResponse.next();
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    return NextResponse.redirect(new URL(nextStepFor(user), req.url));
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

  // Step pages can only be visited when that step is the active one.
  if (pathname === "/change-password") {
    if (!user.mustChangePass) {
      return NextResponse.redirect(new URL(nextStepFor(user), req.url));
    }
    return NextResponse.next();
  }
  if (pathname === "/complete-profile") {
    if (!user.mustCompleteProfile) {
      return NextResponse.redirect(new URL(nextStepFor(user), req.url));
    }
    return NextResponse.next();
  }

  // For everything else: force the user through any pending step first.
  const next = nextStepFor(user);
  if (next !== "/") {
    return NextResponse.redirect(new URL(next, req.url));
  }
  return NextResponse.next();
}

function nextStepFor(user: AuthUser): string {
  if (user.mustChangePass) return "/change-password";
  if (user.mustCompleteProfile) return "/complete-profile";
  return "/";
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
