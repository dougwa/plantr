import { StyleSheet, Text, View } from "react-native";

export default function BrowseScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Browse</Text>
      <Text style={styles.subtitle}>Coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fafafa",
  },
  title: { fontSize: 28, fontWeight: "600", color: "#171717" },
  subtitle: { marginTop: 6, fontSize: 14, color: "#737373" },
});
