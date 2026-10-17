import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

//* CROSS-FIELD NUMERIC ORDERING — e.g. @IsGteProperty('costPrice') ON
//* `sellingPrice` TO ENFORCE "SELLING PRICE CAN'T UNDERCUT COST PRICE".
//* BOTH FIELDS ARE INDEPENDENT, OPTIONAL COLUMNS AT THE DB LEVEL (NO CHECK
//* CONSTRAINT), SO THE ORDERING MUST BE VALIDATED HERE INSTEAD.
export function IsGteProperty(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (target: object, propertyName: string) {
    registerDecorator({
      name: 'isGteProperty',
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
          //* BOTH ARE OPTIONAL/INDEPENDENT — ONLY COMPARE WHEN BOTH ARE PRESENT
          if (value === undefined || value === null) return true;
          if (relatedValue === undefined || relatedValue === null) return true;
          if (typeof value !== 'number' || typeof relatedValue !== 'number') {
            return true; //* LET @IsNumber REPORT THE TYPE ERROR INSTEAD
          }
          return value >= relatedValue;
        },
        defaultMessage(args?: ValidationArguments) {
          const relatedPropertyName = (args?.constraints as [string])?.[0];
          return `${args?.property} must not be less than ${relatedPropertyName}`;
        },
      },
    });
  };
}
