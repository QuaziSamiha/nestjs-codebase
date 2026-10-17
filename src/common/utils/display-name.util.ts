export interface DisplayNameSource {
  firstName?: string | null;
  lastName?: string | null;
}

//* SINGLE SOURCE OF TRUTH FOR "firstName + lastName" DISPLAY STRINGS.
//* Profile HAS NO STORED `name` COLUMN — EVERY CALLER THAT USED TO READ
//* profile.name DERIVES IT HERE INSTEAD, SO THERE IS NOTHING LEFT TO DRIFT
//* OUT OF SYNC.
export function formatDisplayName(
  profile?: DisplayNameSource | null,
): string | undefined {
  if (!profile) return undefined;
  return (
    [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() ||
    undefined
  );
}
