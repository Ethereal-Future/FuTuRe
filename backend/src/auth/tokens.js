import jwt from 'jsonwebtoken';
import { getConfig } from '../config/env.js';

function getSecret() {
  return getConfig().auth?.jwtSecret ?? process.env.JWT_SECRET ?? 'dev-secret-change-in-production';
}

export function signAccessToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: '15m' });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: '7d' });
}

export function verifyToken(token) {
  return jwt.verify(token, getSecret());
}
