/**
 * Self-contained sport ball textures for THREE.SphereGeometry.
 * Usage: const materials = createSportMaterials(THREE);
 *        const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), materials.soccer);
 * The maps are static, seamless UV textures: rotating the mesh rotates its markings.
 * No network requests or image assets are needed.
 */
function createSportMaterials(THREE) {
  const W = 1024, H = 512;
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const normalize = v => { const m = Math.hypot(...v); return v.map(x => x / m); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // Continuous world-space noise keeps the longitude seam and the poles clean.
  function hash3(x, y, z) {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  function grain(x, y, z, frequency) {
    return hash3(Math.floor(x * frequency), Math.floor(y * frequency), Math.floor(z * frequency));
  }

  const golden = (1 + Math.sqrt(5)) / 2;
  const vertices = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    vertices.push(normalize([0, a, b * golden]));
    vertices.push(normalize([a, b * golden, 0]));
    vertices.push(normalize([b * golden, 0, a]));
  }
  // Icosahedron vertices become the 12 black pentagons. Its 20 face centers
  // become the white hexagons. Their spherical Voronoi cells form a football.
  const centers = vertices.map(v => ({ n: v, black: true }));
  const edgeDot = 1 / Math.sqrt(5);
  for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) {
    if (Math.abs(dot(vertices[a], vertices[b]) - edgeDot) > 0.0001) continue;
    for (let c = b + 1; c < 12; c++) {
      if (Math.abs(dot(vertices[a], vertices[c]) - edgeDot) > 0.0001 ||
          Math.abs(dot(vertices[b], vertices[c]) - edgeDot) > 0.0001) continue;
      centers.push({ n: normalize(vertices[a].map((x, j) => x + vertices[b][j] + vertices[c][j])), black: false });
    }
  }
  const boundaryScale = centers.map(a => centers.map(b => Math.sqrt(Math.max(1e-9, 2 - 2 * dot(a.n, b.n)))));

  // Reused output is [red, green, blue, bump height]; avoids per-pixel allocation.
  const out = [0, 0, 0, 0];
  function soccer(x, y, z) {
    let first = -2, second = -2, ai = 0, bi = 1;
    for (let i = 0; i < centers.length; i++) {
      const n = centers[i].n, d = x * n[0] + y * n[1] + z * n[2];
      if (d > first) { second = first; bi = ai; first = d; ai = i; }
      else if (d > second) { second = d; bi = i; }
    }
    const distance = (first - second) / boundaryScale[ai][bi];
    const face = smooth(0.002, 0.010, distance);
    const g = grain(x, y, z, 400);
    const dark = centers[ai].black;
    const brightness = 0.976 + g * 0.033;
    const base = dark ? [31, 37, 45] : [239, 239, 229];
    const crease = [79, 84, 82];
    // A muted silver-gray stitch valley is visible beside both panel colors.
    for (let c = 0; c < 3; c++) out[c] = (crease[c] * (1 - face) + base[c] * face) * brightness;
    out[3] = 0.21 + face * 0.48 + (g - 0.5) * 0.11;
  }

  function tennis(x, y, z) {
    const longitude = Math.atan2(z, x), latitude = Math.asin(clamp(y, -1, 1));
    const amplitude = 0.76;
    const f = latitude - amplitude * Math.sin(longitude * 2);
    const tangent = 2 * amplitude * Math.cos(longitude * 2) / Math.max(0.15, Math.cos(latitude));
    const distance = Math.abs(f) / Math.sqrt(1 + tangent * tangent);
    const groove = 1 - smooth(0.027, 0.043, distance);
    const white = 1 - smooth(0.018, 0.030, distance);
    const g = grain(x, y, z, 680), fiber = grain(x, y, z, 250);
    const fuzz = (g - 0.5) * 16 + (fiber - 0.5) * 7;
    const color = [196 + fuzz, 217 + fuzz * 0.75, 40 + fuzz * 0.5];
    const seam = [244, 241, 204];
    for (let c = 0; c < 3; c++) out[c] = color[c] * (1 - white) + seam[c] * white - groove * (1 - white) * 13;
    out[3] = 0.56 + (g - 0.5) * 0.37 + (fiber - 0.5) * 0.11 - groove * 0.26;
  }

  function basketball(x, y, z) {
    // Two great-circle channels plus a bowed equatorial channel give eight
    // curved panels, without any longitude texture join.
    const meridian = Math.min(Math.abs(x), Math.abs(y));
    const side = Math.abs(z - 0.64 * (x * x - y * y)) / Math.sqrt(1 + 1.6384 * (x * x + y * y));
    const distance = Math.min(meridian, side);
    const skin = smooth(0.016, 0.027, distance);
    const rim = smooth(0.029, 0.042, distance);
    const g = grain(x, y, z, 440);
    // A fine 3D pebble lattice, slightly irregular, reads as grippy rubber.
    const wave = Math.sin(x * 440 + Math.sin(z * 53)) *
                 Math.sin(y * 440 + Math.sin(x * 61)) *
                 Math.sin(z * 440 + Math.sin(y * 47));
    const pebble = smooth(-0.34, 0.42, wave + (g - 0.5) * 0.35);
    const variation = (pebble - 0.5) * 14 + (g - 0.5) * 6;
    const color = [221 + variation, 101 + variation * 0.7, 38 + variation * 0.36];
    const seam = [43, 35, 29];
    for (let c = 0; c < 3; c++) out[c] = seam[c] * (1 - skin) + color[c] * skin - (1 - rim) * skin * 11;
    out[3] = 0.18 + skin * (0.38 + pebble * 0.24);
  }

  const volleyColors = [[248, 202, 48], [35, 91, 171], [241, 241, 226]];
  function volleyball(x, y, z) {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let u, v, face, largest, runner;
    // Six curved regions, each subdivided into three strips: 18 sewn panels.
    if (ax >= ay && ax >= az) {
      largest = ax; runner = Math.max(ay, az);
      u = z / ax * (x > 0 ? 1 : -1); v = y / ax; face = x > 0 ? 0 : 1;
    } else if (ay >= az) {
      largest = ay; runner = Math.max(ax, az);
      u = x / ay; v = z / ay * (y > 0 ? 1 : -1); face = y > 0 ? 2 : 3;
    } else {
      largest = az; runner = Math.max(ax, ay);
      u = y / az; v = x / az * (z > 0 ? 1 : -1); face = z > 0 ? 4 : 5;
    }
    const curve = u + 0.21 * Math.sin(v * PI) * (1 - u * u);
    const stripe = curve < -1 / 3 ? 0 : curve > 1 / 3 ? 2 : 1;
    const innerDistance = Math.min(Math.abs(curve - 1 / 3), Math.abs(curve + 1 / 3)) * largest * 0.7;
    const edgeDistance = (largest - runner) / Math.SQRT2;
    const distance = Math.min(innerDistance, edgeDistance);
    const skin = smooth(0.002, 0.008, distance);
    const g = grain(x, y, z, 470);
    const color = volleyColors[(stripe + (face % 3)) % 3];
    const seam = [91, 102, 107];
    const variation = 0.982 + g * 0.037;
    for (let c = 0; c < 3; c++) out[c] = (seam[c] * (1 - skin) + color[c] * skin) * variation;
    out[3] = 0.17 + skin * 0.48 + (g - 0.5) * 0.14;
  }

  function build(name, shader, roughness, bumpScale) {
    const canvas = document.createElement('canvas');
    const bumpCanvas = document.createElement('canvas');
    canvas.width = bumpCanvas.width = W; canvas.height = bumpCanvas.height = H;
    const ctx = canvas.getContext('2d'), bumpCtx = bumpCanvas.getContext('2d');
    const pixels = ctx.createImageData(W, H), heights = bumpCtx.createImageData(W, H);
    const cosU = new Float32Array(W), sinU = new Float32Array(W);
    for (let ix = 0; ix < W; ix++) {
      const phi = TAU * (ix + 0.5) / W;
      cosU[ix] = -Math.cos(phi); sinU[ix] = Math.sin(phi);
    }
    for (let iy = 0; iy < H; iy++) {
      const theta = PI * (iy + 0.5) / H;
      const ring = Math.sin(theta), y = Math.cos(theta);
      for (let ix = 0; ix < W; ix++) {
        const x = cosU[ix] * ring, z = sinU[ix] * ring;
        shader(x, y, z);
        const i = (iy * W + ix) * 4;
        pixels.data[i] = out[0]; pixels.data[i + 1] = out[1]; pixels.data[i + 2] = out[2]; pixels.data[i + 3] = 255;
        const h = Math.round(clamp(out[3]) * 255);
        heights.data[i] = heights.data[i + 1] = heights.data[i + 2] = h; heights.data[i + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0); bumpCtx.putImageData(heights, 0, 0);
    const map = new THREE.CanvasTexture(canvas), bumpMap = new THREE.CanvasTexture(bumpCanvas);
    if (THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding) map.encoding = THREE.sRGBEncoding;
    for (const t of [map, bumpMap]) {
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 4;
    }
    const material = new THREE.MeshStandardMaterial({
      name: 'Sport / ' + name, map, bumpMap, roughness, metalness: 0,
      bumpScale, color: 0xffffff
    });
    return material;
  }

  return {
    soccer: build('soccer', soccer, 0.58, 0.008),
    tennis: build('tennis', tennis, 0.96, 0.013),
    basketball: build('basketball', basketball, 0.82, 0.014),
    volleyball: build('volleyball', volleyball, 0.49, 0.008)
  };
}
