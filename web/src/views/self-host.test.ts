import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
describe('self-host public site contract', () => {
  it('does not advertise cloud or publish the private login in landing pages', () => {
    for (const name of ['Landing.tsx', 'AgentsLanding.tsx']) {
      const s = source(name);
      expect(s).not.toMatch(/SET Cloud|SET CLOUD|hosted cloud|WaitlistForm/);
      expect(s).not.toContain('to="/login"');
      expect(s).not.toContain('/private/login');
      expect(s).toContain('/self-host');
    }
  });
  it('keeps a password login route but gates the public preview login', () => {
    expect(source('../main.tsx')).toContain("path: '/private/login'");
    expect(source('Login.tsx')).toContain("preview && location.pathname !== '/private/login'");
    expect(source('SelfHost.tsx')).toContain('https://github.com/GucciGross/SETv2');
    expect(source('SelfHost.tsx')).toContain('docker compose up -d');
  });
});
