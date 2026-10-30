import { linkBudgetCalculator } from "./linkBudget";

export interface Calculator {
  /** URL hash and tab id. */
  id: string;
  /** Older hashes that should still open this calculator. */
  aliases?: string[];
  title: string;
  render(): HTMLElement;
}

export const calculators: Calculator[] = [linkBudgetCalculator];
