/* A rimless, rounded pocket viewed through its top opening.
 * Floor z = 0; opening z = depth. No transparent AO cards or coplanar liners.
 */
function buildPocketInterior(THREE, { width, height, corner, depth, terrain=null }) {
  const group = new THREE.Group();
  group.name = 'PocketInteriorV4';
  const halfW = width / 2, halfH = height / 2;
  const fillet = Math.min(0.27, corner * 0.32, width * 0.035, depth * 0.12);
  const floorW = width - fillet * 2, floorH = height - fillet * 2;
  const floorR = Math.max(0.025, corner - fillet);
  const curveSegments = 28;

  // The same perimeter sampling is used at every height, including the floor.
  // Straight sections interpolate between consecutive quarter-circle endpoints.
  function ring(inset) {
    const r = corner - inset, hw = halfW - inset, hh = halfH - inset;
    const out = [];
    for (let quadrant = 0; quadrant < 4; quadrant++) {
      const cx = quadrant === 0 || quadrant === 3 ? hw - r : -hw + r;
      const cy = quadrant < 2 ? hh - r : -hh + r;
      for (let i = 0; i <= curveSegments; i++) {
        const a = (quadrant + i / curveSegments) * Math.PI / 2;
        out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
          nx: Math.cos(a), ny: Math.sin(a) });
      }
    }
    return out;
  }
  const floorRing = ring(fillet), n = floorRing.length;

  // A finite rounded floor, not an oversized plane visible outside the pocket.
  const floorPositions = [], floorNormals = [], floorUV = [], floorColors=[];
  const floorIndices = [];
  if(terrain){
    // A rounded grid samples the same analytic floor used by contacts. The
    // 0.13-unit spacing gives each broad, shallow well a smooth silhouette.
    const cols=Math.min(180,Math.max(24,Math.ceil(floorW/.13)));
    const rows=Math.min(220,Math.max(24,Math.ceil(floorH/.13)));
    for(let row=0;row<=rows;row++){
      const y=(row/rows-.5)*floorH;
      const dy=Math.max(0,Math.abs(y)-(floorH/2-floorR));
      const extent=floorW/2-floorR+Math.sqrt(Math.max(0,floorR*floorR-dy*dy));
      for(let col=0;col<=cols;col++){
        const x=(col/cols*2-1)*extent,s=terrain.sample(x,y),len=Math.hypot(s.dx,s.dy,1);
        floorPositions.push(x,y,s.height);floorNormals.push(-s.dx/len,-s.dy/len,1/len);
        // Broad recess AO makes the concavity legible even with the phone held
        // nearly face-on. It lives on the actual curved surface, not a decal.
        const recess=Math.sqrt(Math.max(0,-s.height)/(terrain.wells[0].depth||1));
        const shade=1-recess*.32;floorColors.push(shade,shade,shade);
        floorUV.push(x/floorW+.5,y/floorH+.5);
        if(row<rows&&col<cols){const i=row*(cols+1)+col;floorIndices.push(i,i+1,i+cols+1,i+1,i+cols+2,i+cols+1);}
      }
    }
  }else{
    floorPositions.push(0,0,0);floorNormals.push(0,0,1);floorUV.push(.5,.5);
    floorRing.forEach(p => {
      floorPositions.push(p.x, p.y, 0); floorNormals.push(0, 0, 1);
      floorUV.push(p.x / floorW + .5, p.y / floorH + .5);
    });
    for (let i = 0; i < n; i++) floorIndices.push(0, 1 + i, 1 + (i + 1) % n);
  }
  const floorGeometry = new THREE.BufferGeometry();
  floorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(floorPositions, 3));
  floorGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(floorNormals, 3));
  floorGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(floorUV, 2));
  if(terrain)floorGeometry.setAttribute('color',new THREE.Float32BufferAttribute(floorColors,3));
  floorGeometry.setIndex(floorIndices);

  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 512;
  floorCanvas.height = Math.round(512 * floorH / floorW);
  const ctx = floorCanvas.getContext('2d', { alpha: false });
  const floorMap = new THREE.CanvasTexture(floorCanvas);
  floorMap.colorSpace = THREE.SRGBColorSpace;
  floorMap.anisotropy = 4;
  floorMap.wrapS = floorMap.wrapT = THREE.ClampToEdgeWrapping;
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: floorMap, roughness: .91, metalness: 0,vertexColors:!!terrain
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.name = 'PocketFloor'; floor.receiveShadow = true; group.add(floor);

  // A continuous quarter-round wall foot flows into the vertical inner wall.
  // Ending the surface at the opening is deliberate: there is NO top cap/rim.
  const profiles = [];
  for (let j = 0; j <= 14; j++) {
    const a = j / 14 * Math.PI / 2;
    profiles.push({ inset: fillet * (1 - Math.sin(a)),
      z: fillet * (1 - Math.cos(a)), sin: Math.sin(a), cos: Math.cos(a) });
  }
  for (const z of [.42, .68, 1.05, depth * .43, depth * .7, depth]) {
    if (z > profiles[profiles.length - 1].z + .001 && z <= depth)
      profiles.push({ inset: 0, z, sin: 1, cos: 0 });
  }
  if (profiles[profiles.length - 1].z < depth)
    profiles.push({ inset: 0, z: depth, sin: 1, cos: 0 });
  const positions = [], normals = [], colors = [], indices = [], wallSamples = [];
  profiles.forEach(profile => {
    ring(profile.inset).forEach(p => {
      positions.push(p.x, p.y, profile.z);
      normals.push(-p.nx * profile.sin, -p.ny * profile.sin, profile.cos);
      colors.push(1, 1, 1);
      wallSamples.push({ z: profile.z, x: p.x, y: p.y, nx: p.nx, ny: p.ny });
    });
  });
  for (let j = 0; j < profiles.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * n + i, b = j * n + (i + 1) % n;
      const c = a + n, d = b + n;
      indices.push(a, c, b, b, c, d); // normals point INTO the pocket
    }
  }
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  wallGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  wallGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  wallGeometry.setIndex(indices);
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: .88, metalness: 0,
    side: THREE.FrontSide
  });
  const walls = new THREE.Mesh(wallGeometry, wallMaterial);
  walls.name = 'PocketInnerWalls'; walls.receiveShadow = true;
  // The baked wall-foot AO is smooth and stable; vertical walls should not cast
  // hard directional shadow bands across the entire floor.
  walls.castShadow = false;
  group.add(walls);

  function distanceInsideRoundedRect(x, y) {
    const qx = Math.abs(x) - (floorW / 2 - floorR);
    const qy = Math.abs(y) - (floorH / 2 - floorR);
    return floorR - (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0));
  }
  function hash(x, y) {
    let h = Math.imul(x + 937, 374761393) ^ Math.imul(y + 251, 668265263);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967295;
  }
  function setTheme(dark) {
    // These are surface colors, not emissive colors; the scene lighting remains
    // responsible for highlights and moving ball shadows.
    const base = dark ? [53, 65, 72] : [210, 204, 193];
    const image = ctx.createImageData(floorCanvas.width, floorCanvas.height);
    const data = image.data, cw = floorCanvas.width, ch = floorCanvas.height;
    for (let py = 0; py < ch; py++) {
      const y = (py / (ch - 1) - .5) * floorH;
      for (let px = 0; px < cw; px++) {
        const x = (px / (cw - 1) - .5) * floorW;
        const d = Math.max(0, distanceInsideRoundedRect(x, y));
        // AO is baked into the opaque floor itself, with a broad soft falloff.
        const edgeAO = .21 * Math.exp(-d / .105) + .105 * Math.exp(-d / .72);
        // A hairline recessed into the floor is a parallax landmark, not a rim.
        const line = .036 * Math.exp(-Math.pow((d - .47) / .012, 2));
        const lineLight = .012 * Math.exp(-Math.pow((d - .485) / .011, 2));
        const grain = (hash(px, py) - .5) * (dark ? 1.0 : 1.35);
        const fine = Math.sin(y * 148 + Math.sin(x * 39) * .3) * .20;
        const lightGradient = .012 * (y / floorH - x / floorW);
        const shade = 1 - edgeAO - line + lineLight + lightGradient;
        const k = (py * cw + px) * 4;
        data[k] = Math.max(0, Math.min(255, base[0] * shade + grain + fine));
        data[k + 1] = Math.max(0, Math.min(255, base[1] * shade + grain + fine));
        data[k + 2] = Math.max(0, Math.min(255, base[2] * shade + grain + fine));
        data[k + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0); floorMap.needsUpdate = true;
    const footColor = new THREE.Color(dark ? 0x354148 : 0xd2ccc1);
    const wallColor = new THREE.Color(dark ? 0x45565f : 0xe4e0d6);
    const c = new THREE.Color(), attr = wallGeometry.getAttribute('color');
    wallSamples.forEach((p, i) => {
      const blend = 1 - Math.exp(-p.z / .38);
      c.copy(footColor).lerp(wallColor, blend);
      // Avoid a bright upper ring: only the foot receives depth-dependent AO.
      const ao = 1 - .26 * Math.exp(-p.z / .30) - .055 * Math.exp(-p.z / 1.0);
      const side = 1 + (.017 * p.nx - .015 * p.ny) * blend;
      // Canvas AO is encoded in sRGB; convert its factor for linear vertex color.
      c.multiplyScalar(Math.pow(ao * side, 2.2));
      attr.setXYZ(i, c.r, c.g, c.b);
    });
    attr.needsUpdate = true;
  }
  setTheme(false);
  group.userData = { floorZ: 0, lidZ: depth, fillet, width, height, corner, terrain:!!terrain };
  return { group, setTheme, floor, walls,
    materials: { floor: floorMaterial, wall: wallMaterial },
    dispose() {
      floorGeometry.dispose(); wallGeometry.dispose(); floorMap.dispose();
      floorMaterial.dispose(); wallMaterial.dispose();
    }
  };
}
