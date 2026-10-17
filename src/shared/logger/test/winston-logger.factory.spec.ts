import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import {
  buildWinstonModuleOptions,
  LoggerConfig,
} from '../winston-logger.factory';
import { RequestContextService } from '../request-context.service';

const baseConfig: LoggerConfig = {
  level: 'debug',
  dir: 'logs',
  maxSize: '20m',
  maxFiles: '14d',
  consoleEnabled: true,
  fileEnabled: true,
  errorFileEnabled: true,
  jsonConsole: false,
};

describe('buildWinstonModuleOptions', () => {
  let requestContextService: RequestContextService;

  beforeEach(() => {
    requestContextService = new RequestContextService();
  });

  it('creates one transport per enabled flag, in console/application/error order', () => {
    const { transports } = buildWinstonModuleOptions(
      baseConfig,
      requestContextService,
    );

    expect(transports).toHaveLength(3);
    expect(transports![0]).toBeInstanceOf(winston.transports.Console);
    expect(transports![1]).toBeInstanceOf(DailyRotateFile);
    expect(transports![2]).toBeInstanceOf(DailyRotateFile);
  });

  it('omits a transport entirely when its flag is disabled', () => {
    const { transports } = buildWinstonModuleOptions(
      { ...baseConfig, consoleEnabled: false, errorFileEnabled: false },
      requestContextService,
    );

    expect(transports).toHaveLength(1);
    expect(transports![0]).toBeInstanceOf(DailyRotateFile);
  });

  it('applies config.level to the console and application-file transports', () => {
    const { transports } = buildWinstonModuleOptions(
      { ...baseConfig, level: 'warn' },
      requestContextService,
    );

    const [consoleTransport, applicationFile] = transports as [
      winston.transports.ConsoleTransportInstance,
      DailyRotateFile,
    ];

    expect(consoleTransport.level).toBe('warn');
    expect(applicationFile.level).toBe('warn');
  });

  it("hardcodes the error-file transport's level to 'error' regardless of config.level", () => {
    const { transports } = buildWinstonModuleOptions(
      { ...baseConfig, level: 'debug' },
      requestContextService,
    );

    const errorFile = transports![2] as DailyRotateFile;
    expect(errorFile.level).toBe('error');
  });

  it('names application and error files distinctly and points both at config.dir', () => {
    const { transports } = buildWinstonModuleOptions(
      { ...baseConfig, dir: 'custom-logs' },
      requestContextService,
    );

    const [, applicationFile, errorFile] = transports as [
      unknown,
      DailyRotateFile,
      DailyRotateFile,
    ];

    expect(applicationFile.filename).toBe('application-%DATE%.log');
    expect(applicationFile.dirname).toBe('custom-logs');
    expect(errorFile.filename).toBe('error-%DATE%.log');
    expect(errorFile.dirname).toBe('custom-logs');
  });

  //* PER-TRANSPORT format.transform() IS CALLED DIRECTLY HERE, BYPASSING winston's Logger/
  //* Transport STREAM PLUMBING ENTIRELY — createLogger()'s OWN 'data' EVENT FIRES BEFORE ANY
  //* PER-TRANSPORT format RUNS (THAT HAPPENS LATER, INSIDE EACH TRANSPORT'S OWN _write()), SO
  //* IT CAN'T OBSERVE ENRICHMENT/REDACTION. CALLING .transform() DIRECTLY IS THE DETERMINISTIC,
  //* SYNCHRONOUS WAY TO UNIT-TEST THE ACTUAL FORMAT PIPELINE BUILT BY buildWinstonModuleOptions.
  it('enriches a log entry with the current request context correlationId', () => {
    const { transports } = buildWinstonModuleOptions(
      baseConfig,
      requestContextService,
    );
    const applicationFile = transports![1] as DailyRotateFile;

    let transformed: winston.Logform.TransformableInfo | boolean = false;
    requestContextService.run({ correlationId: 'req-test-123' }, () => {
      transformed = applicationFile.format!.transform(
        { level: 'info', message: 'hello' },
        {},
      );
    });

    expect(transformed).not.toBe(false);
    expect(
      (transformed as winston.Logform.TransformableInfo).correlationId,
    ).toBe('req-test-123');
  });

  it('redacts sensitive metadata before it reaches a transport', () => {
    const { transports } = buildWinstonModuleOptions(
      baseConfig,
      requestContextService,
    );
    const applicationFile = transports![1] as DailyRotateFile;

    const transformed = applicationFile.format!.transform(
      { level: 'info', message: 'login attempt', password: 'hunter2' },
      {},
    ) as winston.Logform.TransformableInfo & { password?: string };

    expect(transformed.password).toBe('[REDACTED]');
  });
});
