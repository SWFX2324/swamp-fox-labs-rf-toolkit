import { antennaLengthCalculator } from "./antennaLength";
import { coaxLossCalculator } from "./coaxLoss";
import { converterCalculator } from "./converter";
import { coverageCalculator } from "./coverage";
import { linkBudgetCalculator } from "./linkBudget";
import { meshCalculator } from "./mesh";
import { powerPlanCalculator } from "./powerPlan";
import { satLinkCalculator } from "./satLink";
import { satPointingCalculator } from "./satPointing";
import { settingsCalculator } from "./settings";

export interface Calculator {
  /** URL hash and tab id. */
  id: string;
  /** Older hashes that should still open this calculator. */
  aliases?: string[];
  title: string;
  /** Tab label on phones, where the full titles don't fit on one row. */
  shortTitle?: string;
  /** False for pages opened from the top bar instead of the tab row (Settings). */
  inTabBar?: boolean;
  render(): HTMLElement;
}

export const calculators: Calculator[] = [
  linkBudgetCalculator,
  meshCalculator,
  coverageCalculator,
  antennaLengthCalculator,
  coaxLossCalculator,
  satPointingCalculator,
  satLinkCalculator,
  powerPlanCalculator,
  converterCalculator,
  settingsCalculator,
];
