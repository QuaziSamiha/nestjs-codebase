import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

//* CROSS-FIELD NUMERIC ORDERING — e.g. @IsGteField('minQuantity') ON
//* `maxQuantity` TO ENFORCE "MAX >= MIN". THE NUMERIC COUNTERPART OF
//* IsAfter (DATE ORDERING). USE IT WHEN THE PAIR HAS NO DB-LEVEL CHECK
//* CONSTRAINT, SO THE ORDERING MUST BE VALIDATED HERE INSTEAD.
export function IsGteField(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (target: object, propertyName: string) {
    registerDecorator({
      name: 'isGteField',
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
          //* BOTH ENDS ARE INDEPENDENTLY OPTIONAL ON UPDATE — ONLY COMPARE WHEN BOTH ARE PRESENT
          if (value === undefined || value === null) return true;
          if (relatedValue === undefined || relatedValue === null) return true;
          if (typeof value !== 'number' || typeof relatedValue !== 'number') {
            return true; //* LET @IsInt/@IsNumber REPORT THE TYPE ERROR INSTEAD
          }
          return value >= relatedValue;
        },
        defaultMessage(args?: ValidationArguments) {
          const relatedPropertyName = (args?.constraints as [string])?.[0];
          return `${args?.property} must be greater than or equal to ${relatedPropertyName}`;
        },
      },
    });
  };
}
