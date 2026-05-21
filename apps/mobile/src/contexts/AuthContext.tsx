import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  changePassword as apiChangePassword,
  completeProfile as apiCompleteProfile,
  fetchMe as apiFetchMe,
  listSites as apiListSites,
  login as apiLogin,
  logout as apiLogout,
  oauthApple as apiOAuthApple,
  oauthGoogle as apiOAuthGoogle,
  setCurrentSiteId as apiSetCurrentSiteId,
  signup as apiSignup,
  type AuthUser,
  type SiteSummary,
} from "../lib/api";
import {
  clearToken,
  loadCurrentSiteId,
  loadToken,
  saveCurrentSiteId,
  saveToken,
} from "../lib/storage";

type AuthState =
  | { status: "loading" }
  | { status: "anon" }
  | {
      status: "authed";
      token: string;
      user: AuthUser;
      currentSiteId: string | null;
      sites: SiteSummary[];
    };

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
  refreshSites: () => Promise<void>;
  setCurrentSite: (siteId: string | null) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Pick a sensible default site: prefer one the user owns, then any membership.
 * Returns null when the user has no memberships (fresh signups land here until
 * they create or join a site).
 */
function pickDefaultSite(sites: SiteSummary[]): string | null {
  const owned = sites.find((s) => s.role === "OWNER");
  if (owned) return owned.id;
  return sites[0]?.id ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  // Mirror the latest state so callbacks can read it without listing `state`
  // as a dep — otherwise every setState invalidates the callbacks and any
  // effect that lists them in deps will loop.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Sync the api module's current-site singleton during render (not in an
  // effect) so any child screen's mount effects see the correct site. Effects
  // run child-first, so deferring this to useEffect lets a child like
  // MapScreen call site-scoped APIs before the api module has the id, which
  // throws no_site_selected and leaves the screen stuck in its loading state.
  if (state.status === "authed") {
    apiSetCurrentSiteId(state.currentSiteId);
  } else {
    apiSetCurrentSiteId(null);
  }

  // Persistence stays in an effect — SecureStore is async and not on the
  // critical path for child renders.
  useEffect(() => {
    if (state.status === "authed") {
      saveCurrentSiteId(state.currentSiteId).catch(() => {});
    }
  }, [state]);

  const loadSitesAndAccept = useCallback(
    async (token: string, user: AuthUser, preferredSiteId: string | null): Promise<void> => {
      const sitesRes = await apiListSites(token);
      const sites = sitesRes.ok ? sitesRes.data.sites : [];
      // Honour the preferred (e.g. persisted) site if it's still a member of
      // the user's sites list; otherwise fall back to the default picker.
      const stillPresent = preferredSiteId
        ? sites.some((s) => s.id === preferredSiteId)
        : false;
      const currentSiteId = stillPresent ? preferredSiteId : pickDefaultSite(sites);
      setState({ status: "authed", token, user, currentSiteId, sites });
    },
    [],
  );

  useEffect(() => {
    (async () => {
      const [token, persistedSiteId] = await Promise.all([loadToken(), loadCurrentSiteId()]);
      if (!token) {
        setState({ status: "anon" });
        return;
      }
      const user = await apiFetchMe(token);
      if (!user) {
        await clearToken();
        await saveCurrentSiteId(null).catch(() => {});
        setState({ status: "anon" });
        return;
      }
      await loadSitesAndAccept(token, user, persistedSiteId);
    })();
  }, [loadSitesAndAccept]);

  const acceptSession = useCallback(
    async (token: string, user: AuthUser): Promise<void> => {
      await saveToken(token);
      // Fresh session — start the user on whatever site was last selected if
      // they're still a member; otherwise the picker chooses.
      const previouslySelected = await loadCurrentSiteId();
      await loadSitesAndAccept(token, user, previouslySelected);
    },
    [loadSitesAndAccept],
  );

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
    await saveCurrentSiteId(null).catch(() => {});
    setState({ status: "anon" });
  }, [state]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<Result> => {
      if (state.status !== "authed") return { ok: false, error: "not_authed" };
      const result = await apiChangePassword(state.token, currentPassword, newPassword);
      if (!result.ok) return { ok: false, error: result.error };
      const refreshed = await apiFetchMe(state.token);
      if (refreshed) {
        setState({ ...state, user: refreshed });
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
      setState({ ...state, user: result.data.user });
      return { ok: true };
    },
    [state],
  );

  const refreshUser = useCallback(async () => {
    if (state.status !== "authed") return;
    const refreshed = await apiFetchMe(state.token);
    if (refreshed) setState({ ...state, user: refreshed });
  }, [state]);

  const refreshSites = useCallback(async () => {
    const snapshot = stateRef.current;
    if (snapshot.status !== "authed") return;
    const r = await apiListSites(snapshot.token);
    if (!r.ok) return;
    setState((prev) => {
      if (prev.status !== "authed") return prev;
      // If the previously-selected site disappeared (revoked, deleted), fall
      // back to the default picker. Otherwise keep the user's selection.
      const stillPresent = prev.currentSiteId
        ? r.data.sites.some((s) => s.id === prev.currentSiteId)
        : false;
      const currentSiteId = stillPresent
        ? prev.currentSiteId
        : pickDefaultSite(r.data.sites);
      return { ...prev, sites: r.data.sites, currentSiteId };
    });
  }, []);

  const setCurrentSite = useCallback(
    (siteId: string | null) => {
      if (state.status !== "authed") return;
      setState({ ...state, currentSiteId: siteId });
    },
    [state],
  );

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
      refreshSites,
      setCurrentSite,
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
      refreshSites,
      setCurrentSite,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
