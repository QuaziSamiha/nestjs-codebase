import { ApiProperty } from '@nestjs/swagger';

export class TokensResponseDto {
  constructor(partial: Partial<TokensResponseDto>) {
    Object.assign(this, partial);
  }

  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  access_token!: string;

  @ApiProperty({
    description: 'JWT refresh token (also set as HTTP-only cookie)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    required: false,
  })
  refresh_token!: string;
}
