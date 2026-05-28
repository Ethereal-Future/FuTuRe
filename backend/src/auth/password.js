import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const buf = await scryptAsync(password, salt, 64);
  return `${buf.toString('hex')}.${salt}`;
}

export async function verifyPassword(password, stored) {
  const [hash, salt] = stored.split('.');
  const buf = await scryptAsync(password, salt, 64);
  return timingSafeEqual(Buffer.from(hash, 'hex'), buf);
}
