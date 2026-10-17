import { Prisma } from '../../generated/prisma/client';
import { AuditAction } from '../../generated/prisma/enums';
import type { RequestContextService } from '../../shared/logger/request-context.service';
import { redactSensitiveFields } from '../../shared/logger/utils/redact.util';
import { DEFAULT_REDACTED_KEYS } from '../../shared/logger/constants/logger.constants';

//* MODELS WHOSE MUTATIONS ARE AUDITED (docs/audit-log.md). ADDING A NEW MODEL
//* HERE IS THE *ONLY* STEP NEEDED TO START AUDITING IT — NO SCHEMA CHANGE, NO
//* MIGRATION. MODELS THAT ARE ALREADY THEIR OWN APPEND-ONLY CHANGE LOGS (E.G.
//* A STATUS-HISTORY TABLE) SHOULD STAY OUT — AUDITING THEM JUST DUPLICATES ROWS.
//*
//* EXPORTED (NOT JUST A LOCAL Set) SO audit-log/dto/audit-log-query.dto.ts CAN
//* VALIDATE THE `entityType` FILTER AGAINST THE SAME LIST — ONE SOURCE OF
//* TRUTH FOR "WHAT'S TRACKED", NOT TWO LISTS THAT CAN DRIFT APART.
export const TRACKED_AUDIT_MODELS = ['Blog'] as const;
export type TrackedAuditModel = (typeof TRACKED_AUDIT_MODELS)[number];

const TRACKED_MODELS = new Set<string>(TRACKED_AUDIT_MODELS);

type PlainRecord = Record<string, unknown>;

//* MODEL DELEGATES ARE THE MODEL NAME WITH A LOWERCASE FIRST LETTER
//* (Prisma.blog, Prisma.auditLog, ...) — TRUE FOR EVERY TRACKED MODEL.
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function redact(value: PlainRecord | null | undefined) {
  return value ? redactSensitiveFields(value, DEFAULT_REDACTED_KEYS) : value;
}

//* SHALLOW FIELD-LEVEL DIFF — ONLY KEYS WHOSE VALUE ACTUALLY CHANGED MAKE IT
//* INTO THE STORED diff, SO A ROW STAYS SMALL AND THE INTERESTING PART ISN'T
//* BURIED IN 30 UNCHANGED COLUMNS. JSON.stringify COMPARISON HANDLES
//* PRIMITIVES, DATES, AND NESTED Json COLUMNS UNIFORMLY.
function diffFields(
  before: PlainRecord | null | undefined,
  after: PlainRecord | null | undefined,
): { before: PlainRecord; after: PlainRecord } | undefined {
  if (!before || !after) return undefined;

  const beforeChanged: PlainRecord = {};
  const afterChanged: PlainRecord = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      beforeChanged[key] = before[key];
      afterChanged[key] = after[key];
    }
  }

  return Object.keys(beforeChanged).length > 0
    ? { before: beforeChanged, after: afterChanged }
    : undefined;
}

//* deletedAt TRANSITIONING null -> non-null IS A SOFT DELETE, NOT A PLAIN
//* UPDATE. A TRACKED MODEL WITHOUT A deletedAt COLUMN SIMPLY NEVER MATCHES
//* THIS AND STAYS `UPDATE`.
function resolveUpdateAction(
  before: PlainRecord | null | undefined,
  after: PlainRecord | null | undefined,
): AuditAction {
  const wasDeleted = Boolean(before?.deletedAt);
  const isDeleted = Boolean(after?.deletedAt);
  return !wasDeleted && isDeleted
    ? AuditAction.SOFT_DELETE
    : AuditAction.UPDATE;
}

//* PRISMA CLIENT EXTENSION — AUTOMATICALLY WRITES AN AuditLog ROW FOR EVERY
//* create/update/upsert/delete AGAINST A TRACKED MODEL. SEE docs/audit-log.md.
//*
//* WHY THIS CAPTURES `extendedClient` VIA A CLOSURE INSTEAD OF USING `this`:
//* THE OBVIOUS DESIGN — READING `this` INSIDE `$allOperations` TO CALL
//* SIBLING MODELS (`this.auditLog.create(...)`) — DOES NOT WORK ON THIS
//* PRISMA VERSION (7.7.0's rewritten, non-engine client architecture):
//* EMPIRICALLY VERIFIED (scratch script against a real DB) THAT `this` INSIDE
//* THE HOOK IS *NOT* THE EXTENDED CLIENT AND EXPOSES NO MODEL DELEGATES —
//* CONTRARY TO OLDER PRISMA DOCS/EXAMPLES. `Prisma.getExtensionContext(this)`
//* WAS ALSO TRIED AND DOESN'T HELP HERE EITHER (IT'S FOR `client`/`model`
//* EXTENSION COMPONENTS, NOT `query`). THE WORKING FIX: `Prisma.defineExtension`
//* TAKES A FACTORY CALLBACK WHOSE RETURN VALUE (THE EXTENDED CLIENT) IS
//* CAPTURED INTO `extendedClient` IMMEDIATELY, SYNCHRONOUSLY, BEFORE ANY QUERY
//* CAN RUN — SO EVERY HOOK INVOCATION CAN SAFELY USE IT.
//*
//* TRADE-OFF THIS FORCES: THE AUDIT WRITE NO LONGER PARTICIPATES IN THE SAME
//* DB TRANSACTION AS THE MUTATION IT RECORDS (IT RUNS ON A SEPARATE POOLED
//* CONNECTION), SO IT IS **NOT** ATOMIC WITH BaseRepository.withTransaction()
//* CALLS — IF A SURROUNDING TRANSACTION LATER ROLLS BACK FOR AN UNRELATED
//* REASON, AN AUDIT ROW FOR THE (NOW-UNDONE) MUTATION CAN STILL PERSIST. THIS
//* IS A DELIBERATE, DOCUMENTED DEVIATION FROM THE ORIGINAL DESIGN GOAL (SEE
//* docs/audit-log.md, Known Gaps) — TRUE TRANSACTIONAL AUDIT WRITES WOULD
//* NEED EITHER A DIFFERENT PRISMA VERSION/API OR EXPLICIT `tx` THREADING,
//* WHICH IS EXACTLY THE PER-CALL-SITE BOILERPLATE THIS EXTENSION EXISTS TO AVOID.
export function createAuditLogExtension(requestContext: RequestContextService) {
  let extendedClient: any;

  const extension = Prisma.defineExtension((client) => {
    const ext = client.$extends({
      name: 'audit-log',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!model || !TRACKED_MODELS.has(model)) {
              return query(args);
            }

            const rawUserId = requestContext.get('userId');
            const actorId =
              rawUserId !== undefined ? Number(rawUserId) : undefined;
            const delegate = extendedClient[delegateName(model)];
            const writeArgs = args as {
              where?: unknown;
              select?: unknown;
              include?: unknown;
            };

            if (operation === 'create') {
              const result = (await query(args)) as PlainRecord;
              await extendedClient.auditLog.create({
                data: {
                  actorId,
                  entityType: model,
                  entityId: result?.id,
                  action: AuditAction.CREATE,
                  diff: { after: redact(result) } as Prisma.InputJsonValue,
                },
              });
              return result;
            }

            if (operation === 'update' || operation === 'upsert') {
              const before = (await delegate.findUnique({
                where: writeArgs.where,
                select: writeArgs.select,
                include: writeArgs.include,
              })) as PlainRecord | null;

              const result = (await query(args)) as PlainRecord;
              const action = resolveUpdateAction(before, result);
              const diff = diffFields(redact(before), redact(result));

              if (diff) {
                await extendedClient.auditLog.create({
                  data: {
                    actorId,
                    entityType: model,
                    entityId: result?.id ?? before?.id,
                    action,
                    diff: diff as unknown as Prisma.InputJsonValue,
                  },
                });
              }
              return result;
            }

            if (operation === 'delete') {
              const before = (await delegate.findUnique({
                where: writeArgs.where,
                select: writeArgs.select,
                include: writeArgs.include,
              })) as PlainRecord | null;

              const result = (await query(args)) as PlainRecord;

              await extendedClient.auditLog.create({
                data: {
                  actorId,
                  entityType: model,
                  entityId: (result?.id ?? before?.id) as number,
                  action: AuditAction.DELETE,
                  diff: { before: redact(before) } as Prisma.InputJsonValue,
                },
              });
              return result;
            }

            //* BULK OPERATIONS (updateMany/deleteMany/createMany) AREN'T
            //* DIFFED PER-ROW IN THIS PASS — DOCUMENTED LIMITATION, NOT A
            //* SILENT GAP. SEE docs/audit-log.md.
            return query(args);
          },
        },
      },
    });
    extendedClient = ext;
    return ext;
  });

  return extension;
}
