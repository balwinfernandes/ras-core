"use client";
// The 3D "knowledge constellation": every glowing node is one chunk of the knowledge base,
// positioned by PCA of its embedding. Retrieval lights nodes up and fires beams from the query.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Graph, GraphNode } from "@/lib/types";
import { colorFor } from "@/lib/types";

export type ActiveNode = { id: string; n: number; fused: number };

type Props = {
  graph: Graph;
  active: ActiveNode[];
  queryKey: number;
  scanning: boolean;
  focusId: string | null;
  onHover: (node: GraphNode | null, x: number, y: number) => void;
  onSelect: (node: GraphNode) => void;
};

const NODE_VERT = /* glsl */ `
attribute vec3 aColor; attribute float aSize; attribute float aAct; attribute float aSeed;
uniform float uTime; uniform float uPixel; uniform float uScan; uniform float uScanOn;
varying vec3 vColor; varying float vAct; varying float vScan;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  float scan = uScanOn * smoothstep(1.4, 0.0, abs(wp.x - uScan));
  float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + aSeed * 6.2831);
  float size = aSize * pulse * (1.0 + aAct * 1.7 + scan * 0.9);
  gl_PointSize = size * uPixel * (105.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
  vColor = mix(aColor, vec3(0.18, 0.95, 0.79), clamp(aAct, 0.0, 1.0) * 0.85);
  vAct = aAct; vScan = scan;
}`;

const NODE_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vColor; varying float vAct; varying float vScan;
void main(){
  vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
  if (d > 0.5) discard;
  float core = smoothstep(0.13, 0.0, d);
  float glow = pow(smoothstep(0.5, 0.0, d), 1.7);
  float r = 0.28 + 0.1 * sin(uTime * 5.0);
  float ring = clamp(vAct, 0.0, 1.5) * smoothstep(0.035, 0.0, abs(d - r));
  vec3 col = vColor * (glow * 1.1 + vScan * 0.8) + vec3(1.0) * core * 0.85 + vec3(0.55, 1.0, 0.9) * ring;
  float a = clamp(glow + core + ring, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(120,255,225,0.8)");
  grd.addColorStop(0.6, "rgba(139,108,255,0.25)");
  grd.addColorStop(1, "rgba(139,108,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export default function Constellation({ graph, active, queryKey, scanning, focusId, onHover, onSelect }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const live = useRef({ active, queryKey, scanning, focusId, onHover, onSelect });
  live.current = { active, queryKey, scanning, focusId, onHover, onSelect };

  useEffect(() => {
    const mount = mountRef.current!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.dataset.constellation = "true";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x060a14, 0.028);
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 0, 17);

    const world = new THREE.Group();
    scene.add(world);
    // push the cloud right on desktop so it sits beside the chat, centred on mobile
    const layoutOffset = () => (window.innerWidth > 1000 ? -3.2 : 0);
    world.position.x = layoutOffset();

    // ---- nodes ----
    const n = graph.nodes.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), act = new Float32Array(n), seed = new Float32Array(n);
    const idIndex = new Map<string, number>();
    const SCALE = 1.3;
    const P = graph.nodes.map((node) => node.p.map((x) => x * SCALE) as [number, number, number]);
    graph.nodes.forEach((node, i) => {
      idIndex.set(node.id, i);
      pos.set(P[i], i * 3);
      const c = new THREE.Color(colorFor(node.category));
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = 1.4 + Math.random() * 0.6;
      seed[i] = Math.random();
    });
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    nodeGeo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    nodeGeo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    nodeGeo.setAttribute("aAct", new THREE.BufferAttribute(act, 1));
    nodeGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const uniforms = {
      uTime: { value: 0 },
      uPixel: { value: renderer.getPixelRatio() },
      uScan: { value: -12 },
      uScanOn: { value: 0 },
    };
    const nodeMat = new THREE.ShaderMaterial({
      vertexShader: NODE_VERT, fragmentShader: NODE_FRAG, uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const nodes = new THREE.Points(nodeGeo, nodeMat);
    world.add(nodes);

    // ---- nebula: a halo of small particles around every knowledge node ----
    const NEB = 70, nebCount = n * NEB;
    const nebPos = new Float32Array(nebCount * 3), nebOff = new Float32Array(nebCount * 3), nebCol = new Float32Array(nebCount * 3);
    const nebSize = new Float32Array(nebCount), nebAct = new Float32Array(nebCount), nebSeed = new Float32Array(nebCount), nebParent = new Uint16Array(nebCount);
    const gauss = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(2 * Math.PI * Math.random());
    for (let i = 0, k = 0; i < n; i++) {
      for (let j = 0; j < NEB; j++, k++) {
        const r = 0.45;
        nebOff.set([gauss() * r, gauss() * r * 0.8, gauss() * r], k * 3);
        nebCol.set([col[i * 3] * 0.85, col[i * 3 + 1] * 0.85, col[i * 3 + 2] * 0.85], k * 3);
        nebSize[k] = 0.22 + Math.random() * 0.35;
        nebSeed[k] = Math.random();
        nebParent[k] = i;
      }
    }
    const nebGeo = new THREE.BufferGeometry();
    nebGeo.setAttribute("position", new THREE.BufferAttribute(nebPos, 3));
    nebGeo.setAttribute("aColor", new THREE.BufferAttribute(nebCol, 3));
    nebGeo.setAttribute("aSize", new THREE.BufferAttribute(nebSize, 1));
    nebGeo.setAttribute("aAct", new THREE.BufferAttribute(nebAct, 1));
    nebGeo.setAttribute("aSeed", new THREE.BufferAttribute(nebSeed, 1));
    const nebMat = new THREE.ShaderMaterial({
      vertexShader: NODE_VERT, fragmentShader: NODE_FRAG, uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    world.add(new THREE.Points(nebGeo, nebMat));

    // ---- similarity edges ----
    const edgePos = new Float32Array(graph.edges.length * 6);
    graph.edges.forEach(([a, b], i) => {
      edgePos.set(P[a], i * 6);
      edgePos.set(P[b], i * 6 + 3);
    });
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePos, 3));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x7f8fd8, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    world.add(new THREE.LineSegments(edgeGeo, edgeMat));

    // ---- dust ----
    const DUST = 1400;
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      const r = 6 + Math.random() * 22, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      dustPos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.7, r * Math.cos(ph)], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x8d98bd, size: 0.045, transparent: true, opacity: 0.55, depthWrite: false }));
    scene.add(dust);

    // ---- query node, beams, pulses, shockwave ----
    const tex = glowTexture();
    const MAX_BEAMS = 5, PULSES_PER = 3;
    const beamPos = new Float32Array(MAX_BEAMS * 6), beamCol = new Float32Array(MAX_BEAMS * 6);
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute("position", new THREE.BufferAttribute(beamPos, 3));
    beamGeo.setAttribute("color", new THREE.BufferAttribute(beamCol, 3));
    const beamMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const beams = new THREE.LineSegments(beamGeo, beamMat);
    world.add(beams);

    const pulsePos = new Float32Array(MAX_BEAMS * PULSES_PER * 3);
    const pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute("position", new THREE.BufferAttribute(pulsePos, 3));
    const pulseMat = new THREE.PointsMaterial({ map: tex, size: 0.35, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    world.add(new THREE.Points(pulseGeo, pulseMat));

    // soft red haze at the heart of the cloud
    const hazeMat = new THREE.SpriteMaterial({ map: tex, color: 0x6a52ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false });
    const haze = new THREE.Sprite(hazeMat);
    haze.scale.setScalar(16);
    world.add(haze);

    const qMat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const qSprite = new THREE.Sprite(qMat);
    world.add(qSprite);

    const shockMat = new THREE.MeshBasicMaterial({ color: 0x2ef2c9, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const shock = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 96), shockMat);
    world.add(shock);
    const shock2Mat = shockMat.clone();
    shock2Mat.color.set(0x8b6cff);
    const shock2 = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), shock2Mat);
    world.add(shock2);

    let beamTargets: { i: number; w: number }[] = [];
    const Q = new THREE.Vector3();
    let queryBorn = -10;
    let lastKey = live.current.queryKey;
    let lastActiveSig = "";

    // ---- interaction ----
    const mouse = { x: 0, y: 0, tx: 0, ty: 0, cx: -1, cy: -1, onCanvas: false };
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.35 };
    let hovered = -1;
    const onMove = (e: PointerEvent) => {
      mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ty = -(e.clientY / window.innerHeight) * 2 + 1;
      mouse.cx = e.clientX; mouse.cy = e.clientY;
      mouse.onCanvas = e.target === renderer.domElement;
    };
    const onClick = (e: MouseEvent) => {
      if (e.target === renderer.domElement && hovered >= 0) live.current.onSelect(graph.nodes[hovered]);
    };
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("click", onClick);
    window.addEventListener("resize", onResize);

    let prevT = performance.now(), elapsed = 0;
    let raf = 0, camZ = 17, spin = 0;
    const proj = new THREE.Vector3();

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min((now - prevT) / 1000, 0.05);
      prevT = now;
      elapsed += dt;
      const t = elapsed;
      uniforms.uTime.value = t;
      const L = live.current;

      // new query → rebuild beams from the query point to retrieved nodes
      const sig = L.active.map((a) => a.id).join("|");
      if (L.queryKey !== lastKey || sig !== lastActiveSig) {
        const isNewQuery = L.queryKey !== lastKey;
        lastKey = L.queryKey;
        lastActiveSig = sig;
        beamTargets = L.active.map((a) => ({ i: idIndex.get(a.id) ?? -1, w: a.fused })).filter((b) => b.i >= 0).slice(0, MAX_BEAMS);
        if (beamTargets.length) {
          const c = new THREE.Vector3();
          let wsum = 0;
          beamTargets.forEach(({ i, w }) => { c.add(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).multiplyScalar(w + 0.2)); wsum += w + 0.2; });
          c.divideScalar(wsum);
          // put the query in front of the cluster, towards the camera
          world.updateMatrixWorld();
          const camLocal = world.worldToLocal(camera.position.clone());
          Q.copy(c).add(camLocal.sub(c).normalize().multiplyScalar(2.5));
          if (isNewQuery) queryBorn = t;
        }
      }

      // node activation eases toward its target
      for (let i = 0; i < n; i++) {
        const a = L.active.find((x) => idIndex.get(x.id) === i);
        let target = a ? 0.55 + 0.45 * a.fused : 0;
        if (L.focusId && graph.nodes[i].id === L.focusId) target = 1.5;
        if (i === hovered) target = Math.max(target, 0.9);
        act[i] += (target - act[i]) * Math.min(1, dt * 6);
      }
      nodeGeo.attributes.aAct.needsUpdate = true;

      // nebula swirls around its node and glows with it
      for (let k = 0; k < nebCount; k++) {
        const i = nebParent[k];
        const a = t * (0.15 + nebSeed[k] * 0.25) * (nebSeed[k] > 0.5 ? 1 : -1);
        const ox = nebOff[k * 3], oy = nebOff[k * 3 + 1], oz = nebOff[k * 3 + 2];
        const ca = Math.cos(a), sa = Math.sin(a);
        const spread = 1 + act[i] * 0.9;
        nebPos[k * 3] = pos[i * 3] + (ox * ca - oz * sa) * spread;
        nebPos[k * 3 + 1] = pos[i * 3 + 1] + oy * spread;
        nebPos[k * 3 + 2] = pos[i * 3 + 2] + (ox * sa + oz * ca) * spread;
        nebAct[k] = act[i] * 0.6;
      }
      nebGeo.attributes.position.needsUpdate = true;
      nebGeo.attributes.aAct.needsUpdate = true;

      // scanning sweep while retrieval is running
      uniforms.uScanOn.value += ((L.scanning ? 1 : 0) - uniforms.uScanOn.value) * Math.min(1, dt * 4);
      uniforms.uScan.value = L.scanning ? ((t * 14) % 28) - 14 : uniforms.uScan.value;

      // beams grow out of the query node, staggered
      const age = t - queryBorn;
      const hasBeams = beamTargets.length > 0;
      beamTargets.forEach(({ i }, k) => {
        const prog = THREE.MathUtils.clamp((age - 0.15 - k * 0.09) / 0.45, 0, 1);
        const e = 1 - Math.pow(1 - prog, 3);
        const tx = pos[i * 3], ty = pos[i * 3 + 1], tz = pos[i * 3 + 2];
        beamPos.set([Q.x, Q.y, Q.z, Q.x + (tx - Q.x) * e, Q.y + (ty - Q.y) * e, Q.z + (tz - Q.z) * e], k * 6);
        beamCol.set([1, 1, 1, 0.18, 0.95, 0.79], k * 6);
        for (let j = 0; j < PULSES_PER; j++) {
          const f = ((t * 0.55 + j / PULSES_PER + k * 0.13) % 1) * e;
          pulsePos.set([Q.x + (tx - Q.x) * f, Q.y + (ty - Q.y) * f, Q.z + (tz - Q.z) * f], (k * PULSES_PER + j) * 3);
        }
      });
      for (let k = beamTargets.length; k < MAX_BEAMS; k++) {
        beamPos.fill(0, k * 6, k * 6 + 6);
        pulsePos.fill(0, k * PULSES_PER * 3, (k + 1) * PULSES_PER * 3);
      }
      beamGeo.attributes.position.needsUpdate = true;
      beamGeo.attributes.color.needsUpdate = true;
      beamGeo.setDrawRange(0, beamTargets.length * 2);
      pulseGeo.attributes.position.needsUpdate = true;
      pulseGeo.setDrawRange(0, beamTargets.length * PULSES_PER);
      beamMat.opacity += ((hasBeams ? 0.75 : 0) - beamMat.opacity) * Math.min(1, dt * 5);
      pulseMat.opacity = beamMat.opacity;

      // query node + double shockwave ("blast") when a query lands
      qSprite.position.copy(Q);
      const qs = hasBeams ? 0.9 + 0.2 * Math.sin(t * 6) + Math.max(0, 1.6 - age * 3) : 0;
      qSprite.scale.setScalar(qs);
      qMat.opacity += ((hasBeams ? 1 : 0) - qMat.opacity) * Math.min(1, dt * 5);
      [shock, shock2].forEach((s, k) => {
        const a2 = age - k * 0.18;
        const m = s.material as THREE.MeshBasicMaterial;
        s.position.copy(Q);
        s.quaternion.copy(camera.quaternion).premultiply(world.quaternion.clone().invert());
        if (a2 > 0 && a2 < 1.4) {
          s.scale.setScalar(0.2 + a2 * (k ? 9 : 6));
          m.opacity = (1 - a2 / 1.4) * (k ? 0.5 : 0.9);
        } else m.opacity = 0;
      });

      // camera + world motion
      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;
      if (!reduced) spin += dt * (hovered >= 0 ? 0.01 : hasBeams ? 0.03 : 0.07);
      world.rotation.y = spin + mouse.x * 0.35;
      world.rotation.x = -mouse.y * 0.2;
      world.position.x += (layoutOffset() - world.position.x) * 0.05;
      const kick = age < 0.5 ? (0.5 - age) * 1.2 : 0; // tiny recoil when a query lands
      camZ += ((hasBeams ? 14.5 : 17) + kick - camZ) * 0.03;
      camera.position.z = camZ;
      camera.position.x = Math.sin(t * 7) * kick * 0.15;
      hazeMat.opacity = 0.08 + 0.03 * Math.sin(t * 0.8) + (hasBeams ? 0.05 : 0);
      dust.rotation.y = t * 0.01;
      dust.rotation.x = t * 0.004;

      // hover picking (only when the pointer is over empty canvas)
      let newHover = -1;
      if (mouse.onCanvas && mouse.cx >= 0) {
        raycaster.setFromCamera(new THREE.Vector2((mouse.cx / window.innerWidth) * 2 - 1, -(mouse.cy / window.innerHeight) * 2 + 1), camera);
        const hit = raycaster.intersectObject(nodes)[0];
        if (hit && hit.index !== undefined) newHover = hit.index;
      }
      if (newHover !== hovered) {
        hovered = newHover;
        renderer.domElement.style.cursor = hovered >= 0 ? "pointer" : "";
      }
      if (hovered >= 0) {
        proj.set(pos[hovered * 3], pos[hovered * 3 + 1], pos[hovered * 3 + 2]).applyMatrix4(world.matrixWorld).project(camera);
        L.onHover(graph.nodes[hovered], (proj.x * 0.5 + 0.5) * window.innerWidth, (-proj.y * 0.5 + 0.5) * window.innerHeight);
      } else L.onHover(null, 0, 0);

      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      [nodeGeo, nebGeo, edgeGeo, dustGeo, beamGeo, pulseGeo].forEach((g) => g.dispose());
      tex.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [graph]);

  return <div ref={mountRef} className="constellation" aria-hidden="true" />;
}
