import { useEffect, useState } from "react";
import { Image, View, type ImageProps } from "react-native";
import { getCachedImageUri, getCachedImageUriSync } from "../lib/imageCache";

type Props = Omit<ImageProps, "source"> & { path: string };

// `path` is the signed photo URL from the API (absolute, including a query
// signature that rotates per response). The cache key strips the query so we
// keep one cached file per object even as the signature is refreshed.
function cacheKeyFor(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

export default function AuthImage({ path, ...rest }: Props) {
  const cacheKey = cacheKeyFor(path);
  const [uri, setUri] = useState<string | null>(() => getCachedImageUriSync(cacheKey));

  useEffect(() => {
    const sync = getCachedImageUriSync(cacheKey);
    if (sync) {
      setUri(sync);
      return;
    }
    setUri(null);
    let cancelled = false;
    getCachedImageUri(path, cacheKey).then(
      (localUri) => {
        if (!cancelled) setUri(localUri);
      },
      (err) => {
        if (!cancelled) {
          console.warn("image cache failed, falling back to remote", err);
          setUri(path);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, cacheKey]);

  if (!uri) {
    return <View style={rest.style as object} />;
  }

  return <Image {...rest} source={{ uri }} />;
}
