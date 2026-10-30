/**
 * Dense procedural head geometry.
 *
 * The head is a geodesic sphere: an icosahedron whose 20 faces are each split
 * into n x n triangles. A sphere subdivided that way has exactly
 *
 *     triangles = 20 * n^2        vertices = 10 * n^2 + 2
 *
 * so n = 158 gives 499,280 triangles on 249,642 shared vertices - the "500k face"
 * head. The mesh is indexed (vertices are shared across edges), which keeps it
 * to ~3 MB of position data instead of the ~17 MB a non-indexed layout needs.
 *
 * The sphere itself is featureless. All of the face - brow, nose, sockets, jaw,
 * armour plating - is displaced from it in the vertex shader (faceShader.ts), so
 * expressions cost uniforms, not CPU geometry updates.
 */

import * as THREE from "three";

export type FaceTierId = "low" | "medium" | "high" | "ultra";

/** Subdivisions per icosahedron edge for each quality tier. */
export const FACE_TIERS: Record<FaceTierId, number> = {
  low: 20, //   8,000 faces
  medium: 40, //  32,000 faces
  high: 80, // 128,000 faces
  ultra: 158, // 499,280 faces
};

export const TIER_ORDER: readonly FaceTierId[] = ["low", "medium", "high", "ultra"];

/** Subdivisions used for each mini face in the Legion ring. */
export const LEGION_SEGMENTS = 12;

export const faceCount = (segments: number): number => 20 * segments * segments;
export const vertexCount = (segments: number): number => 10 * segments * segments + 2;

const PHI = (1 + Math.sqrt(5)) / 2;

const BASE_VERTICES: ReadonlyArray<readonly [number, number, number]> = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1],
];

/** Counter-clockwise (outward-facing) triangles of the base icosahedron. */
const BASE_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

export type FaceMesh = { positions: Float32Array; indices: Uint32Array };

/**
 * Build the indexed unit-sphere mesh. Pure (no three.js), so it can be verified
 * in isolation: vertex/triangle counts, outward winding and watertightness.
 */
export function buildFaceMesh(segments: number): FaceMesh {
  const n = Math.floor(segments);
  if (!Number.isFinite(n) || n < 1) throw new RangeError("segments must be a positive integer");

  const positions = new Float32Array(vertexCount(n) * 3);
  const indices = new Uint32Array(faceCount(n) * 3);

  const corners = BASE_VERTICES.map(([x, y, z]) => {
    const len = Math.hypot(x, y, z);
    return [x / len, y / len, z / len] as const;
  });
  let vc = 0;
  for (const [x, y, z] of corners) {
    positions[vc * 3] = x;
    positions[vc * 3 + 1] = y;
    positions[vc * 3 + 2] = z;
    vc += 1;
  }

  // Vertices along a shared icosahedron edge, created once and reused by both
  // neighbouring faces. Keyed by lo*12+hi; entry k is k steps from `lo`.
  const edges = new Map<number, Int32Array>();

  const place = (ca: number, cb: number, cc: number, wa: number, wb: number, wc: number): number => {
    const a = corners[ca]!;
    const b = corners[cb]!;
    const c = corners[cc]!;
    const x = a[0] * wa + b[0] * wb + c[0] * wc;
    const y = a[1] * wa + b[1] * wb + c[1] * wc;
    const z = a[2] * wa + b[2] * wb + c[2] * wc;
    const inv = 1 / Math.hypot(x, y, z);
    const idx = vc;
    vc += 1;
    positions[idx * 3] = x * inv;
    positions[idx * 3 + 1] = y * inv;
    positions[idx * 3 + 2] = z * inv;
    return idx;
  };

  const vertexAt = (ca: number, cb: number, cc: number, wa: number, wb: number, wc: number): number => {
    if (wa === n) return ca;
    if (wb === n) return cb;
    if (wc === n) return cc;

    let p = -1;
    let q = -1;
    let wp = 0;
    let wq = 0;
    if (wa === 0) [p, q, wp, wq] = [cb, cc, wb, wc];
    else if (wb === 0) [p, q, wp, wq] = [ca, cc, wa, wc];
    else if (wc === 0) [p, q, wp, wq] = [ca, cb, wa, wb];

    if (p < 0) return place(ca, cb, cc, wa, wb, wc); // interior: unique to this face

    const lo = Math.min(p, q);
    const hi = Math.max(p, q);
    const key = lo * 12 + hi;
    let table = edges.get(key);
    if (!table) {
      table = new Int32Array(n + 1).fill(-1);
      table[0] = lo;
      table[n] = hi;
      edges.set(key, table);
    }
    const k = lo === p ? wq : wp; // weight of `hi` == steps from `lo`
    let idx = table[k]!;
    if (idx < 0) {
      idx = place(ca, cb, cc, wa, wb, wc);
      table[k] = idx;
    }
    return idx;
  };

  let ti = 0;
  const rowStart = new Int32Array(n + 2);
  const grid = new Int32Array(((n + 1) * (n + 2)) / 2);

  for (const [ca, cb, cc] of BASE_FACES) {
    // grid[rowStart[i] + j] = vertex with weight i on corner b and j on corner c.
    let off = 0;
    for (let i = 0; i <= n; i += 1) {
      rowStart[i] = off;
      for (let j = 0; j <= n - i; j += 1) {
        grid[off + j] = vertexAt(ca, cb, cc, n - i - j, i, j);
      }
      off += n - i + 1;
    }
    for (let i = 0; i < n; i += 1) {
      const r0 = rowStart[i]!;
      const r1 = rowStart[i + 1]!;
      for (let j = 0; j < n - i; j += 1) {
        indices[ti++] = grid[r0 + j]!;
        indices[ti++] = grid[r1 + j]!;
        indices[ti++] = grid[r0 + j + 1]!;
        if (j < n - i - 1) {
          indices[ti++] = grid[r1 + j]!;
          indices[ti++] = grid[r1 + j + 1]!;
          indices[ti++] = grid[r0 + j + 1]!;
        }
      }
    }
  }
  return { positions, indices };
}

/**
 * Wrap the mesh for three.js. Normals equal positions (unit sphere); the vertex
 * shader recomputes true normals after displacement. The bounding sphere is set
 * by hand because the shader pushes vertices beyond the raw geometry bounds.
 */
export function createFaceGeometry(segments: number): THREE.BufferGeometry {
  const { positions, indices } = buildFaceMesh(segments);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.4);
  return geometry;
}
