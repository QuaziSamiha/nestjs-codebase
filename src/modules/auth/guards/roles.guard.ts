// * The logic for Roles/Permissions
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../../generated/prisma/enums';
import { ROLES_KEY } from '../../../common/decorators/auth/roles.decorator';
import { User } from '../../../generated/prisma/client';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: User }>();
    const user = request.user;

    // 1. Check if user exists (handles no-unsafe-assignment)
    if (!user) {
      throw new ForbiddenException('User session not found');
    }

    // 2. Validate role existence (handles no-unsafe-member-access)
    const userRole = user.role;
    if (!userRole) {
      throw new ForbiddenException('User role is missing or invalid');
    }

    // 3. Check if user has the required role (handles no-unsafe-argument)
    const hasPermission = requiredRoles.includes(userRole);

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient role privileges');
    }

    return true;
  }
}
