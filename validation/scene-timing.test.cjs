/* Tests actual production input/timing functions with the actual sphere solver.
   These exercise simulation timing; they do not claim physical-device latency. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assetDir=path.join(__dirname,'../app/src/main/assets');
const source=fs.readFileSync(path.join(assetDir,'android-scene.js'),'utf8');
const helpers=vm.runInNewContext(source.slice(0,source.indexOf('(() => {'))+'\n({createPocketFrameClock,pocketGravityInput,advancePocketPhysics})');
const createBallPhysics=require(path.join(assetDir,'ball-physics-v2.js'));
const {createPocketFrameClock,pocketGravityInput,advancePocketPhysics}=helpers;
// The actual native bridge is exercised in scene-browser.test.cjs. Test the
// pure input contract here without matching its formatting or parameter list.
assert.equal(pocketGravityInput(9.81,0,0).x,9.81*1.63);
assert.equal(pocketGravityInput(-9.81,0,0).x,-9.81*1.63);
assert.equal(pocketGravityInput(NaN,0,0),null,'invalid input cannot poison simulation');
assert.equal(pocketGravityInput(0,0,0),null,'a missing gravity vector is rejected');
assert.equal(pocketGravityInput(100,0,0),null,'corrupt large input is rejected');
assert.equal(pocketGravityInput(0,0,-9.81).z,-9.81*1.63);
assert.equal(pocketGravityInput(0,0,9.81).z,9.81*1.63);
const g=pocketGravityInput(8,0,-5.66);
function simulate(fps){
  const clock=createPocketFrameClock(),physics=createBallPhysics({halfW:40,halfH:40,corner:1,depth:4.1});
  const ball={x:0,y:0,z:.35,r:.35,type:'soccer',vx:0,vy:0,vz:0};physics.configureBall(ball);
  let renderCount=0,firstRenderedTime=0,firstMovement=0,onePixelMovement=0,total=0;clock.tick(0);
  for(let i=1;i<=fps;i++){
    const now=i*1000/fps,t=clock.tick(now);total+=t.elapsed;advancePocketPhysics(physics,[ball],g,t.elapsed);
    if(t.render){renderCount++;if(!firstRenderedTime)firstRenderedTime=now;if(!firstMovement&&ball.x>0)firstMovement=now;if(!onePixelMovement&&ball.x>=9/390)onePixelMovement=now;}
  }
  assert(Math.abs(total-1)<1e-10,'one real second must simulate one second');
  assert(renderCount<=60,'GPU render count capped at60 across high-refresh displays');
  assert.equal(firstMovement,firstRenderedTime,'input moves the ball on the next rendered frame');
  assert(onePixelMovement<=140,'strong tilt clears1 CSSpixel by140ms at15fps or higher in this fixture');
  return {fps,renders:renderCount,x:ball.x,vx:ball.vx,firstMovementMs:firstMovement,oneCssPixelMs:onePixelMovement};
}
const runs=[15,30,60,120,144].map(simulate);
for(const r of runs){assert(Math.abs(r.x-runs[0].x)<1e-9,'trajectory independent of draw frequency');assert(Math.abs(r.vx-runs[0].vx)<1e-9);}
const directions=[];
for(const [axis,sign] of [['x',1],['x',-1],['y',1],['y',-1]]){
  const physics=createBallPhysics({halfW:40,halfH:40,corner:1,depth:4.1});
  const ball={x:0,y:0,z:.35,r:.35,type:'tennis',vx:0,vy:0,vz:0};physics.configureBall(ball);
  const flat=pocketGravityInput(0,0,-9.81);
  for(let i=0;i<180;i++)physics.step([ball],flat,1/120);
  assert(physics.getState().sleeping,'fixture starts with a settled sleeping ball');
  const input={x:0,y:0,z:-8.5};input[axis]=sign*4.9;
  const tilted=pocketGravityInput(input.x,input.y,input.z);
  physics.step([ball],tilted,1/120);
  assert(ball[axis]*sign>0,'sleeping ball moves toward lower edge on the next physics step');
  assert(!physics.getState().sleeping,'changed gravity immediately wakes sleeping physics');
  directions.push({axis,sign,firstStepPosition:ball[axis]});
}
const slow=createPocketFrameClock();slow.tick(0);let calls=[];
advancePocketPhysics({step(_balls,_g,dt){calls.push(dt);}},[],g,slow.tick(200).elapsed);
assert.equal(calls.length,4);assert(Math.abs(calls.reduce((s,x)=>s+x,0)-.2)<1e-10);
const stall=createPocketFrameClock();stall.tick(0);assert.equal(stall.tick(5000).elapsed,.2,'longforeground stall has bounded recovery');stall.reset();assert.equal(stall.tick(10000).elapsed,0,'resume cannot accumulate background elapsed time');
const diagnostics=createPocketFrameClock();assert.equal(diagnostics.tick(0).rawElapsed,0);
const blockedFrame=diagnostics.tick(2000);
assert.equal(blockedFrame.rawElapsed,2,'diagnostics retain a real two-second blocked frame');
assert.equal(blockedFrame.elapsed,.2,'physics still bounds recovery after a blocked frame');
assert.equal(blockedFrame.renderElapsed,2,'quality adaptation sees the full blocked frame');
console.log(JSON.stringify({passed:true,runs,directions},null,2));
