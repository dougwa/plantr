import { cookies } from "next/headers";
import { fetchMeServerSide } from "@/lib/api";
import LogoutButton from "./LogoutButton";

export default async function Home() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const user = await fetchMeServerSide(cookieHeader);

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-semibold">PlantR</h1>
        <p className="text-neutral-600">
          Signed in as <span className="font-medium">{user?.username ?? "—"}</span>
        </p>
        <LogoutButton />
      </div>
    </main>
  );
}
