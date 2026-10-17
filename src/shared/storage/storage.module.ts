// GOAL: ENCAPSULATE AND EXPORT STORAGE FUNCTIONALITY FOR THE REST OF THE APP.
// RELATION: IMPORTS CONFIGMODULE, PROVIDES LOCALSTORAGESERVICE USING A CONSTANT TOKEN.
// WORKFLOW: REGISTERS THE SERVICE IN NESTJS DI CONTAINER AND EXPORTS IT.
// CODE: @MODULE DECORATOR CONFIGURING PROVIDERS AND EXPORTS.

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LocalStorageService } from './local-storage.service';
import { STORAGE_SERVICE_TOKEN } from './storage.constants';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_SERVICE_TOKEN,
      useClass: LocalStorageService, // SWAP THIS WITH S3StorageService LATER IF NEEDED
    },
  ],
  exports: [STORAGE_SERVICE_TOKEN],
})
export class StorageModule {}
