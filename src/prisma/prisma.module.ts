import {
  Global,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Inject,
} from '@nestjs/common';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import databaseConfig from './config/database.config';
import { RequestContextModule } from '../shared/logger/request-context.module';
import { RequestContextService } from '../shared/logger/request-context.service';
import { createAuditLogExtension } from './extensions/audit-log.extension';

@Global() //* MAKES PRISMASERVICE AVAILABLE EVERYWHERE WITHOUT RE-IMPORTING THE MODULE
@Module({
  //* PARTIAL REGISTRATION — PRISMA MODULE OWNS THE 'database' CONFIG NAMESPACE
  imports: [ConfigModule.forFeature(databaseConfig), RequestContextModule],
  providers: [
    //* OVERRIDES THE PLAIN `providers: [PrismaService]` SHORTHAND SO EVERY
    //* CONSUMER INJECTING `PrismaService` (ALL 18 REPOSITORIES, UNCHANGED)
    //* TRANSPARENTLY RECEIVES THE audit-log-EXTENDED CLIENT INSTEAD. SEE
    //* docs/audit-log.md FOR WHY THIS IS THE LOWER-BLAST-RADIUS ALTERNATIVE TO
    //* THREADING A DIFFERENT TOKEN/TYPE THROUGH EVERY REPOSITORY CONSTRUCTOR.
    {
      provide: PrismaService,
      useFactory: (
        configService: ConfigService,
        requestContext: RequestContextService,
      ) => {
        const base = new PrismaService(configService);
        return base.$extends(
          createAuditLogExtension(requestContext),
        ) as unknown as PrismaService;
      },
      inject: [ConfigService, RequestContextService],
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  //* $connect/$disconnect ARE CORE PrismaClient METHODS — GUARANTEED TO
  //* SURVIVE `.$extends()`, UNLIKE THE CUSTOM onModuleInit/onModuleDestroy
  //* THIS REPLACED (SEE prisma.service.ts).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.prisma.$connect();
  }

  async onApplicationShutdown() {
    await this.prisma.$disconnect();
  }
}
