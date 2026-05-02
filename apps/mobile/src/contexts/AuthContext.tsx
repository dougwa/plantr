import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  changePassword as apiChangePassword,
  fetchMe as apiFetchMe,
  login as apiLogin,
  logout as apiLogout,
  type AuthUser,
} from "../lib/api";
import { clearToken, loadToken, saveToken } from "../lib/storage";

type AuthState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "authed"; token: string; user: AuthUser };

type AuthContextValue = {
  state: AuthState;
  signIn: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<{ ok: boolean; error?: string }>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    (async () => {
      const token = await loadToken();
      if (!token) {
        setState({ status: "anon" });
        return;
      }
      const user = await apiFetchMe(token);
      if (!user) {
        await clearToken();
        setState({ status: "anon" });
        return;
      }
      setState({ status: "authed", token, user });
    })();
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const result = await apiLogin(username, password);
    if (!result.ok) return { ok: false, error: result.error };
    await saveToken(result.token);
    setState({ status: "authed", token: result.token, user: result.user });
    return { ok: true };
  }, []);

  const signOut = useCallback(async () => {
    if (state.status === "authed") {
      await apiLogout(state.token);
    }
    await clearToken();
    setState({ status: "anon" });
  }, [state]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (state.status !== "authed") return { ok: false, error: "not_authed" };
      const result = await apiChangePassword(state.token, currentPassword, newPassword);
      if (!result.ok) return { ok: false, error: result.error };
      const refreshed = await apiFetchMe(state.token);
      if (refreshed) {
        setState({ status: "authed", token: state.token, user: refreshed });
      }
      return { ok: true };
    },
    [state],
  );

  const value = useMemo(
    () => ({ state, signIn, signOut, changePassword }),
    [state, signIn, signOut, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
