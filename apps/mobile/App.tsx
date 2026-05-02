import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/contexts/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import ChangePasswordScreen from "./src/screens/ChangePasswordScreen";
import AppNavigator from "./src/navigation/AppNavigator";

function Router() {
  const { state } = useAuth();
  if (state.status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (state.status === "anon") return <LoginScreen />;
  if (state.user.mustChangePass) return <ChangePasswordScreen />;
  return <AppNavigator />;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <Router />
          <StatusBar style="auto" />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: "#fafafa",
    alignItems: "center",
    justifyContent: "center",
  },
});
