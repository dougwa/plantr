/**
 * Native-side OAuth helpers. Each provider is opt-in via flags in
 * app.json -> expo.extra: set `appleOauthEnabled: true` (and ship a dev build
 * with Sign in with Apple capability) to enable Apple; set any of the Google
 * client IDs to enable Google.
 *
 * When a provider is disabled, the screen never imports its hook in a render
 * pass — the corresponding child component just isn't mounted. This keeps
 * expo-auth-session from throwing at render time when no client IDs are set.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Google from "expo-auth-session/providers/google";

export type AppleSignInResult = {
  identityToken: string;
  fullName: { givenName: string | null; familyName: string | null } | null;
};

type AppExtra = {
  appleOauthEnabled?: unknown;
  googleIosClientId?: unknown;
  googleAndroidClientId?: unknown;
  googleWebClientId?: unknown;
};

function readExtra(): AppExtra {
  return (Constants.expoConfig?.extra ?? {}) as AppExtra;
}

function pickClientId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export type GoogleClientIds = {
  iosClientId?: string;
  androidClientId?: string;
  webClientId?: string;
};

export function readGoogleClientIds(): GoogleClientIds {
  const extra = readExtra();
  return {
    iosClientId: pickClientId(extra.googleIosClientId),
    androidClientId: pickClientId(extra.googleAndroidClientId),
    webClientId: pickClientId(extra.googleWebClientId),
  };
}

export function isGoogleOauthConfigured(): boolean {
  const ids = readGoogleClientIds();
  return !!(ids.iosClientId || ids.androidClientId || ids.webClientId);
}

export function isAppleOauthEnabled(): boolean {
  return readExtra().appleOauthEnabled === true;
}

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

// Caller is responsible for only mounting the component that uses this hook
// when isGoogleOauthConfigured() returns true — useAuthRequest throws when
// every client ID is undefined.
export function useGoogleAuth() {
  const ids = readGoogleClientIds();
  return Google.useAuthRequest({
    iosClientId: ids.iosClientId,
    androidClientId: ids.androidClientId,
    webClientId: ids.webClientId,
  });
}
