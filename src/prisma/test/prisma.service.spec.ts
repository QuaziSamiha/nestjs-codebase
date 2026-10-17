import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import pkg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../prisma.service';

//* MOCK 'pg' SO NO REAL TCP CONNECTION IS EVER OPENED IN A UNIT TEST.
//* WE ONLY CARE THAT PrismaService CONSTRUCTS THE Pool WITH THE RIGHT OPTIONS.
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation((options) => ({ options })),
}));

//* MOCK THE ADAPTER SO THE REAL PRISMA ENGINE NEVER SPINS UP.
//* SHAPE MUST SATISFY PrismaClient's CONSTRUCTOR-TIME ADAPTER/PROVIDER CHECK.
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({
    provider: 'postgres',
    adapterName: '@prisma/adapter-pg',
  })),
}));

const mockPool = pkg.Pool as unknown as jest.Mock;
const mockPrismaPg = PrismaPg as unknown as jest.Mock;

describe('PrismaService', () => {
  let service: PrismaService;

  //* MIRRORS THE SHAPE PRODUCED BY src/prisma/config/database.config.ts.
  //* KEPT AS A FIXTURE SO EACH TEST CAN OVERRIDE INDIVIDUAL FIELDS.
  const databaseConfig = {
    url: 'postgres://user:pass@localhost:5432/test_db',
    pool: {
      max: 25,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 2000,
    },
  };

  const configServiceMock: Partial<ConfigService> = {
    get: jest.fn((key: string) => {
      const path = key.split('.').slice(1); // drop the 'database' root segment
      return path.reduce<unknown>(
        (value, segment) => (value as Record<string, unknown>)?.[segment],
        databaseConfig,
      );
    }),
  };

  beforeEach(async () => {
    mockPool.mockClear();
    mockPrismaPg.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('builds the pg Pool from the database config namespace, not process.env directly', () => {
    expect(mockPool).toHaveBeenCalledTimes(1);
    expect(mockPool).toHaveBeenCalledWith({
      connectionString: databaseConfig.url,
      max: databaseConfig.pool.max,
      idleTimeoutMillis: databaseConfig.pool.idleTimeoutMillis,
      connectionTimeoutMillis: databaseConfig.pool.connectionTimeoutMillis,
    });
  });

  it('wires the pool into PrismaPg with disposeExternalPool so $disconnect() does not leak TCP connections', () => {
    expect(mockPrismaPg).toHaveBeenCalledTimes(1);
    const [poolArg, optionsArg] = mockPrismaPg.mock.calls[0];
    expect(poolArg).toBe(mockPool.mock.results[0].value);
    expect(optionsArg).toEqual({ disposeExternalPool: true });
  });

  describe('lifecycle hooks', () => {
    it('onModuleInit connects to the database', async () => {
      const connectSpy = jest
        .spyOn(service, '$connect')
        .mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it('onModuleDestroy disconnects from the database', async () => {
      const disconnectSpy = jest
        .spyOn(service, '$disconnect')
        .mockResolvedValue(undefined);

      await service.onModuleDestroy();

      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });
  });
});
