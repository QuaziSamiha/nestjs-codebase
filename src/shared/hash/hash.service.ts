import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

@Injectable()
export class HashService {
  constructor(private readonly configService: ConfigService) {}

  async hash(plainText: string, rounds?: number): Promise<string> {
    //* IF 'rounds' IS PASSED EXPLICITLY, USE IT; OTHERWISE FALL BACK TO THE ROOT 'app' NAMESPACE
    const saltRounds =
      rounds ?? this.configService.get<number>('app.saltRounds', 10);
    return bcrypt.hash(plainText, saltRounds);
  }

  async compare(plainText: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plainText, hash);
  }
}
