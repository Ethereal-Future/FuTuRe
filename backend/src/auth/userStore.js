import prisma from '../db/client.js';

export async function createUser(username, passwordHash) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw new Error('User already exists');
  
  const user = await prisma.user.create({
    data: { username, passwordHash, publicKey: `temp-${Date.now()}` },
  });
  
  return { id: user.id, username: user.username };
}

export async function findUser(username) {
  return await prisma.user.findUnique({ where: { username } });
}

export async function getUserById(id) {
  return await prisma.user.findUnique({ where: { id } });
}

export async function updateUserPassword(id, passwordHash) {
  try {
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    return true;
  } catch {
    return false;
  }
}
