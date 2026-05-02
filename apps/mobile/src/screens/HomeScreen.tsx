import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../contexts/AuthContext";

export default function HomeScreen() {
  const { state, signOut } = useAuth();
  if (state.status !== "authed") return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>PlantR</Text>
      <Text style={styles.subtitle}>
        Signed in as <Text style={styles.username}>{state.user.username}</Text>
      </Text>
      <TouchableOpacity style={styles.button} onPress={signOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fafafa",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  title: { fontSize: 28, fontWeight: "600", color: "#171717" },
  subtitle: { fontSize: 16, color: "#525252" },
  username: { fontWeight: "500", color: "#171717" },
  button: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  buttonText: { fontSize: 14, color: "#171717" },
});
