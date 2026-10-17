import { SetMetadata } from '@nestjs/common';

//* IS_PUBLIC_KEY IS READ BY JwtAuthGuard TO SKIP JWT VALIDATION ON ROUTES MARKED @Public()
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
