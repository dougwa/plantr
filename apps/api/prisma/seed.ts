import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({ where: { username: "admin" } });
  if (existing) {
    console.log("admin user already exists, skipping seed");
    return;
  }

  const passwordHash = await argon2.hash("admin");
  await prisma.user.create({
    data: {
      username: "admin",
      passwordHash,
      mustChangePass: true,
    },
  });
  console.log('seeded admin/admin (mustChangePass=true)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
