import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  fetchPlantServerSide,
  photoUrl,
  SITE_COOKIE,
  type PublicAction,
  type Tag,
} from "@/lib/api";
import { tagKindStyle } from "@/lib/tagStyle";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function ActionLogRow({ action }: { action: PublicAction }) {
  const label = action.kind.charAt(0).toUpperCase() + action.kind.slice(1);
  return (
    <li className="border-t border-neutral-200 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-neutral-900">{label}</span>
        <span className="text-xs text-neutral-500">{formatDate(action.takenAt)}</span>
      </div>
      {action.notes && <p className="mt-1 text-sm text-neutral-700">{action.notes}</p>}
      <p className="mt-1 text-xs text-neutral-400">by {action.createdBy.username}</p>
    </li>
  );
}

export default async function PlantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const siteId = cookieStore.get(SITE_COOKIE)?.value;
  if (!siteId) redirect("/");
  const plant = await fetchPlantServerSide(siteId, id, cookieHeader);
  if (!plant) notFound();

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="bg-white border-b border-neutral-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between text-sm">
          <Link href="/" className="text-neutral-600 hover:text-neutral-900">
            ← Home
          </Link>
          <span className="font-mono text-xs text-neutral-500">{plant.qrCode}</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto">
        <div className="bg-black aspect-[4/3]">
          {plant.coverPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl(plant.coverPhoto.urls.cover)}
              alt={plant.name ?? plant.qrCode}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-neutral-200 flex items-center justify-center text-neutral-500">
              No photo yet
            </div>
          )}
        </div>

        <section className="bg-white px-4 py-4 mt-3 border-y border-neutral-200">
          <h1 className="text-2xl font-semibold text-neutral-900">
            {plant.name ?? <span className="text-neutral-400">Unnamed</span>}
          </h1>
          <p className="mt-1 text-xs font-mono text-neutral-500">{plant.qrCode}</p>
          {plant.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {plant.tags.map((t) => (
                <TagChip key={t.id} tag={t} />
              ))}
            </div>
          )}
          <dl className="mt-3 divide-y divide-neutral-100 text-sm">
            <Field label="Species" value={plant.species} />
            <Field label="Description" value={plant.description} />
            <Field label="Notes" value={plant.notes} />
            <Field
              label="GPS"
              value={
                plant.gpsLat != null && plant.gpsLng != null
                  ? `${plant.gpsLat.toFixed(6)}, ${plant.gpsLng.toFixed(6)}`
                  : null
              }
            />
            <Field
              label="Created"
              value={`${formatDate(plant.createdAt)} by ${plant.createdBy.username}`}
            />
          </dl>
        </section>

        <section className="bg-white px-4 py-4 mt-3 border-y border-neutral-200">
          <h2 className="text-xs uppercase tracking-wide text-neutral-500 mb-3">Photos</h2>
          {plant.photos.length === 0 ? (
            <p className="text-sm text-neutral-400">No photos yet.</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto">
              {plant.photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={p.id}
                  src={photoUrl(p.urls.thumb)}
                  alt=""
                  className="h-24 w-24 rounded object-cover bg-neutral-100 shrink-0"
                />
              ))}
            </div>
          )}
        </section>

        <section className="bg-white px-4 py-4 mt-3 border-y border-neutral-200 mb-8">
          <h2 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Actions</h2>
          {plant.actions.length === 0 ? (
            <p className="text-sm text-neutral-400">No actions yet.</p>
          ) : (
            <ul>
              {plant.actions.map((a) => (
                <ActionLogRow key={a.id} action={a} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function TagChip({ tag }: { tag: Tag }) {
  const style = tagKindStyle(tag.kind);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: style.color }}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3 w-3 fill-current"
        aria-hidden="true"
      >
        <path d={style.iconPath} />
      </svg>
      {tag.name}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex py-2">
      <dt className="w-28 text-neutral-500">{label}</dt>
      <dd className={value ? "flex-1 text-neutral-900" : "flex-1 text-neutral-400"}>
        {value ?? "—"}
      </dd>
    </div>
  );
}
