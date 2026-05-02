import { Image, type ImageProps } from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { API_URL } from "../lib/api";

type Props = Omit<ImageProps, "source"> & { path: string };

export default function AuthImage({ path, ...rest }: Props) {
  const { state } = useAuth();
  if (state.status !== "authed") return null;
  return (
    <Image
      {...rest}
      source={{
        uri: `${API_URL}${path}`,
        headers: { Authorization: `Bearer ${state.token}` },
      }}
    />
  );
}
