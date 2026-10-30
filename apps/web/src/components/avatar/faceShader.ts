/**
 * GPU face for the dense head mesh.
 *
 * The vertex shader turns each unit-sphere vertex into a point on the face:
 * brow ridge, sunken eye sockets, nose, cheekbones, a jaw that really opens, a
 * mouth slot, a skull crest, ear discs and armour-plate panelling. True normals
 * are rebuilt by finite differences on the displaced surface, so lighting follows
 * the sculpt at full 500k-triangle resolution.
 *
 * The fragment shader adds metallic shading, a fresnel rim, travelling energy
 * veins, a scan line, glowing sockets/mouth and a dissolve-in reveal.
 *
 * The same material draws the main head and the instanced Legion faces
 * (USE_INSTANCING), so expression uniforms drive every face at once.
 */

import * as THREE from "three";
import { palette } from "@/theme/palette";

const NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
`;

export const faceVertexShader = /* glsl */ `
uniform float uTime;
uniform float uMouth;
uniform float uBrow;
uniform float uSpeak;

varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vDir;
varying float vSocket;
varying float vMouth;

${NOISE}

// Anisotropic gaussian bump centred on a point of the unit sphere.
float gauss(vec3 d, vec3 c, vec3 s) {
  vec3 o = (d - normalize(c)) / s;
  return exp(-dot(o, o));
}

struct Feat {
  float h;      // radial displacement
  float socket; // eye-socket mask
  float mouth;  // mouth-slot mask
  float jaw;    // lower-jaw weight (moves when the mouth opens)
};

Feat features(vec3 d) {
  vec3 m = vec3(abs(d.x), d.y, d.z); // bilateral symmetry
  Feat f;
  float h = 0.0;

  f.socket = gauss(m, vec3(0.34, 0.14, 0.93), vec3(0.20, 0.10, 0.30));
  h -= 0.085 * f.socket;
  // brow ridge: heavier and lower when focused (uBrow > 0), lifted when alert
  h += (0.05 + 0.03 * uBrow) * gauss(m, vec3(0.30, 0.31 - 0.03 * uBrow, 0.90), vec3(0.28, 0.06, 0.30));
  h += 0.075 * gauss(d, vec3(0.0, -0.02, 1.0), vec3(0.07, 0.22, 0.25));      // nose
  h += 0.035 * gauss(m, vec3(0.50, -0.16, 0.84), vec3(0.18, 0.12, 0.25));    // cheekbones

  f.jaw = (1.0 - smoothstep(-0.50, -0.30, d.y)) * smoothstep(-0.20, 0.35, d.z);
  h += 0.03 * f.jaw;
  float slot = 0.018 + uMouth * 0.10;
  f.mouth = gauss(d, vec3(0.0, -0.40, 0.91), vec3(0.30, slot, 0.30));
  h -= 0.10 * f.mouth;
  h -= 0.012 * gauss(d, vec3(0.0, -0.34, 0.94), vec3(0.80, 0.015, 0.40));    // jaw seam

  float cx = d.x / 0.09;
  h += 0.07 * exp(-cx * cx) * smoothstep(0.15, 0.75, d.y);                   // skull crest

  vec3 ec = normalize(vec3(0.99, 0.02, -0.12));
  float er = distance(m, ec);
  h += 0.05 * exp(-er * er / 0.04) + 0.012 * sin(er * 60.0) * exp(-er * er * 18.0); // ear discs + rings

  // armour plating: cube-grid panels with grooves, calmed near sockets and mouth
  vec3 q = d * 14.0 + 3.7;
  vec3 cell = floor(q);
  vec3 fq = abs(fract(q) - 0.5);
  float edge = 0.5 - max(max(fq.x, fq.y), fq.z);
  float groove = 1.0 - smoothstep(0.0, 0.07, edge);
  float calm = 1.0 - clamp(f.socket + f.mouth * 1.5, 0.0, 1.0);
  h += calm * ((hash13(cell) - 0.5) * 0.012 - groove * 0.008);
  h += 0.0025 * vnoise(d * 90.0);                                            // micro detail
  h += uSpeak * 0.008 * sin(d.y * 24.0 - uTime * 9.0) * smoothstep(-0.6, 0.8, d.z); // speech ripple

  f.h = h;
  return f;
}

vec3 place(vec3 d, Feat f) {
  vec3 p = d * (1.0 + f.h);
  p.y -= f.jaw * uMouth * 0.16;
  p.z -= f.jaw * uMouth * 0.03;
  return p;
}

void main() {
  vec3 d = normalize(position);
  Feat f0 = features(d);
  vec3 p0 = place(d, f0);

  // Finite-difference normal on the displaced surface.
  vec3 t = normalize(cross(d, abs(d.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(d, t);
  float e = 0.007;
  vec3 d1 = normalize(d + t * e);
  vec3 d2 = normalize(d + b * e);
  vec3 p1 = place(d1, features(d1));
  vec3 p2 = place(d2, features(d2));
  vec3 n = normalize(cross(p1 - p0, p2 - p0));
  if (dot(n, d) < 0.0) n = -n;

  vec3 objPos = p0;
  vec3 objNrm = n;
#ifdef USE_INSTANCING
  objPos = (instanceMatrix * vec4(p0, 1.0)).xyz;
  objNrm = mat3(instanceMatrix) * n;
#endif

  vec4 mv = modelViewMatrix * vec4(objPos, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * objNrm);
  vDir = d;
  vSocket = f0.socket;
  vMouth = f0.mouth;
  gl_Position = projectionMatrix * mv;
}
`;

export const faceFragmentShader = /* glsl */ `
uniform vec3 uAccent;
uniform vec3 uBase;
uniform float uTime;
uniform float uEnergy;
uniform float uSpeak;
uniform float uReveal;
uniform float uMouth;

varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vDir;
varying float vSocket;
varying float vMouth;

${NOISE}

void main() {
  // Dissolve-in: a noisy front climbs the head from the chin up.
  float k = vnoise(vDir * 5.0) * 0.6 + (vDir.y * 0.5 + 0.5) * 0.4;
  float front = uReveal * 1.25;
  if (k > front) discard;
  float revealing = 1.0 - step(0.999, uReveal);
  float rim = (1.0 - smoothstep(0.0, 0.06, front - k)) * revealing;

  vec3 N = normalize(vNormalV);
  vec3 V = normalize(-vViewPos);
  vec3 L = normalize(vec3(0.5, 0.7, 0.6));
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 3.0);
  float spec = pow(max(dot(N, H), 0.0), 48.0);

  vec3 col = uBase * (0.18 + 0.9 * ndl);
  col += uAccent * spec * 0.9;
  col += uAccent * fres * (0.55 + uEnergy * 0.9);

  // Energy veins: thin lines where noise crosses 0.5, with pulses running along them.
  float vn = vnoise(vDir * 6.5 + vec3(0.0, uTime * 0.05, 0.0));
  float vein = 1.0 - smoothstep(0.0, 0.03, abs(vn - 0.5));
  float travel = 0.5 + 0.5 * sin(vDir.y * 10.0 - uTime * (1.2 + uSpeak * 5.0) + vn * 6.0);
  col += uAccent * vein * (0.25 + travel * 1.1) * (0.4 + uEnergy);

  // Slow scan line.
  float sweepY = fract(uTime * 0.11) * 2.6 - 1.3;
  col += uAccent * (1.0 - smoothstep(0.0, 0.05, abs(vDir.y - sweepY))) * 0.55;

  // Sockets stay dark with a hot core; the mouth cavity glows as it opens.
  col *= 1.0 - 0.55 * vSocket;
  col += uAccent * vSocket * vSocket * (0.7 + uEnergy);
  col += uAccent * vMouth * (0.25 + uMouth * 2.2);
  col += uAccent * rim * 3.0;

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export type FaceMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uTime: { value: number };
    uMouth: { value: number };
    uBrow: { value: number };
    uSpeak: { value: number };
    uEnergy: { value: number };
    uReveal: { value: number };
    uAccent: { value: THREE.Color };
    uBase: { value: THREE.Color };
  };
};

export function createFaceMaterial(accent: THREE.Color): FaceMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: faceVertexShader,
    fragmentShader: faceFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uMouth: { value: 0 },
      uBrow: { value: 0 },
      uSpeak: { value: 0 },
      uEnergy: { value: 0.55 },
      uReveal: { value: 0 },
      uAccent: { value: accent.clone() },
      uBase: { value: new THREE.Color(palette.graphite) },
    },
  }) as FaceMaterial;
}
