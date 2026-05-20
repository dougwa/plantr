import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { useAuth } from "../../contexts/AuthContext";
import { createInvitation, type InvitationSummary, type SiteRole } from "../../lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList, "SiteInvite">;
type Route = NativeStackScreenProps<RootStackParamList, "SiteInvite">["route"];

const ROLE_OPTIONS: { value: SiteRole; label: string; hint: string }[] = [
  { value: "VIEWER", label: "Viewer", hint: "Read-only. Sees plants and photos." },
  { value: "USER", label: "Member", hint: "Can add, edit, and log activity on plants." },
  { value: "ADMIN", label: "Admin", hint: "Can do anything a member can, plus invite and manage other members." },
];

export default function SiteInviteScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { siteId } = route.params;
  const { state } = useAuth();
  const token = state.status === "authed" ? state.token : null;

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<SiteRole>("USER");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<InvitationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!token) return null;

  async function onSubmit() {
    if (!token) return;
    setError(null);
    if (!email.trim() && !phone.trim()) {
      setError("Enter an email or phone number for the invitee.");
      return;
    }
    if (email && !email.includes("@")) {
      setError("Email looks malformed.");
      return;
    }
    setBusy(true);
    const r = await createInvitation(token, siteId, {
      role,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      setError(
        r.error === "insufficient_role"
          ? "You don't have permission to invite members."
          : r.error === "use_transfer_for_owner"
            ? "Owner transfer goes through Site management → transfer ownership."
            : "Could not send the invitation.",
      );
      return;
    }
    setCreated(r.data.invitation);
  }

  function shareLink() {
    if (!created) return;
    // Tokens are intentionally bare here — a real deep-link host can be wired
    // later; for now the invitee accepts from in-app notifications.
    Share.share({
      message: `Join my PlantR site. Invite token: ${created.token}`,
    }).catch(() => {});
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#171717" />
        </Pressable>
        <Text style={styles.title}>Invite member</Text>
        <View style={styles.backBtn} />
      </View>

      {created ? (
        <View style={styles.successBody}>
          <Ionicons name="checkmark-circle" size={48} color="#16a34a" />
          <Text style={styles.successTitle}>Invitation sent</Text>
          <Text style={styles.successHint}>
            {created.email
              ? `An invitation has been queued for ${created.email}. They'll see it as soon as they sign in.`
              : `An SMS-style invitation has been queued for ${created.phone}. (Delivery providers land in a later phase — for now the message is logged on the server.)`}
          </Text>
          <Pressable onPress={shareLink} style={styles.shareBtn}>
            <Ionicons name="share-outline" size={18} color="#fff" />
            <Text style={styles.shareText}>Share invite token</Text>
          </Pressable>
          <Pressable onPress={() => nav.goBack()} style={styles.doneBtn}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="invitee@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
            />

            <Text style={styles.label}>Phone (optional)</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 555 555 1234"
              keyboardType="phone-pad"
              style={styles.input}
            />
            <Text style={styles.hint}>
              SMS delivery is stubbed for now — the message is logged on the server. Email
              delivery is stubbed the same way.
            </Text>

            <Text style={styles.label}>Role</Text>
            <View style={styles.roleList}>
              {ROLE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => setRole(opt.value)}
                  style={[styles.roleOption, role === opt.value && styles.roleOptionActive]}
                >
                  <Ionicons
                    name={role === opt.value ? "radio-button-on" : "radio-button-off"}
                    size={18}
                    color={role === opt.value ? "#16a34a" : "#a3a3a3"}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roleLabel}>{opt.label}</Text>
                    <Text style={styles.roleHint}>{opt.hint}</Text>
                  </View>
                </Pressable>
              ))}
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={onSubmit}
              disabled={busy}
              style={({ pressed }) => [
                styles.submit,
                (busy || pressed) && { opacity: 0.7 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Send invitation</Text>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafafa" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  backBtn: { width: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 17, fontWeight: "600", color: "#171717", textAlign: "center" },
  body: { padding: 16, gap: 6 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#737373",
    marginTop: 16,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    padding: 12,
    fontSize: 16,
    color: "#171717",
  },
  hint: { color: "#737373", fontSize: 12, marginTop: 4, lineHeight: 18 },
  roleList: { gap: 8 },
  roleOption: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d4d4d4",
  },
  roleOptionActive: { borderColor: "#16a34a", backgroundColor: "#f0fdf4" },
  roleLabel: { fontSize: 15, color: "#171717", fontWeight: "500" },
  roleHint: { fontSize: 12, color: "#737373", marginTop: 2 },
  error: { color: "#dc2626", fontSize: 13, marginTop: 12 },
  submit: {
    marginTop: 20,
    backgroundColor: "#16a34a",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "500" },

  successBody: { flex: 1, alignItems: "center", padding: 32, gap: 12 },
  successTitle: { fontSize: 20, fontWeight: "600", color: "#171717" },
  successHint: { fontSize: 14, color: "#525252", textAlign: "center", lineHeight: 20 },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#16a34a",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  shareText: { color: "#fff", fontWeight: "500" },
  doneBtn: { marginTop: 12, padding: 12 },
  doneText: { color: "#525252" },
});
