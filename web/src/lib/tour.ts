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

// Sidebar-targeted steps need the sidebar visible: expanded rail on desktop,
// open drawer on mobile. AppShell owns that state and listens for these events.
const inSidebar = (el: Element | null | undefined) => !!el?.closest('[data-tour-sidebar]');
const emitSidebar = (detail: { open?: boolean; restore?: boolean }) =>
  window.dispatchEvent(new CustomEvent('set:tour-sidebar', { detail }));

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
    // the floating copilot launcher (CopilotKit's popup toggle)
    element: "[data-slot='chat-toggle-button']",
    popover: {
      title: 'The copilot',
      description: 'Your on-screen guide and workspace agent in one — floating on every page. It explains what you are looking at, writes into your notes, runs the tour, and can search, create and study anything in the workspace. Bring your own LLM key in Settings → AI Providers.',
      side: 'top',
      align: 'end',
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

/** Starts the walkthrough. Returns what actually happened so callers (the
 * chat's start_tour tool card shows it verbatim) can see failures instead of
 * silently no-oping: driver mounts nothing when the filtered step list is
 * empty, and a throw inside the deferred begin() used to vanish. */
export function startTour(): { started: boolean; steps: number; error?: string } {
  try {
    if (driverObj) {
      driverObj.destroy();
      driverObj = null;
    }
    const steps = TOUR_STEPS.map(({ mobile, ...s }) => s).filter((s) => s.element && document.querySelector(s.element as string));
    if (!steps.length) {
      return { started: false, steps: 0, error: 'no tour elements found on this screen' };
    }
    const begin = () => {
      try {
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
          onHighlightStarted: (element) => emitSidebar({ open: inSidebar(element) }),
          onDestroyed: () => {
            emitSidebar({ restore: true });
            void api.put('/users/onboarding', { tourDone: true }).catch(() => {});
          },
          steps,
        });
        driverObj.drive();
      } catch (e: any) {
        console.error('[tour] drive failed', e);
        driverObj = null;
        throw e;
      }
    };
    // if the tour opens on a sidebar step, let the sidebar slide open before the first highlight lands
    const first = steps[0]?.element ? document.querySelector(steps[0].element as string) : null;
    if (inSidebar(first)) {
      emitSidebar({ open: true });
      setTimeout(() => {
        try {
          begin();
        } catch (e: any) {
          console.error('[tour] start failed', e);
        }
      }, 300);
    } else {
      begin();
    }
    return { started: true, steps: steps.length };
  } catch (e: any) {
    return { started: false, steps: 0, error: e?.message ?? String(e) };
  }
}
