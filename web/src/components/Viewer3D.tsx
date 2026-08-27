import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, Grid, useGLTF, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { Boxes } from 'lucide-react';
import { api, getToken } from '../lib/api';

/**
 * Interactive 3D learning environment (Three.js / React Three Fiber).
 * - glTF/GLB: full model with explode view + clickable parts
 * - URDF: kinematic tree with joint sliders (robotics)
 */

interface PartInfo {
  node: string;
  name?: string;
  linkedPageId?: string | null;
  visual?: {
    geometry: { type: string; size?: string; radius?: string; length?: string };
    origin?: { xyz?: string; rpy?: string };
    material?: { color?: string; name?: string };
  };
}

export function askCopilot(text: string) {
  window.dispatchEvent(new CustomEvent('set:ask-copilot', { detail: text }));
}

/** WebGL available? Without it @react-three/fiber throws while creating the
 *  renderer (headless browsers, hardware acceleration disabled) — detect up
 *  front so the route degrades to a message + inspector instead of crashing. */
function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function Viewer3D({ model, onPartLink }: { model: any; onPartLink?: (pageId: string) => void }) {
  const [explode, setExplode] = useState(0);
  const [selected, setSelected] = useState<PartInfo | null>(null);
  const [jointValues, setJointValues] = useState<Record<string, number>>({});
  const [glOK] = useState(webglAvailable);
  const rawParts: any = model.parts ?? [];
  // glTF models store a flat part array; URDF models store {links, joints}
  const parts: any[] = Array.isArray(rawParts) ? rawParts : (rawParts.links ?? []);

  const fileUrl = `/api/models/${model.id}/file?token=${encodeURIComponent(getToken())}`;
  const movableJoints = useMemo(
    () => (rawParts.joints ?? []).filter((j: any) => ['revolute', 'continuous', 'prismatic'].includes(j.type)),
    [model]
  );

  return (
    <div className="h-full flex" data-viewer3d>
      <div className="flex-1 relative">
        {!glOK ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center p-6">
            <Boxes size={30} className="text-set-dim" />
            <p className="text-sm text-set-text">3D preview needs WebGL</p>
            <p className="text-xs text-set-dim max-w-xs">
              This browser can&apos;t create a WebGL context (hardware acceleration off or unavailable).
              Enable GPU acceleration in your browser settings — the parts inspector still works.
            </p>
          </div>
        ) : (
        <Canvas camera={{ position: [2.2, 1.6, 2.6], fov: 45 }} shadows>
          <color attach="background" args={['#0c0e13']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[3, 5, 2]} intensity={1.1} castShadow />
          <Environment preset="city" />
          <Grid infiniteGrid cellSize={0.25} sectionSize={1} fadeDistance={18} sectionColor="#3a4258" cellColor="#232937" />
          {model.kind === 'urdf' ? (
            <UrdfScene parts={rawParts} jointValues={jointValues} onSelect={setSelected} />
          ) : model.kind === 'step' ? (
            <StepScene url={fileUrl} name={model.name} />
          ) : model.kind === 'stl' || model.kind === 'obj' ? (
            <Suspense fallback={null}>
              <MeshScene url={fileUrl} kind={model.kind} name={model.name} />
            </Suspense>
          ) : (
            <Suspense fallback={null}>
              <GltfScene url={fileUrl} explode={explode} parts={parts} selected={selected} onSelect={setSelected} />
            </Suspense>
          )}
          <OrbitControls makeDefault />
        </Canvas>
        )}

        {(model.kind === 'gltf') && (
          <div className="absolute top-3 left-3 set-card px-3 py-2 flex items-center gap-2 bg-set-panel/90">
            <span className="text-xs text-set-dim"> Explode</span>
            <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="w-40 accent-set-accent" />
            <span className="text-xs text-set-dim w-8">{Math.round(explode * 100)}%</span>
          </div>
        )}
        <div className="absolute bottom-3 left-3 text-[10px] text-set-dim bg-set-panel/80 rounded px-2 py-1 border border-set-border">
          drag to orbit · scroll to zoom · click a part to inspect
        </div>
      </div>

      {/* Part inspector */}
      <div className="w-64 shrink-0 border-l border-set-border bg-set-panel/60 overflow-y-auto p-3">
        <div className="text-[11px] uppercase tracking-wider text-set-dim font-semibold mb-2">Parts ({parts.length || '—'})</div>
        {!selected && <p className="text-xs text-set-dim mb-3">Click a part in the scene to see linked notes, specs and knowledge graph nodes.</p>}
        {selected && (
          <div className="set-card p-3 mb-3 fadein">
            <div className="text-sm font-medium text-white">{selected.name ?? selected.node}</div>
            {selected.linkedPageId ? (
              <button className="set-btn text-xs mt-2 w-full" onClick={() => onPartLink?.(selected.linkedPageId!)}> Open linked note</button>
            ) : (
              <div className="text-xs text-set-dim mt-1">No linked page</div>
            )}
            <button
              className="set-btn text-xs mt-2 w-full"
              onClick={() => askCopilot(`In the 3D model "${model.name}", explain the part "${selected.name ?? selected.node}" and pull relevant sources if available.`)}
            >
               Ask AI about this part
            </button>
          </div>
        )}
        {movableJoints.length > 0 && (
          <>
            <div className="text-[11px] uppercase tracking-wider text-set-dim font-semibold my-2">Joints (animate)</div>
            <div className="space-y-2 mb-3">
              {movableJoints.map((j: any) => {
                const min = Number(j.limit?.lower ?? -3.14);
                const max = Number(j.limit?.upper ?? 3.14);
                return (
                  <label key={j.name} className="block">
                    <span className="text-[11px] text-set-dim truncate block">{j.name} <span className="text-set-text">{(jointValues[j.name] ?? 0).toFixed(2)} rad</span></span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={0.01}
                      value={jointValues[j.name] ?? 0}
                      onChange={(e) => setJointValues((v) => ({ ...v, [j.name]: Number(e.target.value) }))}
                      className="w-full accent-set-accent"
                    />
                  </label>
                );
              })}
              <button className="set-btn-ghost text-xs w-full" onClick={() => setJointValues({})}>Reset joints</button>
            </div>
          </>
        )}
        <div className="space-y-1">
          {parts.map((p: any, i: number) => (
            <button
              key={`${p.node ?? p.name}-${i}`}
              className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-1.5 ${selected?.node === (p.node ?? p.name) ? 'bg-set-accent/20 text-blue-200' : 'hover:bg-set-panel2 text-set-text'}`}
              onClick={() => setSelected(p)}
            >
              <span>{p.linkedPageId ? '' : ''}</span>
              <span className="truncate flex-1">{p.name ?? p.node}</span>
            </button>
          ))}
          {model.kind === 'gltf' && !parts.length && <p className="text-xs text-set-dim">Parts list appears after the model loads. Link parts to pages in the editor below.</p>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- glTF mode ---------------- */

function GltfScene({ url, explode, parts, selected, onSelect }: any) {
  const gltf = useGLTF(url) as any;
  const scene = gltf.scene as THREE.Group;
  const [cloned, setCloned] = useState<THREE.Group | null>(null);
  const modelCenter = useRef(new THREE.Vector3());

  useEffect(() => {
    const clone = (scene as THREE.Group).clone(true);
    clone.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    // center the model
    const box = new THREE.Box3().setFromObject(clone);
    box.getCenter(modelCenter.current);
    clone.position.sub(modelCenter.current);
    setCloned(clone);
    return () => {
      setCloned(null);
    };
  }, [scene]);

  useEffect(() => {
    if (!cloned) return;
    cloned.traverse((o: any) => {
      if (!o.isMesh) return;
      const worldPos = new THREE.Vector3();
      o.getWorldPosition(worldPos);
      const dir = worldPos.clone().sub(modelCenter.current);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();
      o.userData.explodeDir = dir;
    });
  }, [cloned]);

  useFrameExplode(cloned, explode);

  const setSelectedByNode = (name: string) => {
    const part = parts.find((p: PartInfo) => (p.node ?? p.name) === name || name.includes(p.node ?? p.name));
    onSelect(part ?? { node: name, name });
  };

  if (!cloned) return null;
  return <primitive object={cloned} onClick={(e: any) => setSelectedByNode(e.object.name || e.object.parent?.name || '')} />;
}

function useFrameExplode(group: THREE.Group | null, explode: number) {
  const lastExplode = useRef(0);
  useEffect(() => {
    if (!group) return;
    if (Math.abs(lastExplode.current - explode) < 0.001) return;
    lastExplode.current = explode;
    group.traverse((o: any) => {
      if (o.isMesh && o.userData.__origPos === undefined) {
        o.userData.__origPos = o.position.clone();
      }
    });
    const factor = explode * 1.2;
    group.traverse((o: any) => {
      if (o.isMesh && o.userData.explodeDir) {
        const dir: THREE.Vector3 = o.userData.explodeDir;
        o.position.copy(o.userData.__origPos).addScaledVector(dir, factor);
      }
    });
  }, [group, explode]);
}

/* ---------------- URDF mode ---------------- */

const parseXYZ = (s?: string) => (s ?? '0 0 0').split(/\s+/).map(Number).slice(0, 3) as [number, number, number];
const parseRPY = (s?: string) => (s ?? '0 0 0').split(/\s+/).map(Number).slice(0, 3) as [number, number, number];
const urdfColor = (rgba?: string) => (rgba ? `#${rgba.split(/\s+/).slice(0, 3).map((v) => Math.round(Number(v) * 255).toString(16).padStart(2, '0')).join('')}` : '#9aa4bb');

function UrdfScene({ parts, jointValues, onSelect }: { parts: PartInfo[]; jointValues: Record<string, number>; onSelect: (p: PartInfo | null) => void }) {
  const data = parts as any;
  const links: any[] = data.links ?? [];
  const joints: any[] = data.joints ?? [];

  const childToJoint = useMemo(() => {
    const m = new Map<string, any>();
    for (const j of joints) m.set(j.child, j);
    return m;
  }, [joints]);

  const jointedChildren = new Set<string>(joints.map((j) => j.child));
  const roots = links.filter((l) => !jointedChildren.has(l.name));

  return (
    <group position={[0, -0.6, 0]}>
      {roots.map((root) => (
        <UrdfLinkNode key={root.name} link={root} joints={joints} childToJoint={childToJoint} links={links} jointValues={jointValues} onSelect={onSelect} />
      ))}
    </group>
  );
}

function UrdfLinkNode({ link, joints, childToJoint, links, jointValues, onSelect }: any) {
  const children: any[] = joints.filter((j: any) => j.parent === link.name);
  const groupRef = useRef<THREE.Group>(null);
  const joint = childToJoint.get(link.name);
  const value = joint ? (jointValues[joint.name] ?? 0) : 0;
  const [xyz, rpy] = useMemo(() => {
    const origin = joint?.origin ?? {};
    return [parseXYZ(origin.xyz), parseRPY(origin.rpy)];
  }, [joint]);

  useEffect(() => {
    if (groupRef.current && joint && (joint.type === 'revolute' || joint.type === 'continuous')) {
      const [ax, ay, az] = parseXYZ(joint.axis ?? '1 0 0');
      const axis = new THREE.Vector3(ax, ay, az).normalize();
      groupRef.current.quaternion.setFromAxisAngle(axis, value);
    }
    if (groupRef.current && joint && joint.type === 'prismatic') {
      const [ax, ay, az] = parseXYZ(joint.axis ?? '0 0 1');
      const axis = new THREE.Vector3(ax, ay, az).normalize();
      groupRef.current.position.set(xyz[0] + axis.x * value, xyz[1] + axis.y * value, xyz[2] + axis.z * value);
    }
  }, [value, joint, xyz]);

  const vis = link.visual;
  const vxyz = parseXYZ(vis?.origin?.xyz);
  const vrpy = parseRPY(vis?.origin?.rpy);
  const color = urdfColor(vis?.material?.color);
  const linkByName = useMemo(() => new Map<string, any>(links.map((l: any) => [l.name, l])), [links]);
  const partInfo = linkByName.get(link.name);

  return (
    <group position={xyz} rotation={rpy} ref={groupRef}>
      {vis && (
        <group position={vxyz} rotation={vrpy}>
          <mesh
            castShadow
            onClick={(e) => {
              e.stopPropagation();
              onSelect({ node: link.name, name: link.name, ...(partInfo ?? {}) });
            }}
          >
            {vis.geometry.type === 'box' ? (
              <boxGeometry args={parseXYZ(vis.geometry.size)} />
            ) : vis.geometry.type === 'cylinder' ? (
              <cylinderGeometry args={[Number(vis.geometry.radius ?? 0.05), Number(vis.geometry.radius ?? 0.05), Number(vis.geometry.length ?? 0.1), 24]} />
            ) : (
              <sphereGeometry args={[Number(vis.geometry.radius ?? 0.05), 24, 24]} />
            )}
            <meshStandardMaterial color={color} metalness={0.35} roughness={0.45} />
          </mesh>
        </group>
      )}
      {children.map((j: any) => {
        const child = links.find((l: any) => l.name === j.child);
        if (!child) return null;
        return (
          <UrdfLinkNode
            key={j.child}
            link={child}
            joints={joints}
            childToJoint={childToJoint}
            links={links}
            jointValues={jointValues}
            onSelect={onSelect}
          />
        );
      })}
    </group>
  );
}


/* ---------------- STL / OBJ meshes ---------------- */

function MeshScene({ url, kind, name }: { url: string; kind: string; name: string }) {
  const geometry = useLoader(kind === 'stl' ? STLLoader : OBJLoader, url);
  const group = useMemo(() => {
    const g = new THREE.Group();
    if (kind === 'stl') {
      const geo = geometry as unknown as THREE.BufferGeometry;
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#9fb2d8', metalness: 0.3, roughness: 0.5 }));
      mesh.name = name;
      mesh.castShadow = true;
      g.add(mesh);
    } else {
      const obj = geometry as unknown as THREE.Group;
      obj.traverse((o: any) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.name = o.name || name;
          if (!o.material) o.material = new THREE.MeshStandardMaterial({ color: '#9fb2d8', metalness: 0.3, roughness: 0.5 });
        }
      });
      g.add(obj);
    }
    // normalize scale to fit view
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    const center = box.getCenter(new THREE.Vector3());
    g.position.sub(center);
    g.scale.setScalar(2 / size);
    return g;
  }, [geometry, kind, name]);
  return <primitive object={group} onClick={(e: any) => e.stopPropagation()} />;
}

/* ---------------- STEP (CAD) via occt-import-js WASM ---------------- */

function StepScene({ url, name }: { url: string; name: string }) {
  const [status, setStatus] = useState('loading');
  const [group, setGroup] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // occt-import-js is a WASM build of OpenCascade — load it on demand from a CDN
        setStatus('loading OpenCascade WASM (requires internet)...');
        await new Promise<void>((resolve, reject) => {
          if ((window as any).occtimportjs) return resolve();
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('CDN unavailable'));
          document.head.appendChild(script);
        });
        const occt = await (window as any).occtimportjs();
        setStatus('parsing STEP file...');
        const res = await fetch(url);
        const buf = new Uint8Array(await res.arrayBuffer());
        const result = occt.ReadStepFile(buf, null);
        if (cancelled) return;
        const g = new THREE.Group();
        for (const m of result.meshes) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
          if (m.attributes.normal) geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
          if (m.index) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(m.index.array), 1));
          geo.computeVertexNormals();
          const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#a8b6d8', metalness: 0.35, roughness: 0.4 }));
          mesh.castShadow = true;
          g.add(mesh);
        }
        const box = new THREE.Box3().setFromObject(g);
        const size = box.getSize(new THREE.Vector3()).length() || 1;
        const center = box.getCenter(new THREE.Vector3());
        g.position.sub(center);
        g.scale.setScalar(2 / size);
        if (!cancelled) {
          setGroup(g);
          setStatus('');
        }
      } catch (e: any) {
        if (!cancelled) setStatus(`error: ${e.message} — STEP conversion needs internet access to load the OpenCascade WASM runtime`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, name]);

  return (
    <group>
      {group && <primitive object={group} onClick={(e: any) => e.stopPropagation()} />}
      {status && (
        <mesh position={[0, 1.6, 0]}>
          <planeGeometry args={[0.01, 0.01]} />
          <meshBasicMaterial />
        </mesh>
      )}
      {status && <StepStatusNote status={status} name={name} />}
    </group>
  );
}

function StepStatusNote({ status, name }: { status: string; name: string }) {
  useStatusBanner(status);
  return null;
}

function useStatusBanner(status: string) {
  useEffect(() => {
    const id = 'set-step-status';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'absolute top-3 left-3 set-card px-3 py-2 text-xs text-set-dim bg-set-panel/90 max-w-xs';
      el.style.zIndex = '20';
      document.querySelector('[data-viewer3d]')?.appendChild(el);
    }
    el.textContent = status;
    return () => {
      if (!status) el?.remove();
    };
  }, [status]);
}
