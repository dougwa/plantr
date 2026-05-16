import type { Action, ActionKind, Photo, Plant, Tag, TagKind, User } from "@prisma/client";

export type PublicPhoto = {
  id: string;
  createdAt: Date;
  createdBy: { id: string; username: string };
  urls: {
    original: string;
    thumb: string;
    cover: string;
  };
};

export type PublicAction = {
  id: string;
  kind: ActionKind;
  notes: string | null;
  takenAt: Date;
  createdAt: Date;
  createdBy: { id: string; username: string };
};

export type PublicTag = {
  id: string;
  name: string;
  kind: TagKind;
  locationShapeId: string | null;
};

export type PublicPlant = {
  id: string;
  qrCode: string;
  name: string | null;
  tags: PublicTag[];
  species: string | null;
  description: string | null;
  notes: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  plantNetData: unknown;
  coverPhoto: PublicPhoto | null;
  photos: PublicPhoto[];
  actions: PublicAction[];
  createdBy: { id: string; username: string };
  createdAt: Date;
  updatedAt: Date;
};

type PhotoWithCreator = Photo & { createdBy: Pick<User, "id" | "username"> };
type ActionWithCreator = Action & { createdBy: Pick<User, "id" | "username"> };

type PlantWithRelations = Plant & {
  tags: Tag[];
  coverPhoto: PhotoWithCreator | null;
  photos: PhotoWithCreator[];
  actions: ActionWithCreator[];
  createdBy: Pick<User, "id" | "username">;
};

export function publicTag(t: Tag): PublicTag {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    locationShapeId: t.locationShapeId,
  };
}

export function publicPhoto(photo: PhotoWithCreator): PublicPhoto {
  return {
    id: photo.id,
    createdAt: photo.createdAt,
    createdBy: { id: photo.createdBy.id, username: photo.createdBy.username },
    urls: {
      original: `/photos/${photo.id}/file/original`,
      thumb: `/photos/${photo.id}/file/thumb`,
      cover: `/photos/${photo.id}/file/cover`,
    },
  };
}

export function publicAction(action: ActionWithCreator): PublicAction {
  return {
    id: action.id,
    kind: action.kind,
    notes: action.notes,
    takenAt: action.takenAt,
    createdAt: action.createdAt,
    createdBy: { id: action.createdBy.id, username: action.createdBy.username },
  };
}

export function publicPlant(plant: PlantWithRelations): PublicPlant {
  return {
    id: plant.id,
    qrCode: plant.qrCode,
    name: plant.name,
    tags: plant.tags.map(publicTag),
    species: plant.species,
    description: plant.description,
    notes: plant.notes,
    gpsLat: plant.gpsLat,
    gpsLng: plant.gpsLng,
    plantNetData: plant.plantNetData,
    coverPhoto: plant.coverPhoto ? publicPhoto(plant.coverPhoto) : null,
    photos: plant.photos.map(publicPhoto),
    actions: plant.actions.map(publicAction),
    createdBy: { id: plant.createdBy.id, username: plant.createdBy.username },
    createdAt: plant.createdAt,
    updatedAt: plant.updatedAt,
  };
}

export const PLANT_INCLUDE = {
  tags: { orderBy: [{ kind: "asc" as const }, { name: "asc" as const }] },
  coverPhoto: { include: { createdBy: { select: { id: true, username: true } } } },
  photos: {
    orderBy: { createdAt: "asc" as const },
    include: { createdBy: { select: { id: true, username: true } } },
  },
  actions: {
    orderBy: { takenAt: "desc" as const },
    include: { createdBy: { select: { id: true, username: true } } },
  },
  createdBy: { select: { id: true, username: true } },
};
