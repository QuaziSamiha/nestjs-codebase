//* ---------------------------------------------------------------------------
//* USER-FACING WORDING FOR A 429.
//*
//* THE DEFAULT THE CLIENT USED TO GET WAS "Too many requests. Please try again later." —
//* TECHNICALLY CORRECT AND USELESS TO THE PERSON READING IT. IT DOESN'T SAY WHAT THEY DID,
//* HOW MUCH IS ALLOWED, OR — THE ONLY PART THEY ACTUALLY NEED — WHEN THEY CAN TRY AGAIN.
//* "LATER" IS 8 SECONDS ON THE BURST TIER AND 15 MINUTES AFTER A FAILED-LOGIN BLOCK, AND A
//* USER WHO CANNOT TELL THOSE APART JUST KEEPS HAMMERING THE BUTTON, WHICH ON THE ROUTES
//* THAT CARRY A blockDuration EXTENDS THEIR OWN LOCKOUT.
//*
//* THE NUMBERS ARE NOT DUPLICATED HERE. THEY ARRIVE FROM THE THROTTLER'S OWN LIMIT DETAIL
//* AT THE MOMENT THE LIMIT TRIPS, SO RETUNING A LIMIT IN throttler.constants.ts OR VIA A
//* THROTTLE_* ENV VAR CHANGES THE SENTENCE AUTOMATICALLY AND CANNOT DRIFT OUT OF SYNC.
//* ---------------------------------------------------------------------------

//* ROUNDS *UP* EVERYWHERE. TELLING SOMEONE "TRY AGAIN IN 14 MINUTES" WHEN 14 MINUTES 30
//* SECONDS REMAIN EARNS THEM A SECOND 429 AND MAKES THE APP LOOK BROKEN; SENDING THEM BACK
//* A FEW SECONDS LATE COSTS NOTHING.
export function humanizeSeconds(totalSeconds: number): string {
  const seconds = Math.max(1, Math.ceil(totalSeconds));

  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  //* HALF-HOUR GRANULARITY PAST AN HOUR: THE 1-HOUR WINDOWS ON SIGNUP / FORGOT-PASSWORD /
  //* OTP-RESEND WOULD OTHERWISE READ AS "60 minutes", WHICH NOBODY SAYS.
  const hours = Math.ceil((minutes / 60) * 2) / 2;
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

//* THE SENTENCE THE USER SEES. PLAIN ENGLISH, THE ACTUAL ALLOWANCE, AND — LAST, SO IT IS
//* THE PART THAT STICKS — WHEN THEY MAY RETRY.
//*
//* `limit` AND `ttlMs` DESCRIBE THE TIER THAT TRIPPED (E.G. 5 PER MINUTE ON LOGIN),
//* `retryAfterSeconds` IS THE THROTTLER'S OWN timeToBlockExpire, WHICH IS THE REMAINING
//* blockDuration ON THE ROUTES THAT SET ONE AND THE REST OF THE WINDOW ON THE ONES THAT
//* DON'T — SO THIS IS ACCURATE FOR BOTH WITHOUT THE CALLER NEEDING TO KNOW WHICH IT IS.
export function buildRateLimitMessage(
  limit: number,
  ttlMs: number,
  retryAfterSeconds: number,
): string {
  const window = humanizeSeconds(ttlMs / 1000);
  const retry = humanizeSeconds(retryAfterSeconds);

  return `You've tried more than ${limit} time${limit === 1 ? '' : 's'} within ${window}. Please try again after ${retry}.`;
}
