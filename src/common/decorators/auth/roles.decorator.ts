import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../../generated/prisma/enums';

//* ROLES_KEY IS READ BY RolesGuard TO ENFORCE THAT THE AUTHENTICATED USER'S ROLE IS IN THIS LIST
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
