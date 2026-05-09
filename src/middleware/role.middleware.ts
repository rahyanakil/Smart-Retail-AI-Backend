import { Request, Response, NextFunction } from 'express';
import type { Role } from '../types';

// ─── Generic deny response ────────────────────────────────────────────────────
// Generic message intentionally — don't leak which roles are required.

function forbidden(res: Response): void {
  res.status(403).json({
    success: false,
    message: 'Insufficient permissions',
    code: 'FORBIDDEN',
  });
}

function unauthenticated(res: Response): void {
  res.status(401).json({
    success: false,
    message: 'Authentication required',
    code: 'MISSING_TOKEN',
  });
}

// ─── Core middleware factory ──────────────────────────────────────────────────

/**
 * Require the authenticated user to have one of the listed roles.
 * Must be composed after `authenticate`.
 *
 * @example
 * router.delete('/:id', authenticate, authorize('ADMIN'), deleteUser);
 */
export const authorize = (...roles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) { unauthenticated(res); return; }
    if (!roles.includes(req.user.role)) { forbidden(res); return; }
    next();
  };
};

// ─── Named convenience guards ─────────────────────────────────────────────────

/** Only ADMIN. */
export const requireAdmin = authorize('ADMIN');

/** ADMIN or OWNER. */
export const requireOwnerOrAbove = authorize('ADMIN', 'OWNER');

/** Any authenticated role (ADMIN, OWNER, CASHIER). */
export const requireAny = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) { unauthenticated(res); return; }
  next();
};

// ─── Store-scoped guard ───────────────────────────────────────────────────────

/**
 * Passes if:
 *  - the requester is ADMIN (can access any store), or
 *  - the storeId in params/body/query matches the requester's own storeId.
 *
 * Attach after `authenticate`. Does NOT check role — combine with `authorize`
 * when you also need a role gate.
 */
export const requireSameStoreOrAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) { unauthenticated(res); return; }
  if (req.user.role === 'ADMIN') { next(); return; }

  const requestedStoreId =
    (req.params.storeId as string | undefined) ||
    (req.body?.storeId as string | undefined) ||
    (req.query.storeId as string | undefined);

  if (requestedStoreId && requestedStoreId !== req.user.storeId) {
    forbidden(res);
    return;
  }

  next();
};

/**
 * Require the authenticated user to be acting on their own resource,
 * OR to be ADMIN. Compares `req.params.id` with `req.user.userId`.
 *
 * @example
 * router.get('/profile/:id', authenticate, requireSelfOrAdmin, getProfile);
 */
export const requireSelfOrAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) { unauthenticated(res); return; }
  if (req.user.role === 'ADMIN') { next(); return; }
  if (req.params.id === req.user.userId) { next(); return; }
  forbidden(res);
};
