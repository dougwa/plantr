import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

const DEFAULT_TAGS: { name: string; color: string }[] = [
  { name: "Rose", color: "#ec4899" },
  { name: "Hydrangea", color: "#0ea5e9" },
  { name: "Rhododendron", color: "#a855f7" },
  { name: "Flowering Tree", color: "#16a34a" },
  { name: "Fruit Tree", color: "#f97316" },
  { name: "Indoor Orchid", color: "#eab308" },
  { name: "Outdoor Orchid", color: "#dc2626" },
  { name: "Other", color: "#525252" },
];

async function seedAdmin() {
  const existing = await prisma.user.findUnique({ where: { username: "admin" } });
  if (existing) {
    console.log("admin user already exists, skipping");
    return;
  }
  const passwordHash = await argon2.hash("admin");
  await prisma.user.create({
    data: { username: "admin", passwordHash, mustChangePass: true },
  });
  console.log("seeded admin/admin (mustChangePass=true)");
}

async function seedTags() {
  for (const { name, color } of DEFAULT_TAGS) {
    await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name, color },
    });
  }
  console.log(`seeded ${DEFAULT_TAGS.length} tags`);
}

async function main() {
  await seedAdmin();
  await seedTags();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
