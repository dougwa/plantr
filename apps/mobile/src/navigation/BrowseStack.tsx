import { createNativeStackNavigator } from "@react-navigation/native-stack";
import BrowseHomeScreen from "../screens/browse/BrowseHomeScreen";
import BrowseEntriesScreen from "../screens/browse/BrowseEntriesScreen";
import PlantListScreen from "../screens/browse/PlantListScreen";
import type { BrowseStackParamList } from "./BrowseStackTypes";

const Stack = createNativeStackNavigator<BrowseStackParamList>();

export default function BrowseStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="BrowseHome"
        component={BrowseHomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="BrowseEntries" component={BrowseEntriesScreen} />
      <Stack.Screen name="PlantList" component={PlantListScreen} />
    </Stack.Navigator>
  );
}
