import { useEffect, useState } from "react";
import { Image, View, type ImageProps } from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { API_URL } from "../lib/api";
import { getCachedImageUri, getCachedImageUriSync } from "../lib/imageCache";

type Props = Omit<ImageProps, "source"> & { path: string };

export default function AuthImage({ path, ...rest }: Props) {
  const { state } = useAuth();
  const token = state.status === "authed" ? state.token : null;
  const [uri, setUri] = useState<string | null>(() =>
    token ? getCachedImageUriSync(path) : null,
  );

  useEffect(() => {
    if (!token) {
      setUri(null);
      return;
    }
    const sync = getCachedImageUriSync(path);
    if (sync) {
      setUri(sync);
      return;
    }
    setUri(null);
    let cancelled = false;
    const remoteUrl = `${API_URL}${path}`;
    getCachedImageUri(remoteUrl, path, token).then(
      (localUri) => {
        if (!cancelled) setUri(localUri);
      },
      (err) => {
        if (!cancelled) {
          console.warn("image cache failed, falling back to remote", err);
          setUri(remoteUrl);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, token]);

  if (!token) return null;

  if (!uri) {
    return <View style={rest.style as object} />;
  }

  const isLocal = uri.startsWith("file:");
  return (
    <Image
      {...rest}
      source={
        isLocal
          ? { uri }
          : { uri, headers: { Authorization: `Bearer ${token}` } }
      }
    />
  );
}
