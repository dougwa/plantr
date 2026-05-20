import { useState } from "react";
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
import { useAuth } from "../contexts/AuthContext";

/**
 * Shown to users whose email is missing or still the admin@local placeholder
 * (legacy single-user setup). We ask for a real email + optional name. The
 * password change still flows through ChangePasswordScreen separately when
 * mustChangePass is true.
 */
export default function CompleteProfileScreen() {
  const { state, completeProfile } = useAuth();
  const currentName = state.status === "authed" ? state.user.name ?? "" : "";
  const [email, setEmail] = useState("");
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    const r = await completeProfile({ email: email.trim(), name: name.trim() || undefined });
    setBusy(false);
    if (!r.ok) {
      setError(
        r.error === "email_taken"
          ? "An account with that email already exists."
          : "Could not update your profile.",
      );
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Complete your profile</Text>
        <Text style={styles.subtitle}>
          Set your email so you can sign in and receive invitations.
        </Text>
        <Text style={styles.label}>Email</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
        />
        <Text style={styles.label}>Name (optional)</Text>
        <TextInput
          autoCapitalize="words"
          autoComplete="name"
          value={name}
          onChangeText={setName}
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity
          onPress={onSubmit}
          disabled={busy}
          style={[styles.button, busy && styles.buttonBusy]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
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
  title: { fontSize: 22, fontWeight: "600", color: "#171717" },
  subtitle: { fontSize: 14, color: "#525252", marginBottom: 4 },
  label: { fontSize: 13, color: "#525252", marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 6,
    padding: 10,
    fontSize: 16,
  },
  error: { color: "#dc2626", fontSize: 13, marginTop: 4 },
  button: {
    backgroundColor: "#171717",
    borderRadius: 6,
    padding: 12,
    alignItems: "center",
    marginTop: 12,
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "500" },
});
