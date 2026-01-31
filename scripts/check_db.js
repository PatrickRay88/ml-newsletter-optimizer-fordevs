require("dotenv").config({ path: ".env" });
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  await prisma.$connect();
  const count = await prisma.broadcast.count();
  console.log("broadcasts", count);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
