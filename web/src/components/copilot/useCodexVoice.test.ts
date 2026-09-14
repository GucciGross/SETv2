import { describe, expect, it, beforeEach } from 'vitest';
import { voiceChoiceForUser } from './useCodexVoice';
import { useApp } from '../../stores/app';

/** Unit coverage for the shared-store scoping logic. The controlled-rerender
 *  behavior itself (select keeps its value, POST carries the choice) is browser
 *  smoke territory: copilot-controls-smoke.py mounts the production settings UI. */
describe('voiceChoiceForUser', () => {
  beforeEach(() => useApp.setState({ codexVoiceChoice: { userId: '', voice: null } }));

  it('returns the choice only for the user who made it', () => {
    useApp.getState().setCodexVoiceChoice('user-a', 'cedar');
    expect(useApp.getState().codexVoiceChoice).toEqual({ userId: 'user-a', voice: 'cedar' });
    expect(voiceChoiceForUser(useApp.getState().codexVoiceChoice, 'user-a')).toBe('cedar');
    expect(voiceChoiceForUser(useApp.getState().codexVoiceChoice, 'user-b')).toBeNull();
    expect(voiceChoiceForUser(useApp.getState().codexVoiceChoice, '')).toBeNull();
  });

  it('an explicit account-default choice stores null and reads back null', () => {
    useApp.getState().setCodexVoiceChoice('user-a', null);
    expect(voiceChoiceForUser(useApp.getState().codexVoiceChoice, 'user-a')).toBeNull();
  });

  it('switching users never leaks the previous user’s voice', () => {
    useApp.getState().setCodexVoiceChoice('user-a', 'cedar');
    useApp.getState().setCodexVoiceChoice('user-b', 'maple');
    expect(voiceChoiceForUser(useApp.getState().codexVoiceChoice, 'user-a')).toBeNull();
    expect(voiceChoiceForUser(useApp.getState().codexVoiceChoice, 'user-b')).toBe('maple');
  });
});
