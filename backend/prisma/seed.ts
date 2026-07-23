import { PrismaClient, Role, TaskStatus, Priority } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 12);

  const owner = await prisma.user.upsert({
    where: { email: "ada@syncforge.dev" },
    update: {},
    create: { email: "ada@syncforge.dev", name: "Ada Lovelace", passwordHash },
  });

  const member = await prisma.user.upsert({
    where: { email: "grace@syncforge.dev" },
    update: {},
    create: { email: "grace@syncforge.dev", name: "Grace Hopper", passwordHash },
  });

  const org = await prisma.organization.upsert({
    where: { slug: "syncforge-demo" },
    update: {},
    create: { name: "SyncForge Demo", slug: "syncforge-demo" },
  });

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: owner.id, organizationId: org.id } },
    update: {},
    create: { userId: owner.id, organizationId: org.id, role: Role.OWNER },
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: member.id, organizationId: org.id } },
    update: {},
    create: { userId: member.id, organizationId: org.id, role: Role.MEMBER },
  });

  const project = await prisma.project.create({
    data: { organizationId: org.id, name: "Launch Plan", description: "Q1 product launch" },
  });

  await prisma.task.createMany({
    data: [
      { projectId: project.id, title: "Draft landing page copy", status: TaskStatus.TODO, priority: Priority.HIGH, position: 1 },
      { projectId: project.id, title: "Set up analytics", status: TaskStatus.IN_PROGRESS, priority: Priority.MEDIUM, position: 1, assigneeId: member.id },
      { projectId: project.id, title: "Finalize pricing", status: TaskStatus.DONE, priority: Priority.URGENT, position: 1 },
    ],
  });

  await prisma.document.create({
    data: {
      projectId: project.id,
      title: "Launch Brief",
      content: { blocks: [{ type: "heading", text: "Launch Brief" }, { type: "paragraph", text: "Draft content goes here." }] },
    },
  });

  // eslint-disable-next-line no-console
  console.log("Seeded demo data. Login with ada@syncforge.dev / password123");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
