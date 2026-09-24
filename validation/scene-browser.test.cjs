/* Integration checks execute the shipped HTML, native bridge and physics.
   Browser wall-clock measurements do not establish real-device sensor latency. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=path.join(__dirname,'../build/validation');
const entry=pathToFileURL(path.join(__dirname,'../app/src/main/assets/index.html')).href;
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:360,height:840},deviceScaleFactor:2});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.calls=[];window.feedbackCalls=[];window.feedbackStates=[];window.sample=null;window.motionPulls=0;
   window.AndroidPocket={
    loadState(){return sessionStorage.getItem('pocket-test-state')||'{}';},
    saveState(s){window.saved=s;sessionStorage.setItem('pocket-test-state',s);},
    versionName(){return '0.2.0';},
    ready(){PocketNative.onSensorStatus({available:true,active:true,type:'game_rotation_vector'});PocketNative.onGravity(0,-6,-7.75,2,3);},
    motionSample(){window.motionPulls++;return window.sample;},
    checkForUpdates(){calls.push('check');},downloadUpdate(){calls.push('download');},installUpdate(){calls.push('install');},
    playFeedback(...args){window.feedbackCalls.push(args);},
    setFeedbackState(...args){window.feedbackStates.push(args);}
   };
  });
  const state=()=>page.evaluate(()=>document.getElementById('pocket-android').__idleTest.getState());
  const stop=()=>page.evaluate(()=>{PocketNative.onVisibility(false);document.getElementById('pocket-android').__idleTest.setPaused(true);});
  const load=async()=>{await page.goto(entry);await page.waitForFunction(()=>document.getElementById('pocket-android').__idleTest);await stop();};
  const root=page.locator('#pocket-android');
  const openMenu=async()=>{if(await root.locator('.ib-panel').isHidden())await root.locator('.ib-menu').click();};
  const closeMenu=()=>page.evaluate(()=>PocketNative.closeMenu());
  const screenshot=async name=>{
   await page.evaluate(()=>{document.getElementById('pocket-android').__idleTest.setPaused(true);PocketNative.onVisibility(true);});
   await page.waitForTimeout(300);
   await page.screenshot({path:path.join(output,name+'.png')});
   await page.evaluate(()=>PocketNative.onVisibility(false));
  };
  await load();
  assert.equal((await state()).mode,'relax');assert.equal((await state()).sensitivity,1.35);
  assert.equal((await state()).count,16);assert.deepEqual((await state()).feedback,{sound:false,haptics:true});
  assert(await root.locator('.ib-panel').isHidden(),'normal presentation is fullscreen');
  await screenshot('cover-fullscreen');
  await openMenu();

  // Existing Android install flow remains explicit; discovery never downloads.
  await page.evaluate(()=>PocketNative.onUpdateStatus({state:'available',versionName:'0.2.1',installedVersionName:'0.2.0'}));
  assert(await root.locator('.ib-menu').evaluate(el=>el.classList.contains('ib-update-available')));
  assert.equal(await root.locator('.ib-update-button').textContent(),'下载更新');
  assert.deepEqual(await page.evaluate(()=>calls),[]);
  await root.locator('.ib-update-button').click();assert.deepEqual(await page.evaluate(()=>calls),['download']);
  await page.evaluate(()=>PocketNative.onUpdateStatus({state:'downloading',progress:42,message:'正在下载'}));
  assert(await root.locator('.ib-update-button').isDisabled());assert.equal(await root.locator('progress').evaluate(el=>el.value),42);
  await page.evaluate(()=>PocketNative.onUpdateStatus({state:'ready',busy:true}));assert(await root.locator('.ib-update-button').isDisabled());
  await page.evaluate(()=>PocketNative.onUpdateStatus({state:'ready',busy:false}));await root.locator('.ib-update-button').click();
  await page.evaluate(()=>PocketNative.onUpdateStatus({state:'permission'}));assert.equal(await root.locator('.ib-update-button').textContent(),'允许安装后继续');await root.locator('.ib-update-button').click();
  await page.evaluate(()=>PocketNative.onUpdateStatus({state:'error',message:'连接失败'}));await root.locator('.ib-update-button').click();
  await page.evaluate(()=>PocketNative.onUpdateStatus({state:'checking'}));assert(await root.locator('.ib-update-button').isDisabled());
  await page.evaluate(()=>PocketNative.onUpdateStatus({state:'latest'}));assert.equal(await root.locator('.ib-update-message').textContent(),'已是最新版本');
  assert.deepEqual(await page.evaluate(()=>calls),['download','install','install','check']);
  const androidUpdateCalls=await page.evaluate(()=>calls);
  await page.evaluate(()=>PocketNative.onUpdateStatus({state:'available',versionName:'0.2.1',actionLabel:'查看更新',message:'前往 TestFlight 查看新版本'}));
  assert.equal(await root.locator('.ib-update-button').textContent(),'查看更新','iOS supplies its native action rather than APK copy');
  assert(!/APK|允许安装|下载完成/.test(await root.locator('.ib-update').innerText()));

  // Inputs are read synchronously, even with the menu open and animation paused.
  const motion=[];
  for(const [x,y] of [[9.81,0],[-9.81,0],[0,9.81],[0,-9.81]]){
   const s=await page.evaluate(([x,y])=>{PocketNative.onGravity(x,y,0,4,7);return document.getElementById('pocket-android').__idleTest.getState();},[x,y]);
   assert.equal(s.gravity.x,x*1.63);assert.equal(s.gravity.y,y*1.63);
   assert.equal(s.motion.sensorAgeMs,4);assert.equal(s.motion.bridgeRoundTripMs,7);
   assert(s.menuOpen&&s.paused);motion.push(s.gravity);
  }
  const previous=(await state()).gravity;
  await page.evaluate(()=>PocketNative.onGravity(NaN,0,0));assert.deepEqual((await state()).gravity,previous);
  const pulled=await page.evaluate(()=>{
   window.sample=JSON.stringify({x:3,y:-4,z:-8.45,ageMs:1.5,sequence:19});
   document.getElementById('pocket-android').__idleTest.pullMotionSample();
   window.sample=null;return document.getElementById('pocket-android').__idleTest.getState();
  });
  assert.equal(pulled.gravity.x,3*1.63);assert.equal(pulled.gravity.y,-4*1.63);assert.equal(pulled.motion.sensorSequence,19);assert.equal(pulled.motion.sensorAgeMs,1.5);
  await root.locator('[data-sensitivity="1.7"]').click();
  const sensitive=await state();assert.equal(sensitive.sensitivity,1.7);assert.equal(sensitive.simulationGravity.x,sensitive.gravity.x*1.7);assert.equal(sensitive.simulationGravity.z,sensitive.gravity.z);
  await root.locator('[data-mode="touch"]').click();assert.equal((await state()).mode,'touch');assert.equal((await state()).count,16);
  await root.locator('[data-type="basketball"]').click();await root.locator('.ib-more').click();assert.equal((await state()).count,17);
  await root.locator('.ib-sound').locator('..').click();await root.locator('.ib-haptics').locator('..').click();
  assert.deepEqual((await state()).feedback,{sound:true,haptics:false});
  await page.evaluate(()=>PocketNative.onSaveRequested());
  let saved=JSON.parse(await page.evaluate(()=>window.saved));assert.equal(saved.schema,1);assert.equal(saved.balls.length,17);assert.equal(saved.mode,'touch');assert.equal(saved.sensitivity,1.7);
  await load();
  assert.equal((await state()).mode,'touch');assert.equal((await state()).count,17);assert.equal((await state()).selected,'basketball');assert.equal((await state()).sensitivity,1.7);assert.deepEqual((await state()).feedback,{sound:true,haptics:false});

  // Fold, rotation and split windows preserve ball count and canonical size.
  const originalRadius=(await state()).radius,viewports=[{width:728,height:656},{width:840,height:360},{width:320,height:400},{width:360,height:840}];
  for(const viewport of viewports){
   await page.setViewportSize(viewport);await page.waitForFunction(width=>Math.abs(document.getElementById('pocket-android').__idleTest.getState().bounds.width-width*9/390)<1e-9,viewport.width);const s=await state();
   assert.equal(s.count,17);assert.equal(s.radius,originalRadius);assert.equal(s.mode,'touch');
   assert(Math.abs(s.bounds.width-viewport.width*9/390)<1e-9);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
   assert(await page.evaluate(()=>{const t=document.getElementById('pocket-android').__idleTest,s=t.getState();return t.balls.every(b=>Number.isFinite(b.x+b.y+b.z)&&Math.abs(b.x)+b.r<=s.bounds.width/2+.001&&Math.abs(b.y)+b.r<=s.bounds.height/2+.001);}));
   if(viewport.width===728)await screenshot('fold-fullscreen');
  }

  // Pointer handling must apply finite forces, preserve release momentum, and
  // release the constraint for every lifecycle route that can interrupt a drag.
  await closeMenu();
  const placeBall=()=>page.evaluate(()=>{
   const t=document.getElementById('pocket-android').__idleTest;t.setPaused(false);t.setGravity(0,0,-16);
   const b=t.balls[0];Object.assign(b,{x:0,y:1,z:b.r,vx:0,vy:0,vz:0,wx:0,wy:0,wz:0});t.dynamics.configureBall(b);
   const p=new THREE.Vector3(b.x,b.y,b.z).project(t.camera);return {x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};
  });
  let p=await placeBall();await page.mouse.move(p.x,p.y);await page.mouse.down();assert((await state()).draggingBall);
  await page.mouse.move(p.x+90,p.y-25);
  const drag=await page.evaluate(()=>{const t=document.getElementById('pocket-android').__idleTest;const before=t.balls[0].x;t.physics(1/120);const first=t.balls[0].x;for(let i=0;i<14;i++)t.physics(1/120);return {before,first,x:t.balls[0].x,vx:t.balls[0].vx};});
  assert(drag.first>drag.before&&drag.first-drag.before<.1,'first pointer movement accelerates instead of teleporting');assert(drag.x>.1);assert(drag.vx>0);
  await page.mouse.up();assert(!(await state()).draggingBall);assert(!(await state()).physics.dragging);
  const released=await page.evaluate(()=>{const t=document.getElementById('pocket-android').__idleTest;const x=t.balls[0].x;t.physics(1/60);return t.balls[0].x-x;});assert(released>0,'release retains physical momentum');
  p=await placeBall();await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(1000,p.y);
  await page.evaluate(()=>{const t=document.getElementById('pocket-android').__idleTest;for(let i=0;i<240;i++)t.physics(1/120);});
  assert(await page.evaluate(()=>{const t=document.getElementById('pocket-android').__idleTest;return t.balls[0].x+t.balls[0].r<=t.getState().bounds.width/2+.001;}),'dragging outside glass cannot cross a wall');await page.mouse.up();
  const cancelled=[];
  for(const reason of ['pointercancel','pause','visibility','mode','resize']){
   await page.evaluate(()=>document.getElementById('pocket-android').__idleTest.setMode('touch'));
   p=await placeBall();await page.mouse.move(p.x,p.y);await page.mouse.down();assert((await state()).draggingBall,reason+' starts a gesture');
   if(reason==='resize'){await page.setViewportSize({width:361,height:840});await page.waitForFunction(()=>Math.abs(document.getElementById('pocket-android').__idleTest.getState().bounds.width-361*9/390)<1e-9);}
   else await page.evaluate(reason=>{const t=document.getElementById('pocket-android').__idleTest;if(reason==='pointercancel')document.querySelector('.ib-stage').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1}));if(reason==='pause')t.setPaused(true);if(reason==='visibility')PocketNative.onVisibility(false);if(reason==='mode')t.setMode('relax');},reason);
   assert(!(await state()).draggingBall,reason+' cancels the gesture');assert(!(await state()).physics.dragging);await page.mouse.up();cancelled.push(reason);
  }
  await page.setViewportSize({width:360,height:840});await page.waitForFunction(()=>Math.abs(document.getElementById('pocket-android').__idleTest.getState().bounds.width-360*9/390)<1e-9);await stop();await openMenu();
  await root.locator('[data-mode="tray"]').click();assert.equal((await state()).count,3);assert((await state()).hasNormalState);
  assert(await root.locator('.ib-more').isDisabled());assert(await root.locator('.ib-less').isDisabled());assert(await root.locator('[data-type="soccer"]').isDisabled());
  await page.evaluate(()=>PocketNative.onSaveRequested());saved=JSON.parse(await page.evaluate(()=>window.saved));assert.equal(saved.mode,'tray');assert.equal(saved.normalState.balls.length,17);
  await load();assert.equal((await state()).mode,'tray');assert.equal((await state()).count,3);assert((await state()).hasNormalState);
  const trayResults=[];
  for(const viewport of viewports){
   await page.setViewportSize(viewport);await page.waitForFunction(width=>Math.abs(document.getElementById('pocket-android').__idleTest.getState().bounds.width-width*9/390)<1e-9,viewport.width);
   const result=await page.evaluate(()=>{
    const t=document.getElementById('pocket-android').__idleTest;t.setGravity(0,0,-16);
    const wells=t.tray.wells;for(let i=0;i<3;i++){const b=t.balls[i],w=wells[i];Object.assign(b,{x:w.x,y:w.y,z:b.r-w.depth,vx:0,vy:0,vz:0,wx:0,wy:0,wz:0});t.dynamics.configureBall(b);}
    for(let i=0;i<120;i++)t.physics(1/120);
    return {viewport:{width:innerWidth,height:innerHeight},wells:wells.map(w=>({x:w.x,y:w.y,radius:w.radius,depth:w.depth})),balls:t.balls.map(b=>({x:b.x,y:b.y,z:b.z,r:b.r})),state:t.getState(),center:t.tray.sample(wells[0].x,wells[0].y)};
   });
   assert.equal(result.wells.length,3);assert.equal(result.state.count,3);assert.equal(result.state.trayComplete,true);assert(result.state.trayOccupied.every(Boolean));assert(result.center.height<0);
   assert(result.balls.every(b=>b.z-b.r<0),'balls physically sit below the surrounding floor');trayResults.push({viewport:result.viewport,occupied:result.state.trayOccupied});
  }
  await closeMenu();await screenshot('tray-fullscreen');await openMenu();await screenshot('menu-tray');
  await root.locator('[data-mode="relax"]').click();assert.equal((await state()).count,17);assert.equal((await state()).selected,'basketball');assert(!(await state()).hasNormalState);
  assert.equal((await state()).sensitivity,1.7);assert.deepEqual((await state()).feedback,{sound:true,haptics:false});
  await screenshot('menu-cover');

  // Feedback coalesces a crowded impact and carries the independent settings
  // through the native interface; silence and lifecycle inactivity stop calls.
  await page.evaluate(()=>{
   window.feedbackCalls=[];PocketFeedback.setActive(true);PocketFeedback.setSettings({sound:true,haptics:false});
   PocketFeedback.impact('soccer',.3);PocketFeedback.impact('tennis',.8);PocketFeedback.flush();
   PocketFeedback.impact('basketball',1);PocketFeedback.flush();
  });
  assert.deepEqual(await page.evaluate(()=>feedbackCalls),[['tennis',.8,true,false]],'strongest contact only, with a 90ms rate limit');
  await page.waitForTimeout(100);
  await page.evaluate(()=>{PocketFeedback.setSettings({sound:false,haptics:true});PocketFeedback.impact('soccer',.5);PocketFeedback.flush();});
  assert.deepEqual((await page.evaluate(()=>feedbackCalls)).at(-1),['soccer',.5,false,true]);
  await page.waitForTimeout(100);
  await page.evaluate(()=>{PocketFeedback.setSettings({sound:false,haptics:false});PocketFeedback.impact('soccer',1);PocketFeedback.flush();PocketFeedback.setSettings({sound:true,haptics:true});PocketFeedback.impact('soccer',1);PocketFeedback.setActive(false);PocketFeedback.flush();PocketFeedback.setActive(true);PocketFeedback.flush();});
  assert.equal((await page.evaluate(()=>feedbackCalls)).length,2,'silent and background states discard pending feedback');
  assert((await page.evaluate(()=>feedbackStates)).some(([active,sound,haptics])=>active===true&&sound===true&&haptics===false),'sound preference reaches native state gate');
  assert((await page.evaluate(()=>feedbackStates)).some(([active,sound,haptics])=>active===true&&sound===false&&haptics===true),'haptic preference reaches native state gate');
  assert((await page.evaluate(()=>feedbackStates)).some(([active])=>active===false),'pause/background explicitly disable native feedback');
  assert(await page.evaluate(()=>PocketNative.onBackPressed()));assert.equal(await page.evaluate(()=>PocketNative.onBackPressed()),false);
  assert.deepEqual(errors,[]);
  const result={passed:true,androidUpdateCalls,motion,pulledMotion:pulled.motion,resizeRadius:originalRadius,drag,cancelled,trayResults,feedbackCalls:await page.evaluate(()=>feedbackCalls),screenshots:['cover-fullscreen','fold-fullscreen','tray-fullscreen','menu-tray','menu-cover']};
  fs.writeFileSync(path.join(output,'scene-browser-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
