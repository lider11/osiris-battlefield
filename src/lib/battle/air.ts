// Air strikes, the battlefield's big events: a helicopter rocket strike, a jet
// strike, and a bombing run, each flown in from the attacker's side and aimed at
// the densest stretch of the enemy's front.

import * as THREE from 'three';
import * as M from './models';
import type { Fx } from './fx';
import { type Army, DIR } from './army';
import { heightAt, BASE_X, MINZ, MAXZ, MINX, MAXX, clampZ } from './world';

export type StrikeKind = 'heli' | 'jet' | 'bomber';

type Craft = {
	kind: StrikeKind;
	side: number;
	obj: THREE.Object3D;
	rotor?: THREE.Object3D;
	t: number;
	phase: number;
	x: number; y: number; z: number;
	vx: number; vy: number; vz: number;
	yaw: number; bank: number; pitch: number;
	tx: number; tz: number;
	hx: number; hz: number; hy: number;
	shots: number; shotT: number; fired: boolean; scale: number;
};

export type AirHooks = { sound(kind: StrikeKind, x: number, z: number): void };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Air {
	readonly group = new THREE.Group();
	private crafts: Craft[] = [];
	private heliGeo = M.heliBody();
	private rotorGeo = M.heliRotor();
	private jetGeo = M.jet();
	private bomberGeo = M.bomber();
	private heliMat = [
		new THREE.MeshStandardMaterial({ vertexColors: true, color: '#4c9e62', roughness: 0.5, flatShading: true }),
		new THREE.MeshStandardMaterial({ vertexColors: true, color: '#c24d46', roughness: 0.5, flatShading: true })
	];
	private jetMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#cfd5da', roughness: 0.4, metalness: 0.2, flatShading: true });
	private bomberMat = [
		new THREE.MeshStandardMaterial({ vertexColors: true, color: '#7f9a82', roughness: 0.55, flatShading: true }),
		new THREE.MeshStandardMaterial({ vertexColors: true, color: '#9a7f7c', roughness: 0.55, flatShading: true })
	];
	private rotorMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#2a2a2a', roughness: 0.6 });

	constructor(
		private fx: Fx,
		private army: Army,
		private hooks: AirHooks
	) {}

	get active() {
		return this.crafts.length;
	}

	clear() {
		for (const c of this.crafts) this.group.remove(c.obj);
		this.crafts.length = 0;
	}

	/** `side` is the attacker. `scale` grows the ordnance with the event size. */
	strike(kind: StrikeKind, side: number, scale = 1, at?: { x: number; z: number }) {
		const target = at ?? this.army.strikePoint(1 - side);
		if (kind === 'heli') this.heli(side, target, scale);
		else if (kind === 'jet') this.jets(side, target, scale);
		else this.bombers(side, target, scale);
	}

	private make(kind: StrikeKind, side: number): { obj: THREE.Object3D; rotor?: THREE.Object3D } {
		if (kind === 'heli') {
			const obj = new THREE.Group();
			const body = new THREE.Mesh(this.heliGeo, this.heliMat[side]);
			const rotor = new THREE.Mesh(this.rotorGeo, this.rotorMat);
			rotor.position.y = 1.25;
			body.castShadow = rotor.castShadow = true;
			obj.add(body, rotor);
			obj.scale.setScalar(1.25);
			return { obj, rotor };
		}
		const m = new THREE.Mesh(kind === 'jet' ? this.jetGeo : this.bomberGeo, kind === 'jet' ? this.jetMat : this.bomberMat[side]);
		m.castShadow = true;
		m.scale.setScalar(kind === 'jet' ? 1.3 : 1.35);
		return { obj: m };
	}

	private add(c: Omit<Craft, 'obj' | 'rotor'>) {
		const { obj, rotor } = this.make(c.kind, c.side);
		const craft: Craft = { ...c, obj, rotor };
		obj.position.set(c.x, c.y, c.z);
		this.group.add(obj);
		this.crafts.push(craft);
		return craft;
	}

	private base(): Omit<Craft, 'obj' | 'rotor' | 'kind' | 'side'> {
		return {
			t: 0, phase: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, bank: 0, pitch: 0,
			tx: 0, tz: 0, hx: 0, hz: 0, hy: 0, shots: 0, shotT: 0, fired: false, scale: 1
		};
	}

	private heli(side: number, T: { x: number; z: number }, scale: number) {
		const dir = DIR[side];
		const hx = T.x + dir * 30;
		const hz = clampZ(T.z + rand(-10, 10));
		const x = dir * (BASE_X - 8);
		const z = clampZ(T.z + rand(-50, 50));
		this.add({
			...this.base(), kind: 'heli', side, x, y: 26, z, tx: T.x, tz: T.z, hx, hz,
			hy: heightAt(hx, hz) + 15, yaw: Math.atan2(-(hz - z), hx - x), shots: Math.round(6 + 4 * scale), scale
		});
		this.hooks.sound('heli', x, z);
	}

	private jets(side: number, T: { x: number; z: number }, scale: number) {
		const dir = DIR[side];
		const n = scale > 1.6 ? 3 : 2;
		const angle = rand(-0.35, 0.35);
		const vx = -dir * Math.cos(angle) * 125;
		const vz = Math.sin(angle) * 125;
		for (let k = 0; k < n; k++) {
			const off = (k - (n - 1) / 2) * 9;
			const lag = Math.abs(k - (n - 1) / 2) * 14;
			const sx = T.x - (vx / 125) * (330 + lag);
			const sz = T.z - (vz / 125) * (330 + lag) + off;
			this.add({
				...this.base(), kind: 'jet', side, x: sx, y: 40 + k * 2, z: sz, vx, vy: 0, vz,
				tx: T.x + rand(-6, 6), tz: T.z + off * 0.6, yaw: Math.atan2(-vz, vx), scale
			});
		}
		this.hooks.sound('jet', T.x, T.z);
	}

	private bombers(side: number, T: { x: number; z: number }, scale: number) {
		const dir = DIR[side];
		const sgn = Math.random() < 0.5 ? 1 : -1;
		const lane = this.army.front - dir * rand(12, 26);
		const n = scale > 1.6 ? 4 : 3;
		for (let k = 0; k < n; k++) {
			const x = Math.min(MAXX - 6, Math.max(MINX + 6, lane + (k - (n - 1) / 2) * 11));
			const z = -sgn * (MAXZ + 140 + k * 16);
			this.add({
				...this.base(), kind: 'bomber', side, x, y: 48 + k * 1.5, z, vx: 0, vz: sgn * 58,
				yaw: Math.atan2(-sgn, 0), tx: T.x, tz: T.z, scale
			});
		}
		this.hooks.sound('bomber', lane, 0);
	}

	update(dt: number) {
		for (let i = this.crafts.length - 1; i >= 0; i--) {
			const c = this.crafts[i];
			c.t += dt;
			let gone = false;
			if (c.kind === 'heli') gone = this.flyHeli(c, dt);
			else if (c.kind === 'jet') gone = this.flyJet(c, dt);
			else gone = this.flyBomber(c, dt);
			c.obj.position.set(c.x, c.y, c.z);
			c.obj.rotation.set(c.bank, c.yaw, c.pitch, 'YXZ');
			if (gone || c.t > 40) {
				this.group.remove(c.obj);
				this.crafts.splice(i, 1);
			}
		}
	}

	private flyHeli(c: Craft, dt: number): boolean {
		if (c.rotor) c.rotor.rotation.y += dt * 38;
		const dir = DIR[c.side];
		if (c.phase === 0) {
			const dx = c.hx - c.x;
			const dz = c.hz - c.z;
			const dy = c.hy - c.y;
			const d = Math.hypot(dx, dz);
			const sp = Math.min(38, 6 + d * 0.9);
			if (d > 1.5) {
				c.x += (dx / d) * sp * dt;
				c.z += (dz / d) * sp * dt;
			}
			c.y += dy * Math.min(1, dt * 1.2);
			c.yaw += wrap(Math.atan2(-dz, dx) - c.yaw) * Math.min(1, dt * 2.5);
			c.pitch += (-0.22 * Math.min(1, sp / 38) - c.pitch) * Math.min(1, dt * 3);
			if (d < 3) {
				c.phase = 1;
				c.shotT = 0.4;
			}
		} else if (c.phase === 1) {
			const want = Math.atan2(-(c.tz - c.z), c.tx - c.x);
			c.yaw += wrap(want - c.yaw) * Math.min(1, dt * 3);
			c.pitch += (0.06 - c.pitch) * Math.min(1, dt * 3);
			c.y += Math.sin(c.t * 2) * 0.02;
			c.shotT -= dt;
			if (c.shotT <= 0 && c.shots > 0) {
				c.shots--;
				c.shotT = 0.28;
				const side = c.shots % 2 ? 1.7 : -1.7;
				const cy = Math.cos(c.yaw);
				const sy = Math.sin(c.yaw);
				// pod positions in the heli frame, rotated into the world
				const px = c.x + cy * 1.2 + sy * side;
				const pz = c.z - sy * 1.2 + cy * side;
				const tx = c.tx + rand(-8, 8);
				const tz = c.tz + rand(-8, 8);
				const victims = 1 - c.side;
				const s = 0.95 * c.scale;
				this.fx.missile(px, c.y - 0.6, pz, tx, heightAt(tx, tz) + 0.3, tz, 85, () => this.army.impact(tx, tz, s, victims));
			}
			if (c.shots <= 0 && c.shotT < -0.8) c.phase = 2;
		} else {
			// egress: turn for home and climb away
			const hx = dir * (BASE_X + 60);
			const dx = hx - c.x;
			const dz = -c.z * 0.2;
			c.yaw += wrap(Math.atan2(-dz, dx) - c.yaw) * Math.min(1, dt * 2);
			c.x += Math.cos(c.yaw) * 36 * dt;
			c.z -= Math.sin(c.yaw) * 36 * dt;
			c.y += 5 * dt;
			c.pitch += (-0.25 - c.pitch) * Math.min(1, dt * 2);
			return Math.abs(c.x) > MAXX + 50;
		}
		c.bank = Math.sin(c.t * 1.3) * 0.04;
		return false;
	}

	private flyJet(c: Craft, dt: number): boolean {
		c.x += c.vx * dt;
		c.y += c.vy * dt;
		c.z += c.vz * dt;
		const dir = DIR[c.side];
		// distance still to run to the target, along the flight path
		const ahead = ((c.tx - c.x) * c.vx + (c.tz - c.z) * c.vz) / 125;
		if (!c.fired && ahead < 85) {
			c.fired = true;
			const victims = 1 - c.side;
			const s = 1.6 * c.scale;
			for (let k = 0; k < 2; k++) {
				const tx = c.tx + rand(-9, 9);
				const tz = c.tz + rand(-9, 9);
				const off = k ? 2.6 : -2.6;
				this.fx.missile(c.x, c.y - 1, c.z + off, tx, heightAt(tx, tz) + 0.3, tz, 150, () => {
					this.army.impact(tx, tz, s, victims);
					this.army.blast(tx, tz, 9 * c.scale, 0.8, victims);
				});
			}
		}
		if (c.fired && ahead < 0) {
			c.vy = Math.min(40, c.vy + 30 * dt);
			c.pitch += (0.35 - c.pitch) * Math.min(1, dt * 2);
		}
		c.bank = Math.sin(c.t * 0.9 + dir) * 0.08;
		// contrails off the wingtips
		const cy = Math.cos(c.yaw);
		const sy = Math.sin(c.yaw);
		for (const w of [-4.2, 4.2]) this.fx.puff(c.x - cy * 1.5 + sy * w, c.y, c.z + sy * 1.5 + cy * w, 0.5, 0.92, 0.35, 2.6);
		return c.x > MAXX + 360 || c.x < MINX - 360 || c.z > MAXZ + 360 || c.z < MINZ - 360;
	}

	private flyBomber(c: Craft, dt: number): boolean {
		c.x += c.vx * dt;
		c.z += c.vz * dt;
		c.bank = 0;
		if (c.z > MINZ + 6 && c.z < MAXZ - 6) {
			c.shotT -= dt;
			if (c.shotT <= 0) {
				c.shotT = 0.24;
				const victims = 1 - c.side;
				const s = 1.8 * c.scale;
				// the bomb lands where it falls, not where it was aimed
				this.fx.bomb(c.x, c.y - 1.5, c.z, 0, c.vz * 0.9, (x, z) => this.army.impact(x, z, s, victims));
			}
		}
		return Math.abs(c.z) > MAXZ + 200 && Math.sign(c.z) === Math.sign(c.vz);
	}
}
