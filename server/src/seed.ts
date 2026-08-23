import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { one, q } from './db.js';
import { config } from './config.js';
import { mdToDoc } from './lib/markdown.js';
import { relinkSpace } from './pages/routes.js';
import { ingestSource } from './rag/search.js';

const DEMO_URDF = `<?xml version="1.0"?>
<robot name="SET Demo Arm">
  <link name="Base"><visual><geometry><cylinder radius="0.2" length="0.1"/></geometry><material name="grey"><color rgba="0.5 0.5 0.5 1"/></material></visual></link>
  <link name="Shoulder Actuator"><visual><origin xyz="0 0 0.1"/><geometry><cylinder radius="0.08" length="0.2"/></geometry><material name="blue"><color rgba="0.2 0.4 0.9 1"/></material></visual></link>
  <link name="Upper Arm"><visual><origin xyz="0 0 0.25"/><geometry><box size="0.06 0.06 0.5"/></geometry><material name="white"><color rgba="0.9 0.9 0.9 1"/></material></visual></link>
  <link name="Elbow Actuator"><visual><geometry><sphere radius="0.07"/></geometry><material name="blue"><color rgba="0.2 0.4 0.9 1"/></material></visual></link>
  <link name="Forearm"><visual><origin xyz="0 0 0.2"/><geometry><box size="0.05 0.05 0.4"/></geometry><material name="white"><color rgba="0.9 0.9 0.9 1"/></material></visual></link>
  <link name="Gripper"><visual><origin xyz="0 0 0.05"/><geometry><box size="0.12 0.1 0.1"/></geometry><material name="dark"><color rgba="0.15 0.15 0.18 1"/></material></visual></link>
  <joint name="base_yaw" type="revolute"><parent link="Base"/><child link="Shoulder Actuator"/><axis xyz="0 0 1"/><limit lower="-3.14" upper="3.14" effort="10" velocity="1"/></joint>
  <joint name="shoulder_pitch" type="revolute"><parent link="Shoulder Actuator"/><child link="Upper Arm"/><origin xyz="0 0 0.2"/><axis xyz="0 1 0"/><limit lower="-1.5" upper="1.5" effort="10" velocity="1"/></joint>
  <joint name="elbow_pitch" type="revolute"><parent link="Upper Arm"/><child link="Elbow Actuator"/><origin xyz="0 0 0.5"/><axis xyz="0 1 0"/><limit lower="-2.0" upper="2.0" effort="5" velocity="1"/></joint>
  <joint name="forearm_fixed" type="fixed"><parent link="Elbow Actuator"/><child link="Forearm"/><origin xyz="0 0 0.1"/></joint>
  <joint name="gripper_slide" type="prismatic"><parent link="Forearm"/><child link="Gripper"/><origin xyz="0 0 0.4"/><axis xyz="0 0 1"/><limit lower="0" upper="0.15" effort="5" velocity="0.5"/></joint>
</robot>`;

const DEMO_SOURCE = `# Robotic Arm Actuators — Engineering Reference

## Overview
A robotic arm converts electrical energy into precise mechanical motion. Each joint is driven by an actuator, controlled through a feedback loop reading position, velocity and sometimes torque sensors.

## Actuator types
DC motors with gearboxes are cheap and common in educational arms. Brushless DC (BLDC) motors offer higher torque-to-weight ratios and dominate industrial cobots. Pneumatic actuators appear in soft robotics where compliance matters.

## Control
Most arms use PID position control at 1 kHz or faster. Advanced controllers add gravity compensation and computed-torque feedforward. Force-torque sensors at the wrist enable compliant contact tasks.

## Specifications to check
When selecting an actuator: stall torque, continuous torque, gear ratio backlash, encoder resolution, thermal limits, and communication bus (CAN, EtherCAT). In 2024 EtherCAT became the default bus for new industrial arms.

## Safety
Joint limits must be enforced in firmware, not only in software. Emergency stops should cut motor power through a dedicated hardware path.

## Maintenance log
- 2024-03-12: Replaced encoder cable on joint 3 after intermittent dropout
- 2024-09-01: Scheduled gearbox grease replacement for shoulder joint
- 2025-01-15: Firmware update improved PID stability at low temperatures`;

export async function seed() {
  const email = 'demo@set.local';
  const exists = await one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  if (exists) {
    console.log('[seed] demo user already exists — skipping');
    return;
  }
  const hash = await bcrypt.hash('demo-demo', 10);
  const user = await one<any>(`INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`, [email, 'Demo User', hash]);

  const space = await one<any>(
    `INSERT INTO spaces (name, kind, icon, owner_id) VALUES ('Robotics Lab', 'team', null, $1) RETURNING id`,
    [user!.id]
  );
  const spaceId = space!.id;
  await q(`INSERT INTO memberships (user_id, space_id, role) VALUES ($1, $2, 'owner')`, [user!.id, spaceId]);
  // demo space showcases every surface
  await q(
    `INSERT INTO settings (space_id, data) VALUES ($1, $2)`,
    [spaceId, JSON.stringify({ surfaces: { coding: true, terminal: true, paths: true, threeD: true, library: true, canvas: true } })]
  );

  const mkPage = async (title: string, markdown: string, parent: string | null = null) => {
    const p = await one<any>(
      `INSERT INTO pages (space_id, parent_id, title, icon, markdown, content, created_by) VALUES ($1, $2, $3, NULL, $4, $5, $6) RETURNING id`,
      [spaceId, parent, title, markdown, JSON.stringify(mdToDoc(markdown)), user!.id]
    );
    return p!.id;
  };

  const overview = await mkPage(
    'Robotics Lab Home',

    `# Robotics Lab\n\nWelcome to the SET demo workspace.\n\n- [[Actuator Selection Guide]] — how we pick motors\n- [[Safety Checklist]] — read before operating the arm\n- [[Control Theory Notes]] — PID and beyond\n- Daily journal via **Today** button in the sidebar\n- Research notebook: *Arm Actuators Reference* (chat with it, generate flashcards)\n- 3D: *Demo Arm* URDF model (explode, animate joints, click parts)`
  );
  await mkPage(
    'Actuator Selection Guide',

    `# Actuator Selection Guide

When choosing a joint actuator:

1. **Stall torque**  2× the worst-case load torque
2. **Encoder resolution** fine enough for the repeatability target
3. **Bus**: prefer [[Control Theory Notes|EtherCAT]] for new designs

## Spec comparison

| Actuator | Stall torque | Weight | Bus | Notes |
| :--- | ---: | ---: | --- | --- |
| DC geared | 12 N·m | 0.8 kg | PWM | Cheap, educational |
| BLDC | 28 N·m | 0.6 kg | EtherCAT | ==Industrial default== |
| Pneumatic | 20 N·m | 1.2 kg | 6 bar | Soft robotics |

~~Pneumatics for precision arms~~ (rejected 2025-11).

> Rule of thumb: pick the *smallest* actuator whose margin survives the worst-case trajectory.

See also [[Safety Checklist]].`
  );
  await mkPage(
    'Control Theory Notes',

    `# Control Theory Notes\n\n- PID position loops at 1 kHz\n- Gravity compensation improves tracking\n- Computed-torque feedforward for fast trajectories\n\nRelated: [[Actuator Selection Guide]]`
  );
  await mkPage(
    'Safety Checklist',

    `# Safety Checklist\n\n- [ ] Joint limits verified in firmware\n- [ ] E-stop hardware path tested\n- [ ] Workspace scanned for humans\n\nPart of [[Robotics Lab Home]]`
  );
  await mkPage(
    'Shoulder Actuator',

    `# Shoulder Actuator\n\nThe base yaw + shoulder pitch drivetrain.\n\n- Motor: BLDC, 48 V, integrated 20-bit encoder\n- Bus: EtherCAT (see [[Control Theory Notes]])\n- Selection math in [[Actuator Selection Guide]]\n\nOpen the **Demo Arm** 3D model and click this part to jump here.`
  );

  // Database
  const db = await one<any>(
    `INSERT INTO databases (space_id, name, icon, schema) VALUES ($1, 'Experiments', null, $2) RETURNING id`,
    [spaceId, JSON.stringify([
      { id: 'c1', name: 'Name', type: 'text' },
      { id: 'c2', name: 'Status', type: 'select', config: { options: [{ value: 'Planned', color: 'amber' }, { value: 'Running', color: 'blue' }, { value: 'Done', color: 'green' }] } },
      { id: 'c3', name: 'Date', type: 'date' },
      { id: 'c4', name: 'Velocity (mm/s)', type: 'number' },
      { id: 'c5', name: 'Verified', type: 'checkbox' },
    ])]
  );
  await q(`INSERT INTO db_views (database_id, name, type, config) VALUES
    ($1, 'Table', 'table', '{}'),
    ($1, 'Board', 'kanban', '{"groupBy":"c2"}'),
    ($1, 'Calendar', 'calendar', '{"dateColumn":"c3"}'),
    ($1, 'Gallery', 'gallery', '{}')`, [db!.id]);
  const rows = [
    { title: 'PID tuning sweep', cells: { c1: 'PID tuning sweep', c2: 'Done', c3: '2026-08-10', c4: 120, c5: true } },
    { title: 'Payload limit test', cells: { c1: 'Payload limit test', c2: 'Running', c3: '2026-08-20', c4: 85, c5: false } },
    { title: 'Gripper fatigue', cells: { c1: 'Gripper fatigue', c2: 'Planned', c3: '2026-09-02', c4: 40, c5: false } },
  ];
  for (const r of rows) {
    const page = await one<any>(`INSERT INTO pages (space_id, title, created_by) VALUES ($1, $2, $3) RETURNING id`, [spaceId, r.title, user!.id]);
    await q(`INSERT INTO db_rows (database_id, page_id, cells) VALUES ($1, $2, $3)`, [db!.id, page!.id, JSON.stringify(r.cells)]);
  }

  // Notebook + source (ingested with hash embeddings so search works without an LLM)
  const nb = await one<any>(
    `INSERT INTO notebooks (space_id, title, description) VALUES ($1, 'Arm Actuators Reference', 'Grounded research on robotic arm actuators') RETURNING id`,
    [spaceId]
  );
  const src = await one<any>(
    `INSERT INTO sources (notebook_id, kind, name, text_content, status) VALUES ($1, 'md', 'Actuators Engineering Reference', $2, 'pending') RETURNING id`,
    [nb!.id, DEMO_SOURCE]
  );
  await ingestSource(src!.id, null);

  // 3D model
  const dir = path.join(config.dataDir, 'models', spaceId);
  fs.mkdirSync(dir, { recursive: true });
  const modelPath = path.join(dir, 'demo-arm.urdf');
  fs.writeFileSync(modelPath, DEMO_URDF);
  const { parseUrdf } = await import('./models3d/routes.js');
  const parts = parseUrdf(DEMO_URDF);
  await q(
    `INSERT INTO models3d (space_id, name, kind, file_path, file_size, parts) VALUES ($1, 'Demo Arm', 'urdf', $2, $3, $4)`,
    [spaceId, modelPath, DEMO_URDF.length, JSON.stringify(parts)]
  );

  // Learning path
  await relinkSpace(spaceId); // resolve all wiki links now that every page exists
  const lpItems = [
    { pageId: overview, note: 'Orientation' },
    { pageId: await one<any>(`SELECT id FROM pages WHERE space_id = $1 AND title = 'Actuator Selection Guide'`, [spaceId]).then((r: any) => r.id), note: 'Hardware' },
    { pageId: await one<any>(`SELECT id FROM pages WHERE space_id = $1 AND title = 'Control Theory Notes'`, [spaceId]).then((r: any) => r.id), note: 'Control' },
    { pageId: await one<any>(`SELECT id FROM pages WHERE space_id = $1 AND title = 'Safety Checklist'`, [spaceId]).then((r: any) => r.id), note: 'Certify' },
  ];
  await q(`INSERT INTO learning_paths (space_id, title, description, items) VALUES ($1, 'Robot Onboarding', 'New-member curriculum for the lab', $2)`, [
    spaceId,
    JSON.stringify(lpItems),
  ]);

  console.log('[seed] demo data created — login with demo@set.local / demo-demo');
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
