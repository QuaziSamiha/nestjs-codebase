//* ═══════════════════════════════════════════════════════════════════════
//* BLOG SELECT SHAPES — PRISMA PROJECTIONS FOR EACH ROLE-BASED RESPONSE.
//* KEEP EACH ONE IN SYNC WITH THE DTO CONSTRUCTOR IT FEEDS
//* (see src/modules/blog/dto/blog-response.dto.ts).
//* ═══════════════════════════════════════════════════════════════════════

//* ADMIN — feeds BlogResponseDto. Full detail: raw `authorId` FK plus the
//* resolved author (incl. role/status) for the back-office dashboard.
//* Never reuse this select for a public/unauthenticated route.
export const BLOG_SELECT_ADMIN = {
  id: true,
  sid: true,
  status: true,
  title: true,
  slug: true,
  content: true,
  blogCategory: true,
  imageUrl: true,
  totalComments: true,
  metaTitle: true,
  metaDescription: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  authorId: true,
  //* MATCHES UserMinifiedResponseDto / MinifiedUser (user/dto/user-response.dto.ts)
  author: {
    select: {
      id: true,
      email: true,
      status: true,
      role: true,
      profile: {
        select: { firstName: true, lastName: true },
      },
    },
  },
} as const;

//* PUBLIC — feeds BlogResponsePublicDto. Public blog-detail view: no
//* `status` (internal workflow state), no raw `authorId`, and the author
//* relation is trimmed to just the byline name — never the staff id/role.
export const BLOG_SELECT_PUBLIC = {
  id: true,
  sid: true,
  title: true,
  slug: true,
  content: true,
  blogCategory: true,
  imageUrl: true,
  totalComments: true,
  metaTitle: true,
  metaDescription: true,
  publishedAt: true,
  author: {
    select: {
      profile: {
        select: { firstName: true, lastName: true },
      },
    },
  },
} as const;

//* CONFLICT CHECK — feeds the slug-uniqueness guard in create/update.
//* Deliberately cheap: no joins, no content/SEO columns.
export const BLOG_SELECT_SLUG_CONFLICT = {
  id: true,
  slug: true,
  title: true,
} as const;
