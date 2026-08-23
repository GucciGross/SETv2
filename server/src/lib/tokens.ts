import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface JwtUser {
  id: string;
  email: string;
  name: string;
}

export function signToken(u: JwtUser): string {
  return jwt.sign(u, config.jwtSecret, { expiresIn: '30d' });
}

export function verifyToken(token: string): JwtUser | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as any;
    if (!payload?.id) return null;
    return { id: payload.id, email: payload.email, name: payload.name };
  } catch {
    return null;
  }
}
