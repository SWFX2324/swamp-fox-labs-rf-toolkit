import { antennaLengthCalculator } from "./antennaLength";
import { coaxLossCalculator } from "./coaxLoss";
import { converterCalculator } from "./converter";
import { linkBudgetCalculator } from "./linkBudget";
import { meshCalculator } from "./mesh";
import { satLinkCalculator } from "./satLink";
import { satPointingCalculator } from "./satPointing";

export interface Calculator {
  /** URL hash and tab id. */
  id: string;
  /** Older hashes that should still open this calculator. */
  aliases?: string[];
  title: string;
  /** Tab label on phones, where the full titles don't fit on one row. */
  shortTitle?: string;
  render(): HTMLElement;
}

export const calculators: Calculator[] = [
  linkBudgetCalculator,
  meshCalculator,
  antennaLengthCalculator,
  coaxLossCalculator,
  satPointingCalculator,
  satLinkCalculator,
  converterCalculator,
];
