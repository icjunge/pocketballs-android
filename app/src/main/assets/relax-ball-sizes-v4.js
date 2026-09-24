/* Remove overlaps after all radii/types have been updated. This is positional
   relaxation only: velocities, angular velocities and simulation time remain
   untouched, including while the demo is paused. */
function settleResizedBalls(balls, dynamics) {
  const SLOP = .00002, TOLERANCE = .0005, MAX_ITERATIONS = 512;
  const count = balls.length;
  function maximumOverlap() {
    let maximum = 0;
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const a = balls[i], b = balls[j];
      maximum = Math.max(maximum, a.r + b.r - Math.hypot(b.x-a.x, b.y-a.y, b.z-a.z));
    }
    return maximum;
  }
  for (const ball of balls) dynamics.constrain(ball);
  let overlap = maximumOverlap(), iterations = 0;
  while (overlap > TOLERANCE && iterations < MAX_ITERATIONS) {
    for (let pass = 0; pass < 8 && iterations < MAX_ITERATIONS; pass++, iterations++) {
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
        const a = balls[i], b = balls[j];
        const dx = b.x-a.x, dy = b.y-a.y, dz = b.z-a.z;
        const radius = a.r+b.r, distance = Math.hypot(dx,dy,dz);
        if (distance >= radius-SLOP) continue;
        const reciprocal = distance > 1e-10 ? 1/distance : 0;
        const nx = reciprocal ? dx*reciprocal : 1;
        const ny = reciprocal ? dy*reciprocal : 0;
        const nz = reciprocal ? dz*reciprocal : 0;
        const inverseA = a.invMass, inverseB = b.invMass;
        const correction = Math.min(.2, (radius-distance-SLOP)*.8)/(inverseA+inverseB);
        a.x -= nx*correction*inverseA;
        a.y -= ny*correction*inverseA;
        a.z -= nz*correction*inverseA;
        b.x += nx*correction*inverseB;
        b.y += ny*correction*inverseB;
        b.z += nz*correction*inverseB;
      }
      // Every sweep reprojects against the floor, lid and rounded walls.
      for (const ball of balls) dynamics.constrain(ball);
    }
    overlap = maximumOverlap();
  }
  return {iterations, maxOverlap:overlap, converged:overlap <= TOLERANCE};
}
if (typeof module !== 'undefined' && module.exports) module.exports = settleResizedBalls;
