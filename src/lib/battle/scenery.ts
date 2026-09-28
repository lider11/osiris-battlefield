// Static set dressing: forests, farm villages, rocks, and the two HQ compounds
// with their BULLS / BEARS signs.

import * as THREE from 'three';
import * as M from './models';
import { heightAt, isWater, roadZ, mulberry32, HQ, MINX, MAXX, MINZ, MAXZ, W, D } from './world';
import { createNoise2D } from 'simplex-noise';

const VILLAGES = [
	{ x: -150, z: -98, n: 8 },
	{ x: -92, z: 116, n: 7 },
	{ x: -18, z: -142, n: 6 },
	{ x: 62, z: 132, n: 8 },
	{ x: 122, z: -84, n: 7 },
	{ x: 176, z: 66, n: 6 },
	{ x: -226, z: -52, n: 5 },
	{ x: 252, z: 128, n: 5 }
];

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], cols?: THREE.Color[]) {
	const m = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
	mats.forEach((x, i) => m.setMatrixAt(i, x));
	cols?.forEach((c, i) => m.setColorAt(i, c));
	m.count = mats.length;
	m.castShadow = true;
	m.receiveShadow = true;
	m.computeBoundingSphere();
	return m;
}

export function buildScenery(): THREE.Group {
	const g = new THREE.Group();
	const r = mulberry32(2024);
	const n = createNoise2D(mulberry32(77));
	const lowpoly = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });

	const houses: { x: number; z: number }[] = [];
	const houseM: THREE.Matrix4[] = [];
	const barnM: THREE.Matrix4[] = [];
	const houseC: THREE.Color[] = [];
	const q = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	for (const v of VILLAGES) {
		const axis = r() * Math.PI;
		for (let k = 0; k < v.n; k++) {
			const a = axis + (k % 2 ? Math.PI / 2 : 0) + (r() - 0.5) * 0.2;
			const x = v.x + (r() - 0.5) * 34;
			const z = v.z + (r() - 0.5) * 26;
			if (isWater(x, z) || Math.abs(z - roadZ(x)) < 12) continue;
			houses.push({ x, z });
			const s = 0.9 + r() * 0.35;
			const mtx = new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) - 0.1, z), q.setFromAxisAngle(up, a), new THREE.Vector3(s, s, s));
			if (k === 0 || r() < 0.18) barnM.push(mtx);
			else {
				houseM.push(mtx);
				const t = 0.9 + r() * 0.12;
				houseC.push(new THREE.Color(t, t, t * (0.95 + r() * 0.05)));
			}
		}
	}
	g.add(instanced(M.house(), lowpoly, houseM, houseC));
	g.add(instanced(M.barn(), lowpoly, barnM));

	// forests: clustered by noise, thicker toward the board's long edges
	const pineM: THREE.Matrix4[] = [];
	const leafM: THREE.Matrix4[] = [];
	const treeC: THREE.Color[] = [];
	const leafC: THREE.Color[] = [];
	for (let x = MINX + 3; x < MAXX - 3; x += 4.2) {
		for (let z = MINZ + 3; z < MAXZ - 3; z += 4.2) {
			const px = x + (r() - 0.5) * 3.6;
			const pz = z + (r() - 0.5) * 3.6;
			const edge = Math.max(0, (Math.abs(pz) - 70) / 100);
			const dens = n(px / 70, pz / 70) * 0.55 + n(px / 23, pz / 23) * 0.25 + edge * 0.55 - 0.32;
			const scatter = r() < 0.012;
			if (!(dens > 0 && r() < dens * 1.6) && !scatter) continue;
			if (isWater(px, pz) || Math.abs(pz - roadZ(px)) < 11) continue;
			if (Math.hypot(px - HQ.bull.x, pz - HQ.bull.z) < 40 || Math.hypot(px - HQ.bear.x, pz - HQ.bear.z) < 40) continue;
			if (houses.some((h) => Math.abs(h.x - px) < 7 && Math.abs(h.z - pz) < 7)) continue;
			const s = 0.75 + r() * 0.65;
			const mtx = new THREE.Matrix4().compose(
				new THREE.Vector3(px, heightAt(px, pz) - 0.15, pz),
				q.setFromAxisAngle(up, r() * 6.28),
				new THREE.Vector3(s, s * (0.85 + r() * 0.35), s)
			);
			const t = 0.82 + r() * 0.3;
			if (r() < 0.78) {
				pineM.push(mtx);
				treeC.push(new THREE.Color(t, t, t));
			} else {
				leafM.push(mtx);
				leafC.push(new THREE.Color(t, t * (0.95 + r() * 0.1), t * 0.9));
			}
		}
	}
	g.add(instanced(M.pine(), lowpoly, pineM, treeC));
	g.add(instanced(M.broadleaf(), lowpoly, leafM, leafC));

	const rockM: THREE.Matrix4[] = [];
	for (let k = 0; k < 140; k++) {
		const x = MINX + 8 + r() * (W - 16);
		const z = MINZ + 8 + r() * (D - 16);
		if (isWater(x, z) || Math.abs(z - roadZ(x)) < 8) continue;
		const s = 0.5 + r() * 1.3;
		rockM.push(new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) - 0.2, z), q.setFromAxisAngle(up, r() * 6.28), new THREE.Vector3(s, s, s)));
	}
	g.add(instanced(M.rock(), lowpoly, rockM));

	g.add(buildHQ('bull'), buildHQ('bear'));
	return g;
}

// ── HQ compounds ─────────────────────────────────────────────────────────

const HQ_COLORS = {
	bull: { roof: new THREE.Color('#3f9b57'), sign: '#2f8a4b', edge: '#7fe3a0', label: 'BULLS', icon: '🐂' },
	bear: { roof: new THREE.Color('#b7443e'), sign: '#9f2f33', edge: '#ff9a93', label: 'BEARS', icon: '🐻' }
};

function buildHQ(side: 'bull' | 'bear'): THREE.Group {
	const g = new THREE.Group();
	const c = HQ_COLORS[side];
	const o = HQ[side];
	const y = heightAt(o.x, o.z);
	const face = side === 'bull' ? Math.PI : 0; // buildings face the front
	g.position.set(o.x, y, o.z);
	g.rotation.y = face;

	const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });
	const wall = new THREE.Color('#d9ceb4');
	const parts: THREE.BufferGeometry[] = [];
	const bx = (w: number, h: number, d: number, x: number, yy: number, z: number, col: THREE.Color) => {
		const b = new THREE.BoxGeometry(w, h, d);
		b.translate(x, yy, z);
		const n = b.attributes.position.count;
		const a = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
		b.setAttribute('color', new THREE.BufferAttribute(a, 3));
		b.deleteAttribute('uv');
		parts.push(b);
	};
	// command post, two barracks, a depot
	bx(10, 5, 8, 0, 2.5, 0, wall);
	bx(10.6, 0.8, 8.6, 0, 5.4, 0, c.roof);
	bx(14, 3.2, 5, -8, 1.6, 12, wall);
	bx(14.4, 0.7, 5.4, -8, 3.5, 12, c.roof);
	bx(14, 3.2, 5, -8, 1.6, -12, wall);
	bx(14.4, 0.7, 5.4, -8, 3.5, -12, c.roof);
	bx(7, 4, 7, -18, 2, 0, new THREE.Color('#8f8a7c'));
	// radio mast
	bx(0.35, 16, 0.35, 3, 8, 3, new THREE.Color('#9aa0a2'));
	bx(2.4, 0.2, 0.2, 3, 15.5, 3, new THREE.Color('#9aa0a2'));
	// helipad
	bx(9, 0.12, 9, 8, 0.06, 16, new THREE.Color('#5c5c58'));
	bx(0.7, 0.14, 5, 6.6, 0.1, 16, new THREE.Color('#e8e4d6'));
	bx(0.7, 0.14, 5, 9.4, 0.1, 16, new THREE.Color('#e8e4d6'));
	bx(3.5, 0.14, 0.7, 8, 0.1, 16, new THREE.Color('#e8e4d6'));
	const merged = M.merge(parts);
	const mesh = new THREE.Mesh(merged, mat);
	mesh.castShadow = mesh.receiveShadow = true;
	g.add(mesh);

	// sandbag ring on the front-facing side
	const bag = M.sandbag();
	const bagM: THREE.Matrix4[] = [];
	for (let k = 0; k < 38; k++) {
		const a = -1.3 + (k / 37) * 2.6;
		const R = 23;
		const x = Math.cos(a) * R + 2;
		const z = Math.sin(a) * R;
		for (let layer = 0; layer < 2; layer++)
			bagM.push(new THREE.Matrix4().compose(new THREE.Vector3(x, layer * 0.42, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2 + layer * 0.3), new THREE.Vector3(1, 1, 1)));
	}
	g.add(instanced(bag, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), bagM));

	// flag
	const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 6), new THREE.MeshStandardMaterial({ color: '#c9c9c4' }));
	pole.position.set(6, 6, -6);
	const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6, 8, 1), new THREE.MeshStandardMaterial({ color: c.roof, side: THREE.DoubleSide, roughness: 0.7 }));
	flag.position.set(8, 10.6, -6);
	flag.name = 'flag';
	pole.castShadow = flag.castShadow = true;
	g.add(pole, flag);

	// the sign: a billboard label that keeps a constant size on screen
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(c), sizeAttenuation: false, depthTest: false, transparent: true }));
	sprite.position.set(0, 22, 0);
	sprite.renderOrder = 50;
	sprite.name = 'sign';
	g.add(sprite);
	return g;
}

function signTexture(c: { sign: string; edge: string; label: string; icon: string }): THREE.Texture {
	const cv = document.createElement('canvas');
	cv.width = 256;
	cv.height = 132;
	const x = cv.getContext('2d')!;
	x.fillStyle = 'rgba(0,0,0,0.35)';
	x.fillRect(10, 40, 240, 88);
	x.fillStyle = c.sign;
	x.fillRect(4, 34, 240, 88);
	x.strokeStyle = c.edge;
	x.lineWidth = 4;
	x.strokeRect(6, 36, 236, 84);
	x.fillStyle = '#fff';
	x.font = '800 42px Inter, system-ui, sans-serif';
	x.textAlign = 'center';
	x.textBaseline = 'middle';
	x.fillText(c.label, 124, 80);
	// emblem tab above the plate
	x.fillStyle = c.sign;
	x.fillRect(96, 0, 56, 40);
	x.strokeRect(98, 2, 52, 36);
	x.font = '28px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
	x.fillText(c.icon, 124, 21);
	const t = new THREE.CanvasTexture(cv);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}
