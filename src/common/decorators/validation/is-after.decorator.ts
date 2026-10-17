import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

//* CROSS-FIELD DATE ORDERING — e.g. @IsAfter('startsAt') ON `endsAt` TO
//* ENFORCE "END MUST COME AFTER START". THESE DATE PAIRS ARE NULLABLE AND
//* INDEPENDENT AT THE DB LEVEL (NO CHECK CONSTRAINT), SO THE ORDERING MUST
//* BE VALIDATED HERE INSTEAD.
export function IsAfter(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (target: object, propertyName: string) {
    registerDecorator({
      name: 'isAfter',
      target: target.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as [string];
          const relatedValue = (args.object as Record<string, unknown>)[
            relatedPropertyName
          ];
          //* BOTH ENDS ARE OPTIONAL/INDEPENDENT — ONLY COMPARE WHEN BOTH ARE PRESENT
          if (value === undefined || value === null) return true;
          if (relatedValue === undefined || relatedValue === null) return true;
          if (typeof value !== 'string' || typeof relatedValue !== 'string') {
            return true;
          }
          const date = new Date(value);
          const relatedDate = new Date(relatedValue);
          if (
            Number.isNaN(date.getTime()) ||
            Number.isNaN(relatedDate.getTime())
          ) {
            return true; //* LET @IsDateString REPORT THE FORMAT ERROR INSTEAD
          }
          return date.getTime() > relatedDate.getTime();
        },
        defaultMessage(args?: ValidationArguments) {
          const relatedPropertyName = (args?.constraints as [string])?.[0];
          return `${args?.property} must be after ${relatedPropertyName}`;
        },
      },
    });
  };
}
