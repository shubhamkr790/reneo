// Role guard — call after `authenticate`.
// Returns 403 if the authenticated user doesn't have the required role.

import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../types/index.js';

export function requireRole(role: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.role !== role) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: `This endpoint requires the ${role} role` },
      });
      return;
    }
    next();
  };
}
