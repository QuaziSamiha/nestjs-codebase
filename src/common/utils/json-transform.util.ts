import type { TransformFnParams } from 'class-transformer';

//* WHEN A DTO IS SUBMITTED AS multipart/form-data (E.G. ALONGSIDE FILE
//* UPLOADS), JSON/ARRAY FIELDS ARRIVE AS STRINGS INSTEAD OF PARSED
//* OBJECTS. USE THIS IN A @Transform() TO ACCEPT BOTH JSON REQUESTS
//* (ALREADY-PARSED VALUE) AND multipart REQUESTS (STRINGIFIED VALUE)
//* WITH THE SAME DTO.
export function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

//* THE NUMERIC COUNTERPART OF emptyStringToUndefined, AND IT MUST BE A
//* SEPARATE HELPER: class-transformer APPLIES @Type() *BEFORE* @Transform(),
//* SO ON A FIELD CARRYING @Type(() => Number) A PLAIN emptyStringToUndefined
//* WOULD ALREADY RECEIVE Number("") === 0 AND COULD NEVER TELL "LEFT BLANK"
//* FROM "GENUINELY ZERO". THIS READS THE UNTOUCHED VALUE OFF THE SOURCE
//* OBJECT INSTEAD. WITHOUT IT, A multipart FORM WITH AN EMPTY PRICE INPUT
//* SILENTLY WRITES 0.
export function blankNumberToUndefined({
  value,
  obj,
  key,
}: TransformFnParams): unknown {
  const raw = (obj as Record<string, unknown> | undefined)?.[key];
  return typeof raw === 'string' && raw.trim() === '' ? undefined : value;
}

//* multipart/form-data HAS NO BOOLEAN TYPE — A CHECKBOX SUBMITS "on", AND
//* CLIENTS VARIOUSLY SEND "true"/"1"/"yes". ACCEPTS ALL OF THOSE (AND THEIR
//* NEGATIVE FORMS) CASE-INSENSITIVELY. ANYTHING UNRECOGNISED IS RETURNED
//* *UNCHANGED* SO @IsBoolean STILL REPORTS IT — A TRANSFORM THAT COERCED
//* EVERYTHING TO false WOULD MAKE @IsBoolean DEAD CODE AND TURN A TYPO INTO
//* A SILENT "no".
const TRUTHY = new Set(['true', '1', 'on', 'yes']);
const FALSY = new Set(['false', '0', 'off', 'no', '']);

export function parseBooleanInput(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (TRUTHY.has(normalized)) return true;
    if (FALSY.has(normalized)) return false;
  }
  return value;
}

//* FOR OPTIONAL STRING FIELDS BACKED BY UNIQUE COLUMNS (E.G. sku): AN
//* EMPTY/WHITESPACE STRING SUBMITTED BY A FORM WOULD BE WRITTEN AS "" AND
//* COLLIDE WITH EVERY OTHER ROW SAVED THE SAME WAY (P2002). TREAT IT AS
//* "NOT PROVIDED" SO @IsOptional SKIPS THE FIELD AND PRISMA NEVER WRITES IT.
export function emptyStringToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

//* TRIMS SURROUNDING WHITESPACE BEFORE VALIDATION RUNS, SO @IsNotEmpty
//* CORRECTLY REJECTS A WHITESPACE-ONLY SUBMISSION (E.G. "   ") INSTEAD OF
//* LETTING IT THROUGH AS "VALID". NON-STRING INPUT PASSES THROUGH
//* UNCHANGED SO @IsString CAN STILL REJECT IT.
export function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

//* FORGIVING PARSER FOR STRING-ARRAY FIELDS (E.G. TAGS) IN multipart
//* FORMS. ACCEPTS A REAL ARRAY, A JSON-ENCODED ARRAY STRING, OR A
//* PLAIN/COMMA-SEPARATED STRING ("coffee, organic" → ['coffee','organic']).
//* NON-STRING INPUT IS PASSED THROUGH SO @IsArray CAN STILL REJECT IT.
export function parseStringArrayInput(value: unknown): unknown {
  const parsed = tryParseJson(value);
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'string') {
    return parsed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return parsed;
}
