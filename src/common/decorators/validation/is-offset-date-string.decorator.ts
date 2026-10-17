import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

//* AN ISO 8601 STRING WITH NO ZONE ("2026-07-01T00:00:00") IS AMBIGUOUS: JS
//* `new Date()` PARSES IT AS THE *SERVER'S* LOCAL TIME, SO THE SAME PAYLOAD
//* MEANS A DIFFERENT INSTANT DEPENDING ON WHERE THE API RUNS. EVERY DateTime
//* COLUMN IS @db.Timestamptz(3) PRECISELY SO AN INSTANT MEANS ONE THING
//* EVERYWHERE — THIS CLOSES THE SAME HOLE AT THE API BOUNDARY.
//*
//* NOTE @IsDateString({ strict: true }) DOES *NOT* DO THIS — ITS STRICT MODE
//* CHECKS CALENDAR VALIDITY (E.G. REJECTS 2026-02-31), NOT OFFSET PRESENCE.
//* PAIR THIS DECORATOR WITH @IsDateString, WHICH STILL OWNS FORMAT ERRORS.
const OFFSET_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/;

export function IsOffsetDateString(validationOptions?: ValidationOptions) {
  return function (target: object, propertyName: string) {
    registerDecorator({
      name: 'isOffsetDateString',
      target: target.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          //* OPTIONAL FIELDS ARE @IsOptional'S JOB, AND A NON-STRING OR
          //* MALFORMED VALUE IS @IsDateString'S — ONLY JUDGE THE ZONE HERE,
          //* SO ONE BAD INPUT PRODUCES ONE MESSAGE INSTEAD OF THREE.
          if (value === undefined || value === null) return true;
          if (typeof value !== 'string') return true;
          return OFFSET_SUFFIX.test(value.trim());
        },
        defaultMessage(args?: ValidationArguments) {
          return `${args?.property} must include a UTC offset, e.g. 2026-07-01T00:00:00Z or 2026-07-01T07:00:00+07:00`;
        },
      },
    });
  };
}
