import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

//* CROSS-FIELD MUTUAL EXCLUSIVITY — e.g. @IsEmptyWhen('type', HomeContentType.HERO_SLIDER)
//* ON `videoUrl` TO ENFORCE "THIS FIELD MUST BE ABSENT WHEN THE DISCRIMINATOR
//* FIELD EQUALS THIS VALUE". PAIR WITH @ValidateIf ON THE SAME PROPERTY WHEN IT
//* ALSO HAS AN UNRELATED "REQUIRED FOR OTHER VALUES" RULE — @ValidateIf GATES
//* THE WHOLE PROPERTY, SO THIS ONLY RUNS ONCE THAT GATE IS ALREADY OPEN (I.E.
//* THE FIELD WAS ACTUALLY PROVIDED), WHICH IS EXACTLY WHEN IT NEEDS TO FIRE.
export function IsEmptyWhen(
  discriminatorProperty: string,
  forbiddenValue: unknown,
  validationOptions?: ValidationOptions,
) {
  return function (target: object, propertyName: string) {
    registerDecorator({
      name: 'isEmptyWhen',
      target: target.constructor,
      propertyName,
      constraints: [discriminatorProperty, forbiddenValue],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [discriminatorProp, disallowedValue] = args.constraints as [
            string,
            unknown,
          ];
          const discriminatorActual = (args.object as Record<string, unknown>)[
            discriminatorProp
          ];
          if (discriminatorActual !== disallowedValue) return true;
          return value === undefined || value === null || value === '';
        },
        defaultMessage(args?: ValidationArguments) {
          const [discriminatorProp, disallowedValue] = args?.constraints as [
            string,
            unknown,
          ];
          return `${args?.property} is not allowed when ${discriminatorProp} is ${String(disallowedValue)}`;
        },
      },
    });
  };
}
