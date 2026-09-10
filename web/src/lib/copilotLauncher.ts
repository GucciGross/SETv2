export function openSetCopilot(): boolean {
  const button = document.querySelector<HTMLButtonElement>("[data-slot='chat-toggle-button']");
  if (!button) return false;
  if (button.getAttribute('aria-expanded') !== 'true') button.click();
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
