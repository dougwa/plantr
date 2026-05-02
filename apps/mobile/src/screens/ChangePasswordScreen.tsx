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

export default function ChangePasswordScreen() {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError(null);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    const res = await changePassword(currentPassword, newPassword);
    setBusy(false);
    if (!res.ok) {
      if (res.error === "invalid_credentials") setError("Current password is incorrect.");
      else if (res.error === "new_password_must_differ")
        setError("New password must differ from current.");
      else setError("Could not change password.");
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Change your password</Text>
        <Text style={styles.subtitle}>
          You must change the default password before continuing.
        </Text>
        <Text style={styles.label}>Current password</Text>
        <TextInput
          secureTextEntry
          value={currentPassword}
          onChangeText={setCurrentPassword}
          style={styles.input}
        />
        <Text style={styles.label}>New password</Text>
        <TextInput
          secureTextEntry
          value={newPassword}
          onChangeText={setNewPassword}
          style={styles.input}
        />
        <Text style={styles.label}>Confirm new password</Text>
        <TextInput
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
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
