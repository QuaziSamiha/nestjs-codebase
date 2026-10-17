import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter';
import { Request, Response } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { swaggerMultipartLogoRequestInterceptor } from './common/utils/swagger-multipart-formdata.util';
import cookieParser from 'cookie-parser';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

async function bootstrap() {
  //* bufferLogs HOLDS FRAMEWORK BOOTSTRAP LOGS (ROUTE MAPPING, MODULE INIT) UNTIL app.useLogger()
  //* ATTACHES WINSTON BELOW, SO EVERY LOG — INCLUDING NEST'S OWN — GOES THROUGH THE SAME PIPELINE
  //* TYPED AS NestExpressApplication SO app.set('trust proxy', ...) BELOW IS AVAILABLE.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') || 8000;
  const prefix = configService.get<string>('app.apiPrefix') || 'api/v1';
  const appName = configService.get<string>('app.name') || 'My App';

  //* DECIDES WHAT req.ip RESOLVES TO, WHICH IS WHAT THE RATE LIMITER BUCKETS BY.
  //* 0 (THE DEFAULT) TRUSTS NO PROXY AND USES THE RAW SOCKET IP — CORRECT FOR LOCAL AND
  //* DIRECT-EXPOSURE RUNS. BEHIND A LOAD BALANCER THIS **MUST** BE SET TO THE REAL HOP
  //* COUNT VIA THROTTLE_TRUST_PROXY_HOPS, OR EVERY CALLER PRESENTS AS THE PROXY'S IP AND
  //* THE ENTIRE INTERNET SHARES ONE RATE-LIMIT BUCKET. NOTE THE OTHER FAILURE DIRECTION IS
  //* WORSE: TRUSTING MORE HOPS THAN EXIST LETS A CLIENT SPOOF X-Forwarded-For AND MINT A
  //* FRESH BUCKET PER REQUEST. THIS CANNOT BE VALIDATED LOCALLY — THERE IS NO PROXY IN
  //* FRONT OF localhost. SEE docs/concepts/rate-limiting.md §2.6 AND §6.6.
  const trustProxyHops =
    configService.get<number>('throttler.trustProxyHops') ?? 0;
  app.set('trust proxy', trustProxyHops);

  // * Security middleware
  app.enableCors({
    origin: true, // For dev, this allows all origins
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  app.use(cookieParser());

  // * Enable global validation
  // * Health routes stay unprefixed/unversioned — orchestrator probe paths must not move when the API version bumps
  app.setGlobalPrefix(prefix, {
    exclude: ['health', 'health/live', 'health/ready'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strips away fields that aren't in the DTO
      forbidNonWhitelisted: true, // Throws an error if unknown fields are sent
      transform: true, // Automatically transforms payloads to DTO instances
      // * Skip Nest's own dot-path flattening (e.g. "items.0.Quantity must be
      // * at least 1") — pass the raw ValidationError[] through so
      // * GlobalExceptionFilter's formatValidationErrors can turn nested
      // * array errors into readable "Item N: ..." messages instead.
      exceptionFactory: (errors) => new BadRequestException(errors),
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle(`${appName} API`)
    .setDescription(
      `API documentation for ${appName}. This documentation provides detailed information about all available endpoints, authentication methods, and data models.`,
    )
    .setVersion('1.0.0')
    .addBearerAuth() // * For JWT headers
    .addCookieAuth('refreshToken') // * Matches your cookie-parser setup
    .build();

  const document = SwaggerModule.createDocument(app, config);
  // Enhanced Swagger UI configuration
  SwaggerModule.setup('api-doc', app, document, {
    explorer: true,
    swaggerOptions: {
      showRequestDuration: true,
      persistAuthorization: true,
      defaultModelRendering: 'example',
      // ADD THIS to ensure your nested objects are expanded by default:
      defaultModelExpandDepth: 5,
      defaultModelsExpandDepth: 3,
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      // * Add multipart form-data support
      requestInterceptor: swaggerMultipartLogoRequestInterceptor,
    },
  });

  // * ======= ROOT ENDPOINT =======
  app.getHttpAdapter().get('/', (req: Request, res: Response) => {
    res.send(`${appName} Server`);
  });

  // Enable shutdown hooks
  app.enableShutdownHooks();

  const logger = new Logger('Bootstrap');
  logger.log(`Application is running on: http://localhost:${port}/${prefix}`);
  logger.log(`Swagger UI is running on: http://localhost:${port}/api-doc`);
  await app.listen(port);
}
// bootstrap();
bootstrap().catch((err) => {
  new Logger('Bootstrap').error('Error starting server', err);
  process.exit(1);
});
