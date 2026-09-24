/* Sphere dynamics for the deep pocket demo. Coordinates: floor z=0, lid z=depth.
   step accepts frame dt and advances a fixed 120 Hz simulation. No dependencies
   besides THREE for optional mesh rotation. All collision geometry stays spherical. */
function createBallPhysics({THREE, halfW, halfH, corner, depth, terrain=null, onImpact=null}) {
  const H=1/120, SKIN=.0025, EPS=.00002, ITER=16;
  const profiles={
    soccer:    {mass:.43, restitution:.44, friction:.38, rolling:.017, inertia:.64},
    tennis:    {mass:.24, restitution:.47, friction:.52, rolling:.027, inertia:.61},
    basketball:{mass:.62, restitution:.51, friction:.46, rolling:.020, inertia:.66},
    volleyball:{mass:.28, restitution:.42, friction:.40, rolling:.021, inertia:.64}
  };
  let accumulator=0, nextId=1, sleeping=false, quietTime=0, lastSignature='', lastGravity=null;
  let drag=null, strongestImpact=null;
  const axis=THREE?new THREE.Vector3():null, rotation=THREE?new THREE.Quaternion():null;
  function configureBall(b,type=b.type) {
    b.type=profiles[type]?type:'soccer'; const p=profiles[b.type];
    b.mass=p.mass; b.invMass=1/p.mass;
    b.invInertia=1/(p.inertia*p.mass*b.r*b.r);
    b.restitution=p.restitution; b.friction=p.friction; b.rolling=p.rolling;
    b.vx=b.vx||0; b.vy=b.vy||0; b.vz=b.vz||0;
    b.wx=b.wx||0; b.wy=b.wy||0; b.wz=b.wz||0;
    b.squash=b.squash||0;
    if(!b.squashAxis)b.squashAxis=THREE?new THREE.Vector3(0,0,1):{x:0,y:0,z:1};
    if(!b._physicsId)b._physicsId=nextId++;
    b._physicsType=b.type;
    sleeping=false; quietTime=0;
    return b;
  }
  // Minkowski inset of the rounded rectangle: centers cannot approach any
  // side closer than their radius, including the curved corner segments.
  function floorContact(b) {
    if(!terrain)return {nx:0,ny:0,nz:-1,p:b.r-b.z};
    // Closest point on a smooth height field. Damped iterations solve the two
    // tangent derivatives of squared distance, so the sphere does not sink by
    // a radius on slopes (a simple z=height+r clamp would do that).
    let x=b.x,y=b.y,s=terrain.sample(x,y);
    for(let i=0;i<12;i++){
      const dz=s.height-b.z;
      const ex=x-b.x+dz*s.dx,ey=y-b.y+dz*s.dy;
      if(Math.abs(ex)+Math.abs(ey)<1e-7)break;
      x-=ex*.55;y-=ey*.55;s=terrain.sample(x,y);
    }
    const length=Math.hypot(s.dx,s.dy,1),nx=s.dx/length,ny=s.dy/length,nz=-1/length;
    const distance=(x-b.x)*nx+(y-b.y)*ny+(s.height-b.z)*nz;
    return {nx,ny,nz,p:b.r-distance};
  }
  function wallContacts(b, visit, margin=0) {
    const hx=halfW-b.r, hy=halfH-b.r, cr=Math.max(0,corner-b.r);
    const ax=Math.abs(b.x), ay=Math.abs(b.y), sx=b.x<0?-1:1, sy=b.y<0?-1:1;
    const cx=ax-(hx-cr), cy=ay-(hy-cr);
    if(cr>0 && cx>0 && cy>0) {
      const d=Math.hypot(cx,cy), penetration=d-cr;
      if(penetration>=-margin)visit(sx*cx/d,sy*cy/d,0,penetration);
    } else {
      if(ax-hx>=-margin)visit(sx,0,0,ax-hx);
      if(ay-hy>=-margin)visit(0,sy,0,ay-hy);
    }
    const floor=floorContact(b);
    if(floor.p>=-margin)visit(floor.nx,floor.ny,floor.nz,floor.p);
    if(b.z+b.r-depth>=-margin)visit(0,0,1,b.z+b.r-depth);
  }
  function constrain(b) {
    wallContacts(b,(nx,ny,nz,p)=>{
      if(p>0){b.x-=nx*p;b.y-=ny*p;b.z-=nz*p;}
    });
    return b;
  }
  function contact(a,b,nx,ny,nz,p) {
    const c={a,b,nx,ny,nz,p,normal:0,tx:0,ty:0,tz:0,bounce:0,
      invMass:a.invMass+(b?b.invMass:0)};
    const vx=(b?b.vx:0)-a.vx,vy=(b?b.vy:0)-a.vy,vz=(b?b.vz:0)-a.vz;
    const approach=-(vx*nx+vy*ny+vz*nz);
    // Restitution only applies to meaningful impacts, never static support.
    if(approach>.70&&approach*H>=Math.max(0,-p-EPS)) {
      const e=b?Math.sqrt(a.restitution*b.restitution):a.restitution*.94;
      c.bounce=e*approach;
      const strength=Math.min(1,Math.max(0,(approach-.70)/8)*Math.sqrt(a.mass/.43));
      if(!strongestImpact||strength>strongestImpact.strength)strongestImpact={type:a.type,strength};
      const amount=Math.min(.045,(approach-.7)*.0048);
      for(const ball of b?[a,b]:[a])if(amount>ball.squash){
        ball.squash=amount;
        ball.squashAxis.x=nx;ball.squashAxis.y=ny;ball.squashAxis.z=nz;
      }
    }
    // Very near contacts may use their remaining gap before being stopped.
    c.target=c.bounce>0?c.bounce:p<0?-Math.max(0,-p-EPS)/H:0;
    c.mu=b?Math.sqrt(a.friction*b.friction)*.73:a.friction;
    c.invTangent=c.invMass+a.r*a.r*a.invInertia+(b?b.r*b.r*b.invInertia:0);
    return c;
  }
  function apply(c,jx,jy,jz) {
    const a=c.a,b=c.b,nx=c.nx,ny=c.ny,nz=c.nz;
    a.vx-=jx*a.invMass; a.vy-=jy*a.invMass; a.vz-=jz*a.invMass;
    const ac=-a.r*a.invInertia;
    a.wx+=(ny*jz-nz*jy)*ac; a.wy+=(nz*jx-nx*jz)*ac; a.wz+=(nx*jy-ny*jx)*ac;
    if(b){
      b.vx+=jx*b.invMass;b.vy+=jy*b.invMass;b.vz+=jz*b.invMass;
      const bc=-b.r*b.invInertia;
      b.wx+=(ny*jz-nz*jy)*bc;b.wy+=(nz*jx-nx*jz)*bc;b.wz+=(nx*jy-ny*jx)*bc;
    }
  }
  function solve(c) {
    const a=c.a,b=c.b,nx=c.nx,ny=c.ny,nz=c.nz;
    // rA = normal*rA; rB = -normal*rB. Sphere normal impulses exert no torque.
    let rx=(b?b.vx:0)-a.vx,ry=(b?b.vy:0)-a.vy,rz=(b?b.vz:0)-a.vz;
    const vn=rx*nx+ry*ny+rz*nz;
    const old=c.normal; c.normal=Math.max(0,old+(c.target-vn)/c.invMass);
    const j=c.normal-old;
    if(j){a.vx-=j*nx*a.invMass;a.vy-=j*ny*a.invMass;a.vz-=j*nz*a.invMass;
      if(b){b.vx+=j*nx*b.invMass;b.vy+=j*ny*b.invMass;b.vz+=j*nz*b.invMass;}}
    rx=(b?b.vx:0)-a.vx;ry=(b?b.vy:0)-a.vy;rz=(b?b.vz:0)-a.vz;
    const wx=a.wx*a.r+(b?b.wx*b.r:0),wy=a.wy*a.r+(b?b.wy*b.r:0),wz=a.wz*a.r+(b?b.wz*b.r:0);
    rx-=wy*nz-wz*ny;ry-=wz*nx-wx*nz;rz-=wx*ny-wy*nx;
    const normalV=rx*nx+ry*ny+rz*nz;
    let tx=c.tx-(rx-normalV*nx)/c.invTangent;
    let ty=c.ty-(ry-normalV*ny)/c.invTangent;
    let tz=c.tz-(rz-normalV*nz)/c.invTangent;
    const size=Math.hypot(tx,ty,tz),limit=c.mu*c.normal;
    if(size>limit&&size>0){const f=limit/size;tx*=f;ty*=f;tz*=f;}
    apply(c,tx-c.tx,ty-c.ty,tz-c.tz);c.tx=tx;c.ty=ty;c.tz=tz;
  }
  function rollingResistance(c) {
    if(c.normal<=0)return;
    const a=c.a,b=c.b,nx=c.nx,ny=c.ny,nz=c.nz;
    // Contact-patch torque models tiny material losses, rather than damping
    // all translational velocity. Sliding is handled by Coulomb friction above.
    const rx=a.wx-(b?b.wx:0),ry=a.wy-(b?b.wy:0),rz=a.wz-(b?b.wz:0);
    const spin=rx*nx+ry*ny+rz*nz;
    const tx=rx-spin*nx,ty=ry-spin*ny,tz=rz-spin*nz,len=Math.hypot(tx,ty,tz);
    const invI=a.invInertia+(b?b.invInertia:0);
    const radius=b?Math.min(a.r,b.r):a.r;
    const mu=b?Math.min(a.rolling,b.rolling)*.45:a.rolling;
    const maxTorque=mu*c.normal*radius;
    const scale=len>1e-8?Math.min(len/invI,maxTorque)/len:0;
    const twist=Math.sign(spin)*Math.min(Math.abs(spin)/invI,maxTorque*.30);
    const jx=tx*scale+nx*twist,jy=ty*scale+ny*twist,jz=tz*scale+nz*twist;
    a.wx-=jx*a.invInertia;a.wy-=jy*a.invInertia;a.wz-=jz*a.invInertia;
    if(b){b.wx+=jx*b.invInertia;b.wy+=jy*b.invInertia;b.wz+=jz*b.invInertia;}
  }
  function substep(balls,g) {
    const contacts=[];
    for(const b of balls){
      b.squash*=Math.exp(-H*15);
      b.vx+=g.x*H;b.vy+=g.y*H;b.vz+=g.z*H;
      if(drag&&drag.ball===b){
        // A finite, damped spring applies at the center. It cannot teleport a
        // ball or move through a wall/another ball. Release retains velocity.
        let ax=(drag.x-b.x)*180-b.vx*22,ay=(drag.y-b.y)*180-b.vy*22;
        const a=Math.hypot(ax,ay),limit=90;
        if(a>limit){ax*=limit/a;ay*=limit/a;}
        b.vx+=ax*H;b.vy+=ay*H;
      }
      b.x+=b.vx*H;b.y+=b.vy*H;b.z+=b.vz*H;
      wallContacts(b,(nx,ny,nz,p)=>contacts.push(contact(b,null,nx,ny,nz,p)),SKIN);
    }
    for(let i=0;i<balls.length;i++)for(let j=i+1;j<balls.length;j++){
      const a=balls[i],b=balls[j],dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,rr=a.r+b.r;
      const ds=dx*dx+dy*dy+dz*dz;
      if(ds>(rr+SKIN)**2)continue;
      if(ds<1e-14){contacts.push(contact(a,b,1,0,0,rr));continue;}
      const d=Math.sqrt(ds);contacts.push(contact(a,b,dx/d,dy/d,dz/d,rr-d));
    }
    for(let k=0;k<ITER;k++)for(const c of contacts)solve(c);
    for(const c of contacts)rollingResistance(c);
    // Separate position correction cannot create bouncing energy.
    for(let k=0;k<12;k++){
      for(let i=0;i<balls.length;i++)for(let j=i+1;j<balls.length;j++){
        const a=balls[i],b=balls[j],dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,rr=a.r+b.r;
        const ds=dx*dx+dy*dy+dz*dz;if(ds>=(rr-EPS)**2)continue;
        const d=Math.sqrt(ds),inv=1/(d||1),nx=d?dx*inv:1,ny=d?dy*inv:0,nz=d?dz*inv:0;
        const move=Math.min(.2,Math.max(0,rr-d-EPS)*.8)/(a.invMass+b.invMass);
        const ma=move*a.invMass,mb=move*b.invMass;
        a.x-=nx*ma;a.y-=ny*ma;a.z-=nz*ma;b.x+=nx*mb;b.y+=ny*mb;b.z+=nz*mb;
      }
      for(const b of balls)constrain(b);
    }
    let quiet=true;
    for(const b of balls){
      const speed=Math.hypot(b.vx,b.vy,b.vz),omega=Math.hypot(b.wx,b.wy,b.wz);
      if(speed>.035||omega>.075)quiet=false;
      if(rotation&&b.mesh&&omega>1e-8){axis.set(b.wx/omega,b.wy/omega,b.wz/omega);rotation.setFromAxisAngle(axis,omega*H);b.mesh.quaternion.premultiply(rotation);}
    }
    quietTime=quiet&&!drag?quietTime+H:0;
    if(quietTime>.8){sleeping=true;for(const b of balls)b.vx=b.vy=b.vz=b.wx=b.wy=b.wz=0;}
  }
  function step(balls,gravity,dt) {
    if(!(dt>0))return;
    const g={x:Number(gravity.x??gravity[0]??0),y:Number(gravity.y??gravity[1]??0),z:Number(gravity.z??gravity[2]??-18)};
    if(!Number.isFinite(g.x+g.y+g.z))return;
    for(const b of balls)if(!b._physicsId||b._physicsType!==b.type)configureBall(b);
    const signature=balls.map(b=>b._physicsId+':'+b.type).join(',');
    const changed=!lastGravity||Math.hypot(g.x-lastGravity.x,g.y-lastGravity.y,g.z-lastGravity.z)>.004;
    if(changed||signature!==lastSignature||drag||(sleeping&&balls.some(b=>b.vx||b.vy||b.vz||b.wx||b.wy||b.wz))){sleeping=false;quietTime=0;lastGravity={...g};lastSignature=signature;}
    if(sleeping){for(const b of balls)b.squash*=Math.exp(-Math.min(dt,.1)*15);accumulator=0;return;}
    accumulator+=Math.min(dt,.1);
    strongestImpact=null;
    while(accumulator+1e-10>=H){substep(balls,g);accumulator-=H;}
    if(strongestImpact&&onImpact)onImpact(strongestImpact.type,strongestImpact.strength);
  }
  function setDrag(ball,x,y){
    if(!ball||!Number.isFinite(x+y)){drag=null;return;}
    drag={ball,x:Math.max(-halfW+ball.r,Math.min(halfW-ball.r,x)),y:Math.max(-halfH+ball.r,Math.min(halfH-ball.r,y))};
    sleeping=false;quietTime=0;
  }
  return {step,configureBall,constrain,setDrag,releaseDrag(){drag=null;},wake(){sleeping=false;quietTime=0;},floorContact,
    getState:()=>({sleeping,quietTime,dragging:!!drag})};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createBallPhysics;
