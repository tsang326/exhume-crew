/**
 * Chat message builders. Pure, no React. The messages are fixed text plus validated Disk_Ids;
 * no card text (names, labels, summaries, notes) can reach a message.
 */

const DISK_ID = /^[0-9a-f]{64}$/;

export const SUMMARISE_PREFIX = "Summarise these disks using the floppy-archive skill. Disk ids: ";
export const UNDERTAKER_PREFIX = "Help me with the disk with id ";

export const ARCHIVIST_AGENT = "exhume-archivist";
export const UNDERTAKER_AGENT = "exhume-undertaker";

export function isValidDiskId(id: unknown): id is string {
  return typeof id === "string" && DISK_ID.test(id);
}

function assertDiskId(id: unknown): asserts id is string {
  if (!isValidDiskId(id)) throw new RangeError("Invalid Disk_Id");
}

/** Message for "Summarise new disks", or `null` when there are no ids. Throws on an invalid id. */
export function buildSummariseMessage(ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  for (const id of ids) assertDiskId(id);
  return SUMMARISE_PREFIX + ids.join(" ");
}

/** Message for "Ask the undertaker". Throws on an invalid id. */
export function buildUndertakerMessage(id: string): string {
  assertDiskId(id);
  return UNDERTAKER_PREFIX + id;
}
