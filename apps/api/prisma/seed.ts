import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

const DEFAULT_PLANT_TYPES = [
  "Rose",
  "Hydrangea",
  "Rhododendron",
  "Flowering Tree",
  "Fruit Tree",
  "Indoor Orchid",
  "Outdoor Orchid",
  "Other",
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

async function seedPlantTypes() {
  for (const name of DEFAULT_PLANT_TYPES) {
    await prisma.plantType.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`seeded ${DEFAULT_PLANT_TYPES.length} plant types`);
}

async function main() {
  await seedAdmin();
  await seedPlantTypes();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
