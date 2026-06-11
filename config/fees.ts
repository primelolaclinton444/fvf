import type { FeeStructure } from '@/types/challenge';

/**
 * Default fee structure for all challenges.
 * In Phase 3 these go to real wallets. For now they're tracked in coins.
 */
export const defaultFeeStructure: FeeStructure = {
  developerFeePct: 5,
  protocolFeePct: 5,
};

/**
 * The wallet UIDs that collect fees in Phase 1 (coins).
 * In Phase 3 these become real wallet addresses.
 */
export const DEVELOPER_WALLET_UID = 'U_DEVELOPER';
export const PROTOCOL_WALLET_UID = 'U_PROTOCOL';
