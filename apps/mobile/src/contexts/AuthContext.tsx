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
  completeProfile as apiCompleteProfile,
  fetchMe as apiFetchMe,
  login as apiLogin,
  logout as apiLogout,
  oauthApple as apiOAuthApple,
  oauthGoogle as apiOAuthGoogle,
  signup as apiSignup,
  type AuthUser,
} from "../lib/api";
import { clearToken, loadToken, saveToken } from "../lib/storage";

type AuthState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "authed"; token: string; user: AuthUser };

type Result = { ok: true } | { ok: false; error: string };

type AuthContextValue = {
  state: AuthState;
  signIn: (identifier: string, password: string) => Promise<Result>;
  signUp: (email: string, password: string, name?: string) => Promise<Result>;
  signInWithAppleToken: (
    identityToken: string,
    fullName?: { givenName: string | null; familyName: string | null } | null,
  ) => Promise<Result>;
  signInWithGoogleToken: (idToken: string) => Promise<Result>;
  signOut: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<Result>;
  completeProfile: (body: {
    email: string;
    name?: string;
    newPassword?: string;
  }) => Promise<Result>;
  refreshUser: () => Promise<void>;
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

  const acceptSession = useCallback(async (token: string, user: AuthUser) => {
    await saveToken(token);
    setState({ status: "authed", token, user });
  }, []);

  const signIn = useCallback(
    async (identifier: string, password: string): Promise<Result> => {
      const result = await apiLogin(identifier, password);
      if (!result.ok) return { ok: false, error: result.error };
      await acceptSession(result.data.token, result.data.user);
      return { ok: true };
    },
    [acceptSession],
  );

  const signUp = useCallback(
    async (email: string, password: string, name?: string): Promise<Result> => {
      const result = await apiSignup(email, password, name);
      if (!result.ok) return { ok: false, error: result.error };
      await acceptSession(result.data.token, result.data.user);
      return { ok: true };
    },
    [acceptSession],
  );

  const signInWithAppleToken = useCallback(
    async (
      identityToken: string,
      fullName?: { givenName: string | null; familyName: string | null } | null,
    ): Promise<Result> => {
      const result = await apiOAuthApple(identityToken, fullName);
      if (!result.ok) return { ok: false, error: result.error };
      await acceptSession(result.data.token, result.data.user);
      return { ok: true };
    },
    [acceptSession],
  );

  const signInWithGoogleToken = useCallback(
    async (idToken: string): Promise<Result> => {
      const result = await apiOAuthGoogle(idToken);
      if (!result.ok) return { ok: false, error: result.error };
      await acceptSession(result.data.token, result.data.user);
      return { ok: true };
    },
    [acceptSession],
  );

  const signOut = useCallback(async () => {
    if (state.status === "authed") await apiLogout(state.token);
    await clearToken();
    setState({ status: "anon" });
  }, [state]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<Result> => {
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

  const completeProfile = useCallback(
    async (body: {
      email: string;
      name?: string;
      newPassword?: string;
    }): Promise<Result> => {
      if (state.status !== "authed") return { ok: false, error: "not_authed" };
      const result = await apiCompleteProfile(state.token, body);
      if (!result.ok) return { ok: false, error: result.error };
      setState({ status: "authed", token: state.token, user: result.data.user });
      return { ok: true };
    },
    [state],
  );

  const refreshUser = useCallback(async () => {
    if (state.status !== "authed") return;
    const refreshed = await apiFetchMe(state.token);
    if (refreshed) setState({ status: "authed", token: state.token, user: refreshed });
  }, [state]);

  const value = useMemo(
    () => ({
      state,
      signIn,
      signUp,
      signInWithAppleToken,
      signInWithGoogleToken,
      signOut,
      changePassword,
      completeProfile,
      refreshUser,
    }),
    [
      state,
      signIn,
      signUp,
      signInWithAppleToken,
      signInWithGoogleToken,
      signOut,
      changePassword,
      completeProfile,
      refreshUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
