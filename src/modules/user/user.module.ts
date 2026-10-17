import { forwardRef, Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserRepository } from './repositories/user.repository';
import { UserSecurityRepository } from './repositories/user-security.repository';
import { ProfileRepository } from './repositories/profile.repository';
import { OtpModule } from '../otp/otp.module';
import { PaginationModule } from '../../shared/pagination';
import { HashModule } from '../../shared/hash/hash.module';
import { StorageModule } from '../../shared/storage/storage.module';

@Module({
  imports: [
    forwardRef(() => OtpModule),
    PaginationModule,
    HashModule,
    StorageModule,
  ],
  controllers: [UserController],
  providers: [
    UserService,
    UserRepository,
    ProfileRepository,
    UserSecurityRepository,
  ],
  exports: [UserService],
})
export class UserModule {}
