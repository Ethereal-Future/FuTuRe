// In-memory user store (replace with DB in production)
const users = new Map();

export function createUser(username, passwordHash) {
  if (users.has(username)) throw new Error('User already exists');
  const user = { id: crypto.randomUUID(), username, passwordHash, createdAt: Date.now() };
  users.set(username, user);
  return { id: user.id, username: user.username };
}

export function findUser(username) {
  return users.get(username) ?? null;
}

export function getUserById(id) {
  for (const user of users.values()) {
    if (user.id === id) return user;
  }
  return null;
}

export function updateUserPassword(id, passwordHash) {
  for (const user of users.values()) {
    if (user.id === id) { user.passwordHash = passwordHash; return true; }
  }
  return false;
}
