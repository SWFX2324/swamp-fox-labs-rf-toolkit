// The app's way of confirming something that can't be undone, such as deleting
// a saved plan: the first tap turns the button into a question ("Tap again to
// delete"), and a second tap within four seconds does it. Used instead of the
// browser's confirm pop-up, which some in-app browsers block, and the same as
// the maps' Clear map button.

const WAIT_MS = 4000;

/**
 * Makes a button ask for a second tap before it acts. ask is what the button
 * says while it waits. shouldAsk, when given, can skip the question when there
 * is nothing to lose (an empty plan, say), and then one tap acts at once.
 */
export function twoTap(button: HTMLButtonElement, ask: string, onConfirm: () => void, shouldAsk: () => boolean = () => true): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle = "";
  let idleLabel: string | null = null;
  // Puts the button back as it was, after a second tap or the wait running out.
  const disarm = () => {
    clearTimeout(timer);
    timer = undefined;
    button.classList.remove("armed");
    button.innerHTML = idle;
    if (idleLabel === null) button.removeAttribute("aria-label");
    else button.setAttribute("aria-label", idleLabel);
  };
  button.addEventListener("click", () => {
    if (timer === undefined && shouldAsk()) {
      // First tap: keep what the button showed, and ask.
      idle = button.innerHTML;
      idleLabel = button.getAttribute("aria-label");
      button.textContent = ask;
      button.setAttribute("aria-label", ask);
      button.classList.add("armed");
      timer = setTimeout(disarm, WAIT_MS);
      return;
    }
    if (timer !== undefined) disarm();
    onConfirm();
  });
}
