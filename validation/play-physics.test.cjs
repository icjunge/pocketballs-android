/* Production-solver checks. These measure simulation behavior, not real phone
 * sensor latency or subjective haptics. Browser input is covered separately. */
const assert=require('node:assert/strict');
const physics=require('../app/src/main/assets/ball-physics-v2.js');
const {createPocketTray}=require('../app/src/main/assets/play-modes.js');
const opts={halfW:4.5,halfH:9.75,corner:1.02,depth:4.1};
let checks=0;
function ok(value,message){assert(value,message);checks++;}
function advance(d,balls,g,seconds){for(let t=0;t<Math.round(seconds*120);t++)d.step(balls,g,1/120);}
function ball(d,extra={}){const b={type:'tennis',x:0,y:0,z:.4,r:.4,...extra};d.configureBall(b);return b;}
const down={x:0,y:0,z:-16};

// All real sports-ball profiles respond on the first substep after sleep.
for(const type of ['soccer','tennis','basketball','volleyball']){
  const d=physics(opts),b=ball(d,{type});advance(d,[b],down,2);
  ok(d.getState().sleeping,`${type} reaches a stable rest`);
  d.step([b],{x:8,y:0,z:-13.86},1/120);
  ok(b.x>0&&b.vx>0,`${type} immediately wakes and rolls toward lower right edge`);
  const vx=b.vx;d.step([b],{x:-8,y:0,z:-13.86},1/120);
  ok(b.vx<vx,`${type} immediately accelerates in the reversed direction`);
}
{
  const d=physics(opts),b=ball(d);advance(d,[b],down,2);b.z+=.03;d.wake();d.step([b],down,1/120);
  ok(b.vz<0,'reset explicitly wakes sleeping balls even with unchanged gravity');
}

// An input force is bounded and resolves against colliders. Releasing removes
// the hand constraint, rather than resetting velocity or pinning the ball.
{
  const d=physics(opts),b=ball(d);d.setDrag(b,100,0);d.step([b],down,1/120);
  ok(b.x>0&&b.x<.01,'drag starts with acceleration, never a position jump');
  advance(d,[b],down,2);
  ok(b.x<=opts.halfW-b.r+1e-5,'drag cannot pull a sphere through the wall');
  d.setDrag(b,-2,0);advance(d,[b],down,.35);const vx=b.vx;
  ok(vx<-.3,'drag develops real momentum');d.releaseDrag();
  ok(b.vx===vx,'release preserves accumulated velocity');
  const before=b.x;advance(d,[b],down,.1);ok(b.x<before,'released sphere continues to roll');
}
{
  const d=physics(opts),a=ball(d,{x:-1}),b=ball(d,{x:0});d.setDrag(a,2,0);
  for(let i=0;i<120;i++){
    d.step([a,b],down,1/120);
    assert(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)>=a.r+b.r-.001,'dragged balls must not overlap');
  }
  checks++;ok(b.x>.2,'a dragged sphere physically pushes another sphere');
}

// Use both portrait and landscape trays. The same sample function is passed
// to rendering and contact geometry; its edge is continuous in height/slope.
for(const [width,height] of [[9,19.5],[19.5,9],[16.8,15.1]]){
  const terrain=createPocketTray(width,height);
  for(const w of terrain.wells){
    const edge=terrain.sample(w.x+w.radius,w.y),center=terrain.sample(w.x,w.y);
    ok(Math.abs(edge.height)+Math.abs(edge.dx)+Math.abs(edge.dy)<1e-8,'well joins flat floor smoothly');
    ok(Math.abs(center.height+w.depth)<1e-8,'render and physics share exact well depth');
  }
  const d=physics({...opts,halfW:width/2,halfH:height/2,terrain}),w=terrain.wells[0];
  const b=ball(d,{x:w.x+w.radius*.35,y:w.y,z:.4});advance(d,[b],down,10);
  ok(Math.hypot(b.x-w.x,b.y-w.y)<w.radius*.10,'gravity and sloped contacts settle the ball into the well');
  ok(Math.abs(b.z-(b.r-w.depth))<.015,'ball rests at the visible recessed floor');
  ok(Math.abs(d.floorContact(b).p)<1e-5,'sphere floor penetration remains negligible');
  const escapeDirection=width>=height?1:-1;
  advance(d,[b],{x:escapeDirection*10,y:0,z:-12.5},1.4);
  ok(Math.hypot(b.x-w.x,b.y-w.y)>w.radius,'tilt releases ball without a lock or artificial attraction');
}

// Stationary support should remain silent; meaningful approach produces one
// aggregated callback per step rather than one callback per solver iteration.
{
  const events=[],d=physics({...opts,onImpact:(type,strength)=>events.push({type,strength})}),b=ball(d);
  advance(d,[b],down,3);ok(events.length===0,'resting floor contact emits no impacts');
  b.x=3.95;b.vx=6;d.step([b],down,.1);
  ok(events.length===1,'wall impact is aggregated once per physics call');
  ok(events[0].strength>0&&events[0].strength<=1,'impact strength is normalized');
  advance(d,[b],down,8);const count=events.length;advance(d,[b],down,2);
  ok(events.length===count,'settled contacts do not spam feedback');
}
console.log(JSON.stringify({passed:true,checks},null,2));
