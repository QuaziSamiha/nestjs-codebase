import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import {
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerLimitDetail,
} from '@nestjs/throttler';
import { buildRateLimitMessage } from '../throttler.util';

//* THE GUARD THAT ACTUALLY ENFORCES THE LIMITS. ThrottlerModule.forRoot/forRootAsync ONLY
//* REGISTERS OPTIONS AND A STORAGE SERVICE — IT APPLIES NOTHING ON ITS OWN, AND THAT IS
//* EXACTLY WHY EVERY ROUTE IN THIS APP WAS UNLIMITED FOR AS LONG AS ThrottlerModule WAS
//* CONFIGURED WITHOUT A GUARD. SEE docs/concepts/rate-limiting.md §2.2.
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly proxyLogger = new Logger(AppThrottlerGuard.name);

  //* THE SELF-CHECK BELOW RUNS ONCE PER PROCESS, NOT ONCE PER REQUEST: WHAT IT INSPECTS IS
  //* A DEPLOYMENT-CONFIG FACT THAT CANNOT CHANGE WHILE THE PROCESS LIVES, AND A PER-REQUEST
  //* VERSION WOULD FLOOD THE LOGS AT PRECISELY THE MOMENT SOMETHING IS WRONG.
  private proxyTrustChecked = false;

  //* TRACK AUTHENTICATED CALLERS BY USER ID SO ONE NAT'd OFFICE DOESN'T SHARE ONE BUDGET,
  //* AND SO A STOLEN-TOKEN ABUSE PATTERN CAN'T BE HIDDEN BY ROTATING IPs. FALLS BACK TO IP.
  //*
  //* HONEST NOTE ON THE user: BRANCH — IT DOES NOT FIRE TODAY. THIS RUNS AS AN APP_GUARD,
  //* AND APP_GUARDS EXECUTE BEFORE CONTROLLER-SCOPED @UseGuards(JwtAuthGuard), SO req.user
  //* IS STILL undefined AT THIS POINT ON EVERY ROUTE. THAT ORDERING IS THE DELIBERATE
  //* CHOICE (docs/concepts/rate-limiting.md §2.7): THROTTLING BEFORE AUTH PROTECTS THE AUTH
  //* GUARD ITSELF — JWT VERIFICATION AND BCRYPT — FROM BEING HAMMERED, AND IS THE ONLY
  //* ORDER UNDER WHICH PUBLIC ROUTES LIKE login AND create-user GET ANY PROTECTION AT ALL.
  //* THE BRANCH STAYS SO THAT ADDING A SECOND, POST-AUTH THROTTLER FOR PER-USER QUOTAS
  //* LATER IS A REGISTRATION CHANGE RATHER THAN AN EDIT HERE.
  protected getTracker(req: Record<string, any>): Promise<string> {
    this.verifyProxyTrustOnce(req);

    const userId = (req as { user?: { id?: number } }).user?.id;
    const ip = (req as { ip?: string }).ip;
    return Promise.resolve(userId ? `user:${userId}` : `ip:${ip ?? 'unknown'}`);
  }

  //* ---------------------------------------------------------------------------
  //* ONE-TIME PROXY-TRUST SELF-CHECK.
  //*
  //* THROTTLE_TRUST_PROXY_HOPS IS THE ONE SETTING IN THIS MODULE THAT CANNOT BE VALIDATED
  //* BEFORE DEPLOY — THERE IS NO PROXY IN FRONT OF localhost TO PRODUCE AN X-Forwarded-For
  //* CHAIN TO COUNT — AND BOTH WAYS OF GETTING IT WRONG FAIL **SILENTLY**, WHICH IS WHY
  //* docs/concepts/rate-limiting.md §6.6 CALLS A DEPLOY THAT LOGS req.ip THE ONLY REAL TEST.
  //* THIS IS THAT TEST, MADE AUTOMATIC: THE FIRST RATE-LIMITED REQUEST OF EACH PROCESS
  //* COMPARES WHAT EXPRESS RESOLVED req.ip TO AGAINST THE RAW SOCKET ADDRESS AND REPORTS
  //* WHICH OF THE TWO FAILURE MODES, IF EITHER, IS LIVE.
  //*
  //* SKIPPED ROUTES NEVER REACH HERE — ThrottlerGuard#canActivate RETURNS ON @SkipThrottle
  //* BEFORE getTracker IS CALLED — SO THE CONTAINER'S OWN /health/ready PROBE, WHICH LOOPS
  //* BACK OVER 127.0.0.1 CARRYING NO FORWARDING HEADER, CANNOT TRIGGER A FALSE ALARM HERE.
  //* ---------------------------------------------------------------------------
  private verifyProxyTrustOnce(req: Record<string, any>): void {
    if (this.proxyTrustChecked) return;
    this.proxyTrustChecked = true;

    const forwardedFor = req.headers?.['x-forwarded-for'] as string | undefined;
    const socketIp = (req.socket as { remoteAddress?: string } | undefined)
      ?.remoteAddress;
    const resolvedIp = req.ip as string | undefined;

    //* express STORES THE CONFIGURED HOP COUNT UNDER ITS OWN SETTING NAME; READING IT BACK
    //* OFF THE REQUEST'S app AVOIDS INJECTING ConfigService INTO A GUARD WHOSE BASE-CLASS
    //* CONSTRUCTOR SIGNATURE BELONGS TO THE LIBRARY AND CAN CHANGE UNDER US ON UPGRADE.
    const hops = (
      req.app as { get?: (k: string) => unknown } | undefined
    )?.get?.('trust proxy');

    //* FAILURE MODE A — A PROXY IS FORWARDING, BUT WE ARE IGNORING IT. req.ip FELL BACK TO
    //* THE SOCKET ADDRESS, WHICH IS THE PROXY'S, SO EVERY CALLER ON EARTH IS SHARING ONE
    //* BUCKET AND THE LIMITER IS EFFECTIVELY A GLOBAL CAP ON THE WHOLE SITE.
    if (forwardedFor && resolvedIp && resolvedIp === socketIp) {
      this.proxyLogger.error(
        `THROTTLE_TRUST_PROXY_HOPS is too low (currently ${String(hops)}). Requests carry ` +
          `X-Forwarded-For ("${forwardedFor}") but req.ip still resolves to the socket ` +
          `address ${socketIp} — so every client shares ONE rate-limit bucket. Set the ` +
          `hop count to the number of proxies actually in front of this process.`,
      );
      return;
    }

    //* FAILURE MODE B — WE TRUST HOPS THAT AREN'T SENDING ANYTHING. NOT DANGEROUS BY ITSELF
    //* (express FALLS BACK TO THE SOCKET ADDRESS WHEN THE HEADER IS ABSENT, SO NOTHING IS
    //* SPOOFABLE *YET*), BUT IT MEANS THE PROXY IS NOT SETTING X-Forwarded-For AND THE
    //* SETTING IS A NO-OP THAT LOOKS CONFIGURED — WHICH IS HOW MODE A HIDES.
    if (!forwardedFor && typeof hops === 'number' && hops > 0) {
      this.proxyLogger.warn(
        `THROTTLE_TRUST_PROXY_HOPS is ${hops}, but the first throttled request arrived ` +
          `with no X-Forwarded-For header. Either nothing is proxying this process (the ` +
          `value should be 0) or the proxy is not sending the header — add ` +
          `"proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;" to it.`,
      );
      return;
    }

    //* THE HEALTHY CASE, LOGGED ONCE SO A DEPLOY CAN BE CONFIRMED FROM THE LOGS RATHER THAN
    //* ASSUMED. THIS SINGLE LINE IS THE "LOG req.ip FOR A KNOWN EXTERNAL CLIENT" STEP.
    this.proxyLogger.log(
      `Rate-limit bucketing verified: trust proxy hops=${String(hops)}, ` +
        `X-Forwarded-For=${forwardedFor ?? '(none)'}, socket=${socketIp ?? '(unknown)'}, ` +
        `req.ip=${resolvedIp ?? '(unknown)'}.`,
    );
  }

  //* ---------------------------------------------------------------------------
  //* THE 429 THE USER ACTUALLY READS.
  //*
  //* TWO THINGS ARE WRONG WITH WHAT THE LIBRARY PRODUCES HERE, AND BOTH ARE FIXED IN THIS
  //* ONE OVERRIDE BECAUSE THIS IS THE ONLY POINT THAT STILL HAS THE LIMIT DETAIL IN HAND —
  //* BY THE TIME GlobalExceptionFilter SEES THE EXCEPTION, limit / ttl / timeToBlockExpire
  //* ARE GONE AND ALL IT COULD DO IS GUESS.
  //*
  //* 1. THE MESSAGE. THE DEFAULT IS "Too many requests. Please try again later." — SEE
  //*    throttler.util.ts FOR WHY "later" IS THE WORST POSSIBLE WORD ON ROUTES WHOSE REAL
  //*    ANSWER RANGES FROM 8 SECONDS TO 15 MINUTES.
  //*
  //* 2. THE Retry-After HEADER. THE LIBRARY SUFFIXES IT WITH THE TIER NAME — IT SETS
  //*    `Retry-After-short`, NEVER PLAIN `Retry-After`, BECAUSE THESE THROTTLERS ARE NAMED
  //*    (AN UNNAMED ONE IS CALLED "default" AND GETS AN EMPTY SUFFIX). SO THE ONE HEADER
  //*    EVERY HTTP CLIENT, PROXY AND BROWSER DEVTOOL LOOKS FOR WAS MISSING FROM EVERY 429
  //*    THIS APP HAS EVER SENT. SET IT EXPLICITLY; THE SUFFIXED ONE STAYS FOR TIER DETAIL.
  //* ---------------------------------------------------------------------------
  //* NOT `async`: THE BASE CLASS AWAITS THIS, SO A REJECTED PROMISE AND A THROWN ERROR
  //* REACH IT IDENTICALLY — AND REJECTING KEEPS THE METHOD HONEST ABOUT HAVING NOTHING
  //* TO AWAIT, RATHER THAN CARRYING A NO-OP `await` PURELY TO SATISFY require-await.
  protected throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { limit, ttl, timeToBlockExpire } = throttlerLimitDetail;

    //* timeToBlockExpire IS SECONDS (THE STORAGE SERVICE DIVIDES BY 1000), UNLIKE ttl,
    //* WHICH IS MILLISECONDS. FLOOR OF 1 SO A BLOCK WITH <1s LEFT NEVER RENDERS AS
    //* "0 seconds" OR, WORSE, A NEGATIVE Retry-After.
    const retryAfterSeconds = Math.max(1, Math.ceil(timeToBlockExpire));

    const { res } = this.getRequestResponse(context);
    res.header('Retry-After', String(retryAfterSeconds));

    return Promise.reject(
      new ThrottlerException(
        buildRateLimitMessage(limit, ttl, retryAfterSeconds),
      ),
    );
  }
}
