export const COPILOT_TOGGLE_SELECTOR = "[data-slot='chat-toggle-button']";

/** CopilotKit v2 exposes aria-pressed/data-state, not aria-expanded. */
export function isSetCopilotOpen(button: Pick<Element, 'getAttribute'> | null = document.querySelector(COPILOT_TOGGLE_SELECTOR)): boolean {
  return button?.getAttribute('aria-pressed') === 'true' || button?.getAttribute('data-state') === 'open';
}

export function openSetCopilot(): boolean {
  const button = document.querySelector<HTMLButtonElement>(COPILOT_TOGGLE_SELECTOR);
  if (!button) return false;
  if (!isSetCopilotOpen(button)) button.click();
  return true;
}

export function focusCopilotInput(): () => void {
  let stopped = false;
  let raf = 0;
  const deadline = performance.now() + 1500;
  const focus = () => {
    if (stopped || performance.now() > deadline) return;
    const textarea = document.querySelector<HTMLTextAreaElement>("[data-testid='copilot-chat-textarea']");
    if (textarea) {
      textarea.focus({ preventScroll: true });
      return;
    }
    raf = requestAnimationFrame(focus);
  };
  raf = requestAnimationFrame(focus);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
