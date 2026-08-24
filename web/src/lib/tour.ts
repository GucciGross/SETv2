import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { api } from './api';

/**
 * First-run spotlight tour (driver.js — MIT, ~5 KB, no deps).
 * Walks the core loop: navigate -> write -> connect AI -> ask the copilot.
 * Steps target stable selectors; each is skippable and the whole tour is
 * replayable from the dashboard checklist.
 */

let driverObj: ReturnType<typeof driver> | null = null;

export const TOUR_STEPS: (DriveStep & { mobile?: boolean })[] = [
  {
    element: '[data-tour="space-switcher"]',
    popover: {
      title: 'Workspaces',
      description: 'Everything lives in a workspace. Switch between them, or create a new one for a different team or project.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="new-page"]',
    popover: {
      title: 'Write a page',
      description: 'Rich markdown, wiki links with [[double brackets]], checkboxes, code, math, diagrams. Pages link into a knowledge graph automatically.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="nav"]',
    popover: {
      title: 'Knowledge core',
      description: 'Graph view, notebooks (research with citations), databases (table, kanban, calendar) and My Tasks. Optional work surfaces — coding, terminal, 3D — toggle in Settings.',
      side: 'right',
      align: 'start',
    },
  },
  {
    element: '[data-tour="copilot"]',
    popover: {
      title: 'The copilot',
      description: 'An agent over your workspace: it searches, reads and writes pages, answers from notebook sources with citations, and makes study decks. Bring your own LLM key in Settings → AI Providers.',
      side: 'left',
      align: 'start',
    },
  },
  {
    element: '[data-tour="checklist"]',
    popover: {
      title: 'You are in control',
      description: 'Self-hosted, your Postgres, your keys. The dashboard checklist tracks the few steps to a fully-activated workspace.',
      side: 'top',
      align: 'center',
    },
  },
];

export function startTour() {
  if (driverObj) {
    driverObj.destroy();
    driverObj = null;
  }
  driverObj = driver({
    showProgress: true,
    progressText: '{current} / {total}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    allowClose: true,
    stagePadding: 8,
    stageRadius: 12,
    overlayColor: 'rgba(4, 6, 12, 0.72)',
    popoverClass: 'set-tour-popover',
    onDestroyed: () => {
      void api.put('/users/onboarding', { tourDone: true }).catch(() => {});
    },
    steps: TOUR_STEPS.map(({ mobile, ...s }) => s).filter((s) => s.element && document.querySelector(s.element as string)),
  });
  if ((driverObj.getConfig().steps ?? []).length) driverObj.drive();
}
