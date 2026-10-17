/**
 * GOAL: DATA-SOURCE-AGNOSTIC PAGINATION PORT.
 * PaginationService DEPENDS ONLY ON THIS SHAPE, NEVER ON A SPECIFIC ORM.
 * ANY REPOSITORY (PRISMA, RAW SQL, ELASTICSEARCH, AN EXTERNAL API, ...) CAN
 * PLUG IN AS LONG AS IT EXPOSES count()/findMany() WITH THIS SIGNATURE.
 */
export interface IPaginationDataSource {
  count(args: { where?: any }): Promise<number>;
  findMany(args: any): Promise<any[]>;
}

/**
 * GOAL: EXTRACT THE EXACT findMany ARGS A CONCRETE DATA SOURCE DECLARES
 * (E.G. PRISMA'S GENERATED Prisma.UserFindManyArgs FOR PrismaClient['user']),
 * SO where/select/include/orderBy STAY AS STRICT AS THE SOURCE ITSELF DEFINES
 * THEM INSTEAD OF BEING HAND-ROLLED `any` FIELDS.
 */
export type TFindManyArgsOf<TSource extends IPaginationDataSource> = Parameters<
  TSource['findMany']
>[0];
