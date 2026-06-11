/** How long a created challenge stays valid for opponent to accept */
export const CHALLENGE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

/** How long both players have to join after both fund */
export const JOIN_WINDOW_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Async games (Scout/Down/Up) skip the join window — each player runs their own
 * seeded board independently. This is the overall deadline for both runs to be
 * submitted once the match opens; past it, checkAndAdjudicate settles so stakes
 * never strand (one played → they win by forfeit; neither → both refunded).
 */
export const ASYNC_MATCH_DEADLINE_MS = 30 * 60 * 1000; // 30 minutes
