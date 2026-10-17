import { Module } from '@nestjs/common';
import { HashService } from './hash.service';

//* NO ConfigModule.forFeature() HERE — HASH READS THE ROOT 'app' NAMESPACE
//* (config/app.config.ts), NOT A SCHEMA OF ITS OWN. ConfigService IS ALREADY
//* GLOBAL VIA ConfigModule.forRoot({ isGlobal: true }) IN app.module.ts.
@Module({
  providers: [HashService],
  exports: [HashService],
})
export class HashModule {}
