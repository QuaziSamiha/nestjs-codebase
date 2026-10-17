import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EmailDto {
  @ApiProperty({
    description: 'The email address of the user',
    example: 'jane.doe@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
