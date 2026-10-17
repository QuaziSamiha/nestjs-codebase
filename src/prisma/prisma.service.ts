import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from 'pg';
const { Pool } = pkg;

//* CONNECT/DISCONNECT LIFECYCLE LIVES ON PrismaModule (OnApplicationBootstrap/
//* OnApplicationShutdown), NOT HERE — SEE prisma.module.ts. THE DI-PROVIDED
//* INSTANCE FOR THIS TOKEN IS THE audit-log-EXTENDED CLIENT (`.$extends()`),
//* WHICH ONLY GUARANTEES CORE PrismaClient METHODS ($connect/$disconnect/
//* $transaction/MODEL DELEGATES) SURVIVE — NOT ARBITRARY CUSTOM SUBCLASS
//* METHODS LIKE onModuleInit/onModuleDestroy WOULD HAVE BEEN.
@Injectable()
export class PrismaService extends PrismaClient {
  constructor(configService: ConfigService) {
    //* 1. READ THE CONNECTION STRING AND POOL SIZING FROM THE 'database' NAMESPACE, NOT PROCESS.ENV DIRECTLY
    const databaseUrl = configService.get<string>('database.url');
    const poolMax = configService.get<number>('database.pool.max');
    const idleTimeoutMillis = configService.get<number>(
      'database.pool.idleTimeoutMillis',
    );
    const connectionTimeoutMillis = configService.get<number>(
      'database.pool.connectionTimeoutMillis',
    );

    //* 2. SETUP THE CONNECTION POOL
    const pool = new Pool({
      connectionString: databaseUrl,
      max: poolMax,
      idleTimeoutMillis,
      connectionTimeoutMillis,
    });

    //* 3. SETUP THE ADAPTER
    //* disposeExternalPool: true — WITHOUT THIS, $disconnect() ON SHUTDOWN
    //* CLOSES THE PRISMA ENGINE BUT LEAVES THE UNDERLYING PG POOL'S TCP
    //* CONNECTIONS OPEN, LEAKING CONNECTIONS ON EVERY RESTART/REDEPLOY
    const adapter = new PrismaPg(pool, { disposeExternalPool: true });

    //* 4. PASS THE ADAPTER TO THE PRISMA CLIENT CONSTRUCTOR
    super({ adapter });
  }
}
