/**
 * Native-side OAuth helpers. Each function performs the platform-specific
 * dance and returns the identity token (Apple) or id_token (Google) that the
 * API will verify.
 *
 * Configure GOOGLE_OAUTH_CLIENT_ID via app.json -> expo.extra OR by inlining
 * the value below. Apple requires no client ID on iOS — the bundle id is the
 * audience and Apple's docs handle that automatically when we call
 * AppleAuthentication.signInAsync with the email/fullName scopes.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Google from "expo-auth-session/providers/google";

export type AppleSignInResult = {
  identityToken: string;
  fullName: { givenName: string | null; familyName: string | null } | null;
};

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function signInWithApple(): Promise<AppleSignInResult> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  if (!credential.identityToken) {
    throw new Error("apple_no_identity_token");
  }
  return {
    identityToken: credential.identityToken,
    fullName: credential.fullName
      ? {
          givenName: credential.fullName.givenName ?? null,
          familyName: credential.fullName.familyName ?? null,
        }
      : null,
  };
}

type GoogleClientIds = {
  iosClientId?: string;
  androidClientId?: string;
  webClientId?: string;
};

export function readGoogleClientIds(): GoogleClientIds {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  return {
    iosClientId:
      typeof extra.googleIosClientId === "string" ? extra.googleIosClientId : undefined,
    androidClientId:
      typeof extra.googleAndroidClientId === "string"
        ? extra.googleAndroidClientId
        : undefined,
    webClientId:
      typeof extra.googleWebClientId === "string" ? extra.googleWebClientId : undefined,
  };
}

export function useGoogleAuth() {
  const ids = readGoogleClientIds();
  // Returns [request, response, promptAsync] — caller drives the flow.
  return Google.useAuthRequest({
    iosClientId: ids.iosClientId,
    androidClientId: ids.androidClientId,
    webClientId: ids.webClientId,
  });
}
