import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { UserRole } from '../../../generated/prisma/enums';

export class UpdateUserRoleDto {
  @ApiProperty({
    description: 'The new role to assign to the user',
    enum: UserRole,
    example: UserRole.ADMIN,
  })
  @IsNotEmpty()
  @IsEnum(UserRole)
  role: UserRole;
}
