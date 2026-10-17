import { ValidationError } from 'class-validator';

//* WALKS A ValidationError TREE — INCLUDING NESTED @ValidateNested CHILDREN,
//* E.G. EACH ARRAY ITEM INSIDE `items: CreateBatchDto[]` ON AddStockDto — AND
//* PRODUCES ONE HUMAN-READABLE MESSAGE PER FAILED CONSTRAINT. WITHOUT THIS,
//* NEST'S DEFAULT ValidationPipe FLATTENING PREPENDS THE RAW DOT-PATH (E.G.
//* "items.0.Quantity must be at least 1") INSTEAD OF A READABLE LABEL.
export function formatValidationErrors(
  errors: ValidationError[],
  path: string[] = [],
): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    const currentPath = [...path, error.property];
    if (error.constraints) {
      const label = arrayItemLabel(currentPath);
      for (const constraintMessage of Object.values(error.constraints)) {
        messages.push(
          label ? `${label}: ${constraintMessage}` : constraintMessage,
        );
      }
    }
    if (error.children?.length) {
      messages.push(...formatValidationErrors(error.children, currentPath));
    }
  }
  return messages;
}

//* THE FIRST PURELY-NUMERIC SEGMENT IN THE PATH IS A @ValidateNested ARRAY
//* INDEX (0-BASED) — RENDER IT AS A 1-BASED "Item N" LABEL FOR THE CLIENT
//* RATHER THAN LEAKING THE INTERNAL INDEX/PROPERTY PATH.
function arrayItemLabel(path: string[]): string | null {
  const index = path.findIndex((segment) => /^\d+$/.test(segment));
  return index === -1 ? null : `Item ${Number(path[index]) + 1}`;
}
