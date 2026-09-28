// Tactical nukes: a white-hot fireball that climbs into a rolling mushroom cap on
// a boiling stem, a condensation ring, a ground-hugging base surge, then a slow
// dissolve. The cloud parts are noise-displaced meshes lit in the shader (faceted,
// to sit with the toy look), glowing from inside while hot and cooling to smoke.

import * as THREE from 'three';
import type { Fx } from './fx';

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
	const vec2 C=vec2(1.0/6.0,1.0/3.0);
	const vec4 D=vec4(0.0,0.5,1.0,2.0);
	vec3 i=floor(v+dot(v,C.yyy));
	vec3 x0=v-i+dot(i,C.xxx);
	vec3 g=step(x0.yzx,x0.xyz);
	vec3 l=1.0-g;
	vec3 i1=min(g.xyz,l.zxy);
	vec3 i2=max(g.xyz,l.zxy);
	vec3 x1=x0-i1+C.xxx;
	vec3 x2=x0-i2+C.yyy;
	vec3 x3=x0-D.yyy;
	i=mod289(i);
	vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
	float n_=0.142857142857;
	vec3 ns=n_*D.wyz-D.xzx;
	vec4 j=p-49.0*floor(p*ns.z*ns.z);
	vec4 x_=floor(j*ns.z);
	vec4 y_=floor(j-7.0*x_);
	vec4 x=x_*ns.x+ns.yyyy;
	vec4 y=y_*ns.x+ns.yyyy;
	vec4 h=1.0-abs(x)-abs(y);
	vec4 b0=vec4(x.xy,y.xy);
	vec4 b1=vec4(x.zw,y.zw);
	vec4 s0=floor(b0)*2.0+1.0;
	vec4 s1=floor(b1)*2.0+1.0;
	vec4 sh=-step(h,vec4(0.0));
	vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
	vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
	vec3 p0=vec3(a0.xy,h.x);
	vec3 p1=vec3(a0.zw,h.y);
	vec3 p2=vec3(a1.xy,h.z);
	vec3 p3=vec3(a1.zw,h.w);
	vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
	p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
	vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
	m=m*m;
	return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){float a=0.55,s=0.0;for(int i=0;i<4;i++){s+=a*snoise(p);p*=2.07;a*=0.5;}return s;}
`;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime, uAmp, uFreq, uFlow, uSeed;
varying vec3 vWP;
varying float vN;
varying float vLocalY;
${NOISE}
void main() {
	vec4 wp = modelMatrix * vec4(position, 1.0);
	vec3 wn = normalize(mat3(modelMatrix) * normal);
	// noise in world space so stretched parts still billow evenly; uFlow scrolls it (rising / rolling)
	float n = fbm(wp.xyz * uFreq + vec3(uSeed, -uTime * uFlow, uSeed * 0.7));
	vN = n;
	vLocalY = position.y;
	wp.xyz += wn * (0.35 + n) * uAmp;
	vWP = wp.xyz;
	vec4 mvPosition = viewMatrix * wp;
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uHeat, uFade, uUnderGlow;
uniform vec3 uSmoke;
varying vec3 vWP;
varying float vN;
varying float vLocalY;
void main() {
	float n = vN * 0.5 + 0.5;
	if (n < uFade) discard; // dissolve as it thins out
	vec3 fn = normalize(cross(dFdx(vWP), dFdy(vWP)));
	vec3 L = normalize(vec3(-0.55, 0.78, -0.3));
	float diff = clamp(dot(fn, L) * 0.6 + 0.5, 0.0, 1.0);
	// hottest in the folds, and on the underside of the cap
	float heat = clamp(uHeat * (1.3 - n) + uUnderGlow * uHeat * clamp(-vLocalY, 0.0, 1.0), 0.0, 1.0);
	vec3 fire = mix(vec3(0.45, 0.05, 0.01), vec3(2.4, 0.95, 0.2), smoothstep(0.1, 0.55, heat));
	fire = mix(fire, vec3(3.8, 3.3, 1.9), smoothstep(0.8, 1.0, heat));
	vec3 smoke = uSmoke * (0.4 + 0.7 * diff) * (0.7 + 0.5 * n);
	gl_FragColor = vec4(mix(smoke, fire, smoothstep(0.06, 0.4, heat)), 1.0);
	#include <fog_fragment>
}`;

type Part = { mesh: THREE.Mesh; u: Record<string, THREE.IUniform> };

type Blast = {
	x: number; y: number; z: number; s: number; t: number;
	group: THREE.Group;
	dome: Part; roll: Part; stem: Part;
	ring: THREE.Mesh;
	nextPuff: number;
	surgeWave: number; // base-surge dust rings released so far
};

const LIFE = 18;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const ease = (t: number, k: number) => 1 - Math.exp(-k * t);

export class Nukes {
	readonly group = new THREE.Group();
	private list: Blast[] = [];
	private geo = {
		dome: new THREE.IcosahedronGeometry(1, 10),
		roll: new THREE.TorusGeometry(1, 0.46, 24, 64).rotateX(Math.PI / 2),
		stem: new THREE.CylinderGeometry(0.55, 1, 1, 28, 14, true).translate(0, 0.5, 0),
		ring: new THREE.TorusGeometry(1, 0.05, 6, 72).rotateX(Math.PI / 2)
	};

	constructor(private fx: Fx) {}

	private part(geo: THREE.BufferGeometry, freq: number, flow: number, under: number): Part {
		const u: Record<string, THREE.IUniform> = {
			...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
			uTime: { value: 0 },
			uAmp: { value: 1 },
			uFreq: { value: freq },
			uFlow: { value: flow },
			uSeed: { value: Math.random() * 50 },
			uHeat: { value: 1 },
			uFade: { value: 0 },
			uUnderGlow: { value: under },
			uSmoke: { value: new THREE.Color(0.36, 0.29, 0.23) }
		};
		const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, fog: true });
		const mesh = new THREE.Mesh(geo, mat);
		mesh.castShadow = true;
		mesh.frustumCulled = false;
		return { mesh, u };
	}

	/** Detonate at (x, y, z); `s` scales the whole event (1 = tiny, 1.8 = less tiny). */
	spawn(x: number, y: number, z: number, s: number) {
		const group = new THREE.Group();
		group.position.set(x, y, z);
		const b: Blast = {
			x, y, z, s, t: 0, group,
			dome: this.part(this.geo.dome, 0.11 / s, 0.5, 1.8),
			roll: this.part(this.geo.roll, 0.13 / s, 0.9, 1.2),
			stem: this.part(this.geo.stem, 0.16 / s, 1.6, 0),
			ring: new THREE.Mesh(this.geo.ring, new THREE.MeshBasicMaterial({ color: '#f4f4f0', transparent: true, opacity: 0, depthWrite: false })),
			nextPuff: 0,
			surgeWave: 0
		};
		group.add(b.stem.mesh, b.roll.mesh, b.dome.mesh, b.ring);
		this.group.add(group);
		this.list.push(b);

		// the first instant: blinding flash, sparks, debris
		this.fx.flash(x, y + 8 * s, z, 140 * s, 9000 * s);
		this.fx.explode(x, y, z, 2.4, false);
		for (let k = 0; k < 60; k++) {
			const a = Math.random() * Math.PI * 2;
			const sp = rand(18, 46) * s;
			this.fx.add.spawn(x, y + 2, z, Math.cos(a) * sp * 0.7, rand(12, 40) * s, Math.sin(a) * sp * 0.7, rand(0.8, 1.8), 0.7, 0.3, 4, 2.6, 1, 1, 2.2, 0.5, 0.1, 0, 0.4, -24);
		}
		this.update(0);
	}

	clear() {
		for (const b of this.list) this.dispose(b);
		this.list.length = 0;
	}

	private dispose(b: Blast) {
		this.group.remove(b.group);
		for (const p of [b.dome, b.roll, b.stem]) (p.mesh.material as THREE.Material).dispose();
		(b.ring.material as THREE.Material).dispose();
	}

	update(dt: number) {
		for (let i = this.list.length - 1; i >= 0; i--) {
			const b = this.list[i];
			b.t += dt;
			const t = b.t;
			const s = b.s;
			if (t > LIFE) {
				this.dispose(b);
				this.list.splice(i, 1);
				continue;
			}
			// the cap climbs and swells into a flat dome over a rolling skirt; the stem follows it up
			const h = s * (6 + 46 * ease(t, 0.28));
			const R = s * (5 + 11 * ease(t, 0.8) + 0.35 * t);
			const stemR = s * (1 + 2.2 * ease(t, 0.7));
			const heat = t < 0.4 ? 1 : Math.max(0, 1 - (t - 0.4) / 10);
			const fade = Math.max(0, Math.min(1.05, (t - 9) / 8.5));
			const cool = Math.min(1, t / 12);
			// sooty brown while it burns, cooling to grey
			const smoke = (p: Part, r: number, g: number, bl: number) => p.u.uSmoke.value.setRGB(r + 0.12 * cool, g + 0.15 * cool, bl + 0.18 * cool);

			b.dome.mesh.position.y = h + R * 0.12;
			b.dome.mesh.scale.set(R * 0.95, R * 0.52, R * 0.95);
			b.roll.mesh.position.y = h - R * 0.16;
			b.roll.mesh.scale.set(R * 0.82, R * 0.9, R * 0.82);
			b.roll.mesh.rotation.y += dt * 0.35;
			const stemH = Math.max(0.1, h - R * 0.3);
			b.stem.mesh.scale.set(stemR, stemH, stemR);
			b.stem.mesh.visible = t > 0.25;
			for (const [p, amp, hm] of [
				[b.dome, 0.26 * R, 0.85],
				[b.roll, 0.2 * R, 1],
				[b.stem, 0.8 * stemR, 0.7]
			] as [Part, number, number][]) {
				p.u.uTime.value = t;
				p.u.uAmp.value = amp;
				p.u.uHeat.value = heat * hm;
				p.u.uFade.value = fade;
			}
			smoke(b.dome, 0.21, 0.13, 0.08);
			smoke(b.roll, 0.17, 0.1, 0.06);
			smoke(b.stem, 0.2, 0.13, 0.08);

			// base surge: rings of dust rolling out along the ground
			while (b.surgeWave < 3 && t >= b.surgeWave * 0.35) {
				const wave = b.surgeWave++;
				for (let k = 0; k < 44; k++) {
					const a = (k / 44) * Math.PI * 2 + rand(-0.05, 0.05);
					const sp = rand(20, 32) * s * (1 - wave * 0.25);
					const r0 = 3 * s;
					this.fx.smoke.spawn(
						b.x + Math.cos(a) * r0, b.y + rand(0.5, 2.5) * s, b.z + Math.sin(a) * r0,
						Math.cos(a) * sp, rand(0.4, 2), Math.sin(a) * sp,
						rand(5, 7.5), 3.5 * s, rand(11, 15) * s,
						0.46, 0.39, 0.3, 0.85, 0.62, 0.57, 0.5, 0,
						0.85, 0.3
					);
				}
			}

			// the condensation ring flashes out around the stem, then melts
			const rt = (t - 0.6) / 3.2;
			const ringOn = rt > 0 && rt < 1;
			b.ring.visible = ringOn;
			if (ringOn) {
				b.ring.position.y = h * 0.55;
				const rr = stemR * 2 + s * 14 * rt;
				b.ring.scale.set(rr, s * 6, rr);
				(b.ring.material as THREE.MeshBasicMaterial).opacity = Math.sin(rt * Math.PI) * 0.75;
			}

			// glowing embers and dust around the base while it is hot
			if (t < 7 && t >= b.nextPuff) {
				b.nextPuff = t + 0.08;
				const a = Math.random() * Math.PI * 2;
				const r = s * rand(4, 16);
				this.fx.puff(b.x + Math.cos(a) * r, b.y + 1, b.z + Math.sin(a) * r, 3 * s, 0.4, 0.55, 4);
				if (heat > 0.2) this.fx.flame(b.x + rand(-2, 2) * s, b.y + 1, b.z + rand(-2, 2) * s, 3 * s * heat);
			}
		}
	}
}
