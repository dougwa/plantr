import { PrismaClient, MembershipRole, Visibility } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

const DEFAULT_TAG_NAMES = [
  "Rose",
  "Hydrangea",
  "Rhododendron",
  "Flowering Tree",
  "Fruit Tree",
  "Indoor Orchid",
  "Outdoor Orchid",
  "Other",
];

async function seedAdminAndSite() {
  let user = await prisma.user.findUnique({ where: { username: "admin" } });
  if (!user) {
    const passwordHash = await argon2.hash("admin");
    user = await prisma.user.create({
      data: {
        username: "admin",
        email: "admin@local",
        passwordHash,
        mustChangePass: true,
      },
    });
    console.log("seeded admin/admin (mustChangePass=true, email=admin@local)");
  } else {
    console.log("admin user already exists, skipping");
  }

  const ownedSite = await prisma.site.findFirst({ where: { ownerId: user.id } });
  if (ownedSite) return ownedSite;
  const site = await prisma.site.create({
    data: { name: "My Garden", visibility: Visibility.PRIVATE, ownerId: user.id },
  });
  await prisma.membership.create({
    data: { siteId: site.id, userId: user.id, role: MembershipRole.OWNER },
  });
  console.log(`seeded site ${site.id} (My Garden) for admin`);
  return site;
}

async function seedTags(siteId: string) {
  for (const name of DEFAULT_TAG_NAMES) {
    await prisma.tag.upsert({
      where: { siteId_kind_name: { siteId, kind: "custom", name } },
      update: {},
      create: { name, kind: "custom", siteId },
    });
  }
  console.log(`seeded ${DEFAULT_TAG_NAMES.length} tags into site ${siteId}`);
}

async function main() {
  const site = await seedAdminAndSite();
  await seedTags(site.id);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
