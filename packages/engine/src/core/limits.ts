/**
 * How much of the simulation one player can use up (Phase 6, part H). Nobody
 * who plays comes near these numbers; they stop somebody who tries to fill the
 * server's memory ("cat f f f f > g" again and again doubles a file until
 * nothing fits any more). The messages are those of a real Linux.
 */

/** The largest file a user may write. (Logs that the system itself writes may grow larger.) */
export const MAX_FILE = 256 * 1024;
/** Files and directories on one machine (an office PC starts with about 130), and bytes in them. */
export const MAX_HOST_NODES = 4000;
export const MAX_HOST_BYTES = 16 * 1024 * 1024;
/** What all commands of one line may read together. */
export const MAX_READ = 4 * 1024 * 1024;
/** Arguments of one command. */
export const MAX_ARGS = 200;
/** What one command may hand to the next one, or to a file. */
export const MAX_PIPE = 1024 * 1024;
/** What one line may print on the screen: the end of it, as a terminal keeps only its last lines anyway. */
export const MAX_SCREEN = 200_000;
/** Lines of context around a match (grep -A, -B, -C). */
export const MAX_CONTEXT = 500;
