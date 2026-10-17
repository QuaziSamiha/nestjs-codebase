import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'response_message';

/**
 * GOAL: LET A CONTROLLER METHOD DECLARE ITS OWN SUCCESS MESSAGE WHILE STILL
 * RETURNING PLAIN DATA. ResponseInterceptor READS THIS VIA Reflector AND
 * EMBEDS IT IN THE STANDARD RESPONSE ENVELOPE.
 */
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
