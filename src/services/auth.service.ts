import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../middleware/error.middleware';
import type { JWTPayload, Role } from '../types';

const BCRYPT_ROUNDS = 12;
const MAX_ACTIVE_SESSIONS = 5;

// ─── Token helpers ────────────────────────────────────────────────────────────

function buildPayload(user: {
  id: string;
  email: string;
  role: string;
  storeId: string | null;
  name: string;
}): JWTPayload {
  return {
    userId: user.id,
    email: user.email,
    role: user.role as Role,
    storeId: user.storeId,
    name: user.name,
  };
}

function signAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

function signRefreshToken(payload: JWTPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
}

// ─── Refresh token DB helpers ─────────────────────────────────────────────────

async function storeRefreshToken(userId: string, token: string) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  // Create the new token first
  await prisma.refreshToken.create({ data: { token, userId, expiresAt } });

  // Enforce session cap using Prisma's query API (works on any database)
  const total = await prisma.refreshToken.count({ where: { userId } });

  if (total > MAX_ACTIVE_SESSIONS) {
    // Find the oldest N tokens that push us over the cap
    const oldest = await prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: total - MAX_ACTIVE_SESSIONS,
      select: { id: true },
    });

    if (oldest.length > 0) {
      await prisma.refreshToken.deleteMany({
        where: { id: { in: oldest.map((t) => t.id) } },
      });
    }
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class AuthService {
  /**
   * Public self-registration. Always creates a CASHIER account — roles are
   * assigned by admins/owners via the users API, never through registration.
   */
  async register(input: { email: string; password: string; name: string }) {
    const email = input.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('Email already in use', 409);

    const hashed = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const user = await prisma.user.create({
      data: { email, password: hashed, name: input.name.trim(), role: 'CASHIER' },
      select: { id: true, email: true, name: true, role: true, storeId: true, createdAt: true },
    });

    const payload = buildPayload({ ...user, storeId: null });
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    await storeRefreshToken(user.id, refreshToken);

    return { user, accessToken, refreshToken };
  }

  async login(input: { email: string; password: string }) {
    const email = input.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email },
      include: { store: { select: { id: true, name: true } } },
    });

    // Constant-time comparison guard — don't short-circuit on missing user
    const dummyHash = '$2b$12$AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const passwordToCheck = user ? user.password : dummyHash;
    const isValid = await bcrypt.compare(input.password, passwordToCheck);

    if (!user || !isValid) throw new AppError('Invalid email or password', 401);
    if (!user.isActive) throw new AppError('Account is deactivated. Contact your administrator.', 403);

    const payload = buildPayload(user);
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    await storeRefreshToken(user.id, refreshToken);

    const { password: _, ...safeUser } = user;
    return { user: safeUser, accessToken, refreshToken };
  }

  async refresh(token: string) {
    // 1. Verify JWT signature and expiry first (catches tampered tokens early)
    let jwtPayload: JWTPayload;
    try {
      jwtPayload = jwt.verify(token, env.JWT_REFRESH_SECRET) as JWTPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        // Expired — clean it from DB and reject
        await prisma.refreshToken.deleteMany({ where: { token } });
        throw new AppError('Session expired. Please log in again.', 401);
      }
      throw new AppError('Invalid session token', 401);
    }

    // 2. Confirm token still exists in DB (not already rotated / logged out)
    const stored = await prisma.refreshToken.findUnique({
      where: { token },
      include: { user: { select: { id: true, email: true, name: true, role: true, storeId: true, isActive: true } } },
    });

    if (!stored) throw new AppError('Session not found. Please log in again.', 401);
    if (!stored.user.isActive) throw new AppError('Account is deactivated.', 403);

    // 3. Rotate — delete old, issue new
    await prisma.refreshToken.delete({ where: { id: stored.id } });

    const payload = buildPayload(stored.user);
    const newAccessToken = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(payload);
    await storeRefreshToken(stored.user.id, newRefreshToken);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string) {
    // Ignore if token doesn't exist (idempotent)
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }

  /** Revoke every session for a user — used when account is compromised. */
  async logoutAll(userId: string) {
    await prisma.refreshToken.deleteMany({ where: { userId } });
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        storeId: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        store: { select: { id: true, name: true, address: true } },
      },
    });

    if (!user) throw new AppError('User not found', 404);
    if (!user.isActive) throw new AppError('Account is deactivated', 403);
    return user;
  }
}

export const authService = new AuthService();
