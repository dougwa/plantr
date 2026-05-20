import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { useAuth } from "../contexts/AuthContext";
import {
  isAppleOauthEnabled,
  isAppleSignInAvailable,
  isGoogleOauthConfigured,
  signInWithApple,
  useGoogleAuth,
} from "../lib/oauth";

type Mode = "signin" | "signup";

type OAuthCommonProps = {
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
};

// Both OAuth subcomponents own their own hook calls. The parent only mounts
// them when the corresponding provider is configured — keeps the underlying
// native modules / expo-auth-session out of the React tree when unused.

function AppleSignInBlock({ mode, busy, setBusy, setError }: OAuthCommonProps & { mode: Mode }) {
  const { signInWithAppleToken } = useAuth();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    isAppleSignInAvailable().then(setAvailable);
  }, []);

  if (!available) return null;

  async function onPress() {
    setError(null);
    try {
      setBusy(true);
      const result = await signInWithApple();
      const r = await signInWithAppleToken(result.identityToken, result.fullName);
      if (!r.ok) setError(translateError(r.error));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "ERR_REQUEST_CANCELED") setError("Apple sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={
        mode === "signin"
          ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
          : AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
      }
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={6}
      style={styles.appleButton}
      onPress={onPress}
    />
  );
}

function GoogleSignInBlock({ busy, setBusy, setError }: OAuthCommonProps) {
  const { signInWithGoogleToken } = useAuth();
  const [request, response, promptAsync] = useGoogleAuth();

  useEffect(() => {
    if (response?.type === "success") {
      const idToken = response.authentication?.idToken;
      if (!idToken) {
        setError("Google sign-in did not return an id token.");
        return;
      }
      (async () => {
        setBusy(true);
        const r = await signInWithGoogleToken(idToken);
        setBusy(false);
        if (!r.ok) setError(translateError(r.error));
      })();
    } else if (response?.type === "error") {
      setError("Google sign-in failed.");
    }
  }, [response, signInWithGoogleToken, setBusy, setError]);

  return (
    <TouchableOpacity
      onPress={() => promptAsync()}
      disabled={busy || !request}
      style={[styles.googleButton, (!request || busy) && styles.busy]}
    >
      <Text style={styles.googleText}>Continue with Google</Text>
    </TouchableOpacity>
  );
}

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Module-load-time configuration. Flipping a flag in app.json + reloading
  // the app is enough to re-enable a provider.
  const appleEnabled = isAppleOauthEnabled();
  const googleEnabled = isGoogleOauthConfigured();
  const anyOAuth = appleEnabled || googleEnabled;

  async function onSubmit() {
    setError(null);
    if (mode === "signup") {
      if (!identifier.includes("@")) {
        setError("Enter a valid email address.");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      setBusy(true);
      const r = await signUp(identifier.trim(), password, name.trim() || undefined);
      setBusy(false);
      if (!r.ok) setError(translateError(r.error));
      return;
    }
    setBusy(true);
    const r = await signIn(identifier.trim(), password);
    setBusy(false);
    if (!r.ok) setError(translateError(r.error));
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>
          {mode === "signin" ? "Sign in to PlantR" : "Create your PlantR account"}
        </Text>

        {mode === "signup" && (
          <>
            <Text style={styles.label}>Name (optional)</Text>
            <TextInput
              autoCapitalize="words"
              autoComplete="name"
              value={name}
              onChangeText={setName}
              style={styles.input}
            />
          </>
        )}

        <Text style={styles.label}>{mode === "signin" ? "Email or username" : "Email"}</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete={mode === "signin" ? "username" : "email"}
          value={identifier}
          onChangeText={setIdentifier}
          style={styles.input}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          secureTextEntry
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChangeText={setPassword}
          style={styles.input}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          onPress={onSubmit}
          disabled={busy}
          style={[styles.primary, busy && styles.busy]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>
              {mode === "signin" ? "Sign in" : "Create account"}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {
            setError(null);
            setMode(mode === "signin" ? "signup" : "signin");
          }}
          disabled={busy}
        >
          <Text style={styles.switchModeText}>
            {mode === "signin"
              ? "Don't have an account? Sign up"
              : "Already have an account? Sign in"}
          </Text>
        </TouchableOpacity>

        {anyOAuth && (
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>
        )}

        {appleEnabled && (
          <AppleSignInBlock mode={mode} busy={busy} setBusy={setBusy} setError={setError} />
        )}
        {googleEnabled && (
          <GoogleSignInBlock busy={busy} setBusy={setBusy} setError={setError} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function translateError(error: string): string {
  switch (error) {
    case "invalid_credentials":
      return "Invalid email or password.";
    case "email_taken":
      return "An account with that email already exists.";
    case "apple_oauth_not_configured":
    case "google_oauth_not_configured":
      return "This sign-in method isn't set up yet.";
    case "invalid_apple_token":
      return "Apple couldn't verify your sign-in. Try again.";
    case "invalid_google_token":
      return "Google couldn't verify your sign-in. Try again.";
    case "network":
      return "Could not reach server.";
    default:
      return "Something went wrong. Try again.";
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fafafa",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  title: { fontSize: 22, fontWeight: "600", color: "#171717", marginBottom: 4 },
  label: { fontSize: 13, color: "#525252", marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 6,
    padding: 10,
    fontSize: 16,
  },
  error: { color: "#dc2626", fontSize: 13, marginTop: 4 },
  primary: {
    backgroundColor: "#171717",
    borderRadius: 6,
    padding: 12,
    alignItems: "center",
    marginTop: 8,
  },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "500" },
  busy: { opacity: 0.6 },
  switchModeText: {
    textAlign: "center",
    color: "#525252",
    fontSize: 13,
    marginTop: 8,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 8,
    gap: 8,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#e5e5e5" },
  dividerText: { color: "#737373", fontSize: 12 },
  appleButton: { height: 44, marginTop: 4 },
  googleButton: {
    height: 44,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  googleText: { color: "#171717", fontSize: 15, fontWeight: "500" },
});
