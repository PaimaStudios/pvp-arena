import {
  MidnightBalancingAdapter,
  type MidnightBalancingAdapterConfig,
  type DefaultBatcherInput,
} from "@paimaexample/batcher";

export type ValidationResult = {
  valid: boolean;
  error?: string;
};

/**
 * Werewolf-specific Midnight Balancing Adapter.
 * Inherits from the official MidnightBalancingAdapter and allows for custom game logic.
 */
export class WerewolfBalancingAdapter extends MidnightBalancingAdapter {
  constructor(walletSeed: string, config: MidnightBalancingAdapterConfig) {
    super(walletSeed, config);
  }

  /**
   * Custom validation for werewolf-related inputs.
   * This can be extended later with specific circuit argument checks.
   */
  override validateInput(input: DefaultBatcherInput): ValidationResult {
    // 1. Basic hex/JSON validation from base class
    const basicValidation = super.validateInput(input);
    if (!basicValidation.valid) {
      return basicValidation;
    }

    // 2. Custom Werewolf logic (can be added here)
    // For now, it just passes through.
    
    return { valid: true };
  }
}
