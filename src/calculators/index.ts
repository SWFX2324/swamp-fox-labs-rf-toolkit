import { fsplCalculator } from "./fspl";

export interface Calculator {
  /** URL hash and tab id. */
  id: string;
  title: string;
  render(): HTMLElement;
}

export const calculators: Calculator[] = [fsplCalculator];
