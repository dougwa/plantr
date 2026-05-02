import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../contexts/AuthContext";

export default function SettingsScreen() {
  const { state, signOut } = useAuth();
  if (state.status !== "authed") return null;

  function confirmSignOut() {
    Alert.alert("Sign out?", "You will need to log in again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: signOut },
    ]);
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.value}>{state.user.username}</Text>
      </View>
      <TouchableOpacity style={styles.button} onPress={confirmSignOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </TouchableOpacity>
      <Text style={styles.note}>User and plant-type management coming soon.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa", padding: 20 },
  title: { fontSize: 28, fontWeight: "600", color: "#171717", marginBottom: 24 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d4d4d4",
  },
  label: { color: "#525252", fontSize: 16 },
  value: { color: "#171717", fontSize: 16, fontWeight: "500" },
  button: {
    marginTop: 32,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  buttonText: { color: "#dc2626", fontSize: 16, fontWeight: "500" },
  note: { marginTop: 24, color: "#737373", fontSize: 13 },
});
