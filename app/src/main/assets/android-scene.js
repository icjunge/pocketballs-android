/* Pure timing/input functions are shared with host-side motion validation.
   Physics time follows real elapsed time independently from the 60 Hz render cap. */
function createPocketFrameClock() {
  const interval=1/60;
  let last=null,lastRender=null,budget=0;
  return {
    reset(){last=null;lastRender=null;budget=0;},
    tick(now){
      if(last===null){last=lastRender=now;return {elapsed:0,rawElapsed:0,render:true,renderElapsed:0};}
      const raw=Math.max(0,(now-last)/1000);last=now;budget+=raw;
      const render=budget+1e-6>=interval;
      const renderElapsed=render?Math.max(0,(now-lastRender)/1000):0;
      if(render){budget=Math.max(0,budget-Math.floor((budget+1e-6)/interval)*interval);lastRender=now;}
      return {elapsed:Math.min(.2,raw),rawElapsed:raw,render,renderElapsed};
    }
  };
}
function pocketGravityInput(x,y,z) {
  if(![x,y,z].every(Number.isFinite))return null;
  const magnitude=Math.hypot(x,y,z);if(magnitude<.05||magnitude>40)return null;
  const scale=1.63*Math.min(1,12/magnitude);
  return {x:x*scale,y:y*scale,z:z*scale};
}
function advancePocketPhysics(dynamics,balls,gravity,elapsed) {
  // The solver caps each call at100ms; short slices retain wall time at15/30fps.
  let remaining=Math.min(.2,Math.max(0,elapsed));
  while(remaining>1e-9){const dt=Math.min(.05,remaining);dynamics.step(balls,gravity,dt);remaining-=dt;}
}
/* Native coordinates: +X screen right, +Y screen up, +Z toward the viewer.
   AndroidPocket sends GRAVITY acceleration, already display-rotation remapped
   and sign-corrected: a phone lying face up must send (0, 0, -9.81). */
(() => {
  'use strict';
  const root=document.getElementById('pocket-android'),stage=root.querySelector('.ib-stage'),canvas=root.querySelector('canvas');
  const loading=root.querySelector('.ib-loading'),panel=root.querySelector('.ib-panel'),menu=root.querySelector('.ib-menu');
  const pause=root.querySelector('.ib-pause'),demo=root.querySelector('.ib-demo'),sensorStatus=root.querySelector('.ib-sensor');
  const updateSection=root.querySelector('.ib-update'),updateButton=root.querySelector('.ib-update-button'),updateMessage=root.querySelector('.ib-update-message'),updateProgress=root.querySelector('.ib-update-progress');
  const bridge=window.AndroidPocket,hasNative=!!bridge,names=['soccer','tennis','basketball','volleyball'];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function nativeCall(method,...args){try{return bridge&&typeof bridge[method]==='function'?bridge[method](...args):null;}catch(e){return null;}}
  if(typeof THREE==='undefined'){loading.textContent='3D 资源未加载，请重新打开应用';return;}
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});}catch(e){loading.textContent='3D 画面暂时无法启动，请关闭应用后重试';return;}
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xf1eee7);
  const camera=new THREE.PerspectiveCamera(36,1,.1,120),depth=4.1,corner=1.02;
  camera.position.set(1.3,1.0,depth+26);camera.quaternion.identity();
  scene.add(new THREE.HemisphereLight(0xfffcf1,0xc8c4b7,2.3));
  const key=new THREE.DirectionalLight(0xfff4e2,3.1);key.position.set(-5,7,22);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.bias=-.0004;key.shadow.normalBias=.035;key.shadow.radius=3;scene.add(key);
  const fill=new THREE.DirectionalLight(0xe4efff,.75);fill.position.set(8,-2,8);scene.add(fill);
  const materials=createSportMaterials(THREE);
  materials.soccer.roughness=.79;materials.tennis.roughness=.97;materials.basketball.roughness=.90;materials.volleyball.roughness=.78;
  // Generate local material previews once, then release the spare GL context.
  try{const tr=new THREE.WebGLRenderer({alpha:true,antialias:true});tr.setSize(72,72);tr.outputColorSpace=THREE.SRGBColorSpace;tr.toneMapping=THREE.ACESFilmicToneMapping;tr.toneMappingExposure=1.15;
    const ts=new THREE.Scene(),tc=new THREE.PerspectiveCamera(32,1,.1,20);tc.position.z=4.3;ts.add(new THREE.HemisphereLight(0xffffff,0xa0a095,2.6));const tl=new THREE.DirectionalLight(0xffffff,3);tl.position.set(-3,5,5);ts.add(tl);
    const tb=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),materials.soccer);tb.rotation.set(.4,.5,.2);ts.add(tb);
    names.forEach(name=>{tb.material=materials[name];tb.scale.setScalar(name==='tennis'?.75:1);tr.render(ts,tc);const img=document.createElement('img');img.alt='';img.src=tr.domElement.toDataURL();root.querySelector(`[data-type="${name}"] span`).replaceChildren(img);});
    root.querySelector('[data-type="mixed"] span').replaceChildren(...names.map(name=>root.querySelector(`[data-type="${name}"] img`).cloneNode()));tr.dispose();tr.forceContextLoss();tb.geometry.dispose();
  }catch(e){/* Emoji previews remain usable on low-memory WebViews. */}
  const ac=document.createElement('canvas');ac.width=ac.height=128;const ctx=ac.getContext('2d'),gradient=ctx.createRadialGradient(64,64,8,64,64,63);
  gradient.addColorStop(0,'rgba(42,37,25,.40)');gradient.addColorStop(.35,'rgba(42,37,25,.22)');gradient.addColorStop(.72,'rgba(42,37,25,.07)');gradient.addColorStop(1,'rgba(42,37,25,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const aoTex=new THREE.CanvasTexture(ac),shadowGeom=new THREE.PlaneGeometry(1,1),sphereGeom=new THREE.SphereGeometry(1,36,24);
  const balls=[];let innerW=9,innerH=19.5,halfW=4.5,halfH=9.75,baseRadius=0,effectiveRadius=0,dynamics=null,interior=null;
  let selected='mixed',paused=false,isAuto=false,nativeActive=true,dragging=false,clock=0,raf=0;
  let mode='relax',sensitivity=1.35,normalState=null,tray=null,trayLights=[],trayQuietTime=0,trayComplete=false;
  let gesture=null,rawSensor=null,sensorAgeMs=null,bridgeRoundTripMs=null,sensorSequence=null,lastFrameIntervalMs=0,lastSensorReceivedAt=0;
  const frameClock=createPocketFrameClock();
  let updateState='idle';
  let gravity={x:0,y:0,z:-16},targetGravity={x:0,y:0,z:-16},receivedSensor=false,sensorAvailable=hasNative;
  let currentWidth=0,currentHeight=0,lastSaved=0,saveTimer=0,frameAverage=16.7,quality=1.5,slowTime=0,qualityTimer=0;
  const radiusFor=type=>mode==='tray'?Math.min((effectiveRadius||baseRadius)*.56,.43,innerW*.055,innerH*.055):(effectiveRadius||baseRadius)*(type==='tennis'?.75:1);
  function bounds(){return {width:innerW,height:innerH,depth};}
  function changeBoundaries(width,height){
    // World units follow CSS pixels: unfolding adds room without enlarging balls.
    innerW=width*(9/390);innerH=height*(9/390);halfW=innerW/2;halfH=innerH/2;
    const activeCorner=Math.min(corner,halfW*.8,halfH*.8);
    gesture=null;dragging=false;
    tray=mode==='tray'?createPocketTray(innerW,innerH):null;
    dynamics=createBallPhysics({THREE,halfW,halfH,corner:activeCorner,depth,terrain:tray,
      onImpact:(type,strength)=>window.PocketFeedback?.impact(type,strength)});
    if(interior){for(const marker of trayLights){marker.geometry.dispose();marker.material.dispose();}scene.remove(interior.group);interior.dispose();}
    interior=buildPocketInterior(THREE,{width:innerW,height:innerH,corner:activeCorner,depth,terrain:tray});scene.add(interior.group);
    trayLights=[];trayQuietTime=0;trayComplete=false;
    if(tray)for(const well of tray.wells){
      const marker=new THREE.Mesh(new THREE.RingGeometry(well.radius*.60,well.radius*.63,64),new THREE.MeshBasicMaterial({color:0xb89b61,transparent:true,opacity:.50,depthWrite:false}));
      const points=marker.geometry.getAttribute('position');for(let i=0;i<points.count;i++)points.setZ(i,tray.sample(well.x+points.getX(i),well.y+points.getY(i)).height+.007);
      points.needsUpdate=true;marker.position.set(well.x,well.y,0);
      marker.userData.well=well;interior.group.add(marker);trayLights.push(marker);
    }
    Object.assign(key.shadow.camera,{left:-halfW-2,right:halfW+2,top:halfH+2,bottom:-halfH-2,near:.5,far:65});key.shadow.camera.updateProjectionMatrix();
    for(const b of balls)dynamics.configureBall(b,b.type);
  }
  function updateCount(){root.querySelector('output').textContent=balls.length+' 颗';root.querySelector('.ib-less').disabled=mode==='tray'||balls.length<=1;root.querySelector('.ib-more').disabled=mode==='tray'||balls.length>=32;canvas.setAttribute('aria-label',`${balls.length} 个运动球随手机倾斜滚动和碰撞`);}
  function updateSelection(){root.querySelectorAll('[data-type]').forEach(el=>{el.setAttribute('aria-pressed',String(el.dataset.type===selected));el.disabled=mode==='tray';});}
  function updateModeUI(){
    root.dataset.mode=mode;
    root.querySelectorAll('[data-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.mode===mode)));
    root.querySelectorAll('[data-sensitivity]').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.sensitivity)===sensitivity)));
    const hint=root.querySelector('.ib-mode-hint');if(hint)hint.textContent={relax:'倾斜手机，让小球慢慢滚动',touch:'轻划或拖动一颗球，松手让它继续滚',tray:'慢慢倾斜，把三颗小球分别滚进浅窝'}[mode];
    updateCount();updateSelection();updateSensorStatus();
  }
  function newBall(type){
    const r=radiusFor(type),mesh=new THREE.Mesh(sphereGeom,materials[type]);mesh.castShadow=true;mesh.receiveShadow=true;mesh.rotation.set(Math.random()*6,Math.random()*6,Math.random()*6);mesh.matrixAutoUpdate=false;scene.add(mesh);
    const shade=new THREE.Mesh(shadowGeom,new THREE.MeshBasicMaterial({map:aoTex,transparent:true,depthWrite:false,opacity:.9}));shade.position.z=.014;scene.add(shade);
    const b={x:0,y:0,z:r+.025,vx:0,vy:0,vz:0,r,type,mesh,shade};dynamics.configureBall(b,type);balls.push(b);return b;
  }
  function disposeBall(b){if(gesture?.ball===b)endGesture();scene.remove(b.mesh,b.shade);b.shade.material.dispose();}
  function clearBalls(){while(balls.length)disposeBall(balls.pop());}
  function fitBallRadii(){
    // Only exceptionally small split windows temporarily shrink saved balls.
    const capacity=r=>{const step=2*r+.045;return Math.max(0,Math.floor((innerW-.12)/step))*Math.max(0,Math.floor((innerH-.12)/step))*Math.max(0,Math.floor((depth-.025)/step));};
    let next=baseRadius;
    if(capacity(next)<balls.length){let low=.005,high=next;for(let i=0;i<28;i++){const mid=(low+high)/2;if(capacity(mid)>=balls.length)low=mid;else high=mid;}next=low;}
    effectiveRadius=next;
    for(const b of balls){const r=radiusFor(b.type);if(Math.abs(r-b.r)>1e-7){b.z+=r-b.r;b.r=r;dynamics.configureBall(b,b.type);}dynamics.constrain(b);}
  }
  function safeSeparate(){let result=settleResizedBalls(balls,dynamics);if(!result.converged){packBalls(false);result=settleResizedBalls(balls,dynamics);}return result;}
  // A dense folded/split viewport can require a second layer. This preserves
  // ball size/count and never injects velocity during resize recovery.
  function packBalls(resetVelocity=true){
    dynamics.wake();
    if(mode==='tray'){
      balls.forEach((b,i)=>{const w=tray.wells[i%3];b.x=w.x+(i===0?-.1:.1);b.y=clamp(w.y+tray.wells[0].radius*1.3,-halfH+b.r+.1,halfH-b.r-.1);b.z=b.r+.03;if(resetVelocity)b.vx=b.vy=b.vz=b.wx=b.wy=b.wz=0;dynamics.constrain(b);});
      settleResizedBalls(balls,dynamics);trayQuietTime=0;trayComplete=false;return;
    }
    const spacing=effectiveRadius*2+.045,columns=Math.max(1,Math.floor((innerW-.12)/spacing)),rows=Math.max(1,Math.floor((innerH-.12)/spacing)),perLayer=columns*rows;
    balls.forEach((b,i)=>{const layer=Math.floor(i/perLayer),slot=i%perLayer;b.x=(slot%columns-(columns-1)/2)*spacing;b.y=-halfH+effectiveRadius+.075+Math.floor(slot/columns)*spacing;b.z=effectiveRadius+.025+layer*spacing;
      if(resetVelocity)b.vx=b.vy=b.vz=b.wx=b.wy=b.wz=0;dynamics.constrain(b);});settleResizedBalls(balls,dynamics);
  }
  function addBall(){
    if(mode==='tray'||balls.length>=32)return;const i=balls.length,type=selected==='mixed'?names[(i+Math.floor(i/4))%4]:selected,b=newBall(type);
    let best=-Infinity,bestPoint={x:0,y:0,z:b.r+.04};
    for(let k=0;k<120;k++){const x=(Math.random()*2-1)*(halfW-b.r-.12),y=(Math.random()*2-1)*(halfH-b.r-.12),z=k<90?b.r+.04:depth-b.r-.04;let clearance=Infinity;
      for(const a of balls)if(a!==b)clearance=Math.min(clearance,Math.hypot(a.x-x,a.y-y,a.z-z)-a.r-b.r);if(clearance>best){best=clearance;bestPoint={x,y,z};}}
    Object.assign(b,bestPoint);fitBallRadii();dynamics.constrain(b);safeSeparate();updateCount();scheduleSave();
  }
  function snapshotBalls(){return {selected,radius:baseRadius,effectiveRadius,bounds:bounds(),balls:balls.map(b=>({type:b.type,x:b.x,y:b.y,z:b.z,vx:b.vx,vy:b.vy,vz:b.vz,wx:b.wx,wy:b.wy,wz:b.wz,q:b.mesh.quaternion.toArray()}))};}
  function serialize(){return JSON.stringify({schema:1,...snapshotBalls(),paused,mode,sensitivity,normalState,feedback:window.PocketFeedback?.getSettings()});}
  function saveState(){if(!balls.length)return;clearTimeout(saveTimer);saveTimer=0;const json=serialize();if(hasNative)nativeCall('saveState',json);else try{localStorage.setItem('pocket-balls-state-v1',json);}catch(e){}lastSaved=performance.now();}
  function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(saveState,220);}
  function remapBalls(previous){
    const normalized=balls.map(b=>({x:clamp(b.x/Math.max(.01,previous.width/2-b.r),-1,1),y:clamp(b.y/Math.max(.01,previous.height/2-b.r),-1,1)}));
    fitBallRadii();balls.forEach((b,i)=>{b.x=normalized[i].x*(halfW-b.r);b.y=normalized[i].y*(halfH-b.r);dynamics.constrain(b);});safeSeparate();
  }
  function loadState(){
    try{const json=hasNative?nativeCall('loadState'):localStorage.getItem('pocket-balls-state-v1');if(!json)return false;const s=JSON.parse(json);
      if(s.schema!==1||!Array.isArray(s.balls)||s.balls.length<1||s.balls.length>32||!s.bounds||!Number.isFinite(s.bounds.width+s.bounds.height)||s.bounds.width<=0||s.bounds.height<=0||!Number.isFinite(s.radius))return false;
      mode=['relax','touch','tray'].includes(s.mode)?s.mode:'relax';sensitivity=[1,1.35,1.7].includes(s.sensitivity)?s.sensitivity:1.35;
      normalState=validSnapshot(s.normalState)?s.normalState:null;if(mode==='tray'&&(!normalState||s.balls.length!==3))mode='relax';
      if(mode==='tray')changeBoundaries(currentWidth,currentHeight);
      window.PocketFeedback?.setSettings(s.feedback);
      selected=[...names,'mixed'].includes(s.selected)?s.selected:'mixed';paused=s.paused===true;baseRadius=clamp(s.radius,.5,.92);effectiveRadius=Number.isFinite(s.effectiveRadius)?clamp(s.effectiveRadius,.005,baseRadius):baseRadius;
      for(const saved of s.balls){if(!names.includes(saved.type)||!['x','y','z','vx','vy','vz','wx','wy','wz'].every(k=>Number.isFinite(saved[k])))throw new Error('invalid state');
        const b=newBall(saved.type);for(const k of ['x','y','z','vx','vy','vz','wx','wy','wz'])b[k]=clamp(saved[k],-100,100);if(Array.isArray(saved.q)&&saved.q.length===4&&saved.q.every(Number.isFinite)&&Math.hypot(...saved.q)>.001)b.mesh.quaternion.fromArray(saved.q).normalize();}
      remapBalls(s.bounds);return true;
    }catch(e){clearBalls();mode='relax';normalState=null;changeBoundaries(currentWidth,currentHeight);return false;}
  }
  function validSnapshot(s){return !!s&&Array.isArray(s.balls)&&s.balls.length>0&&s.balls.length<=32&&Number.isFinite(s.radius)&&s.bounds&&Number.isFinite(s.bounds.width+s.bounds.height)&&s.bounds.width>0&&s.bounds.height>0&&s.balls.every(b=>names.includes(b.type)&&['x','y','z','vx','vy','vz','wx','wy','wz'].every(k=>Number.isFinite(b[k])));}
  function restoreSnapshot(s){
    selected=[...names,'mixed'].includes(s.selected)?s.selected:'mixed';baseRadius=clamp(s.radius,.5,.92);effectiveRadius=baseRadius;
    for(const saved of s.balls){const b=newBall(saved.type);for(const k of ['x','y','z','vx','vy','vz','wx','wy','wz'])b[k]=clamp(saved[k],-100,100);if(Array.isArray(saved.q)&&saved.q.length===4&&saved.q.every(Number.isFinite)&&Math.hypot(...saved.q)>.001)b.mesh.quaternion.fromArray(saved.q).normalize();}remapBalls(s.bounds);
  }
  function setMode(next){
    if(!['relax','touch','tray'].includes(next)||mode===next)return;
    endGesture();isAuto=false;
    if(next==='tray'){
      normalState=snapshotBalls();clearBalls();mode=next;changeBoundaries(currentWidth,currentHeight);selected='tennis';effectiveRadius=baseRadius;
      for(let i=0;i<3;i++)newBall('tennis');fitBallRadii();packBalls();
    }else if(mode==='tray'){
      clearBalls();mode=next;changeBoundaries(currentWidth,currentHeight);
      if(validSnapshot(normalState))restoreSnapshot(normalState);else{selected='mixed';for(let i=0;i<16;i++)newBall(names[(i+Math.floor(i/4))%4]);fitBallRadii();packBalls();}
      normalState=null;
    }else mode=next;
    updateModeUI();scheduleSave();
  }
  function setSensitivity(value){if(![1,1.35,1.7].includes(value))return;sensitivity=value;updateModeUI();scheduleSave();}
  function simulationGravity(){return {x:gravity.x*sensitivity,y:gravity.y*sensitivity,z:gravity.z};}
  const deform=new THREE.Matrix4(),orient=new THREE.Matrix4(),invOrient=new THREE.Matrix4(),stretch=new THREE.Matrix4(),unitScale=new THREE.Vector3(),zero=new THREE.Vector3(),axisQuat=new THREE.Quaternion(),normalAxis=new THREE.Vector3(),zAxis=new THREE.Vector3(0,0,1);
  const renderTarget=new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true,type:THREE.HalfFloatType});renderTarget.texture.colorSpace=THREE.LinearSRGBColorSpace;renderTarget.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  const postScene=new THREE.Scene(),postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1),postMaterial=new THREE.ShaderMaterial({uniforms:{tColor:{value:renderTarget.texture},tDepth:{value:renderTarget.depthTexture},resolution:{value:new THREE.Vector2(1,1)},focus:{value:camera.position.z-1.1},pixelRatio:{value:1},dof:{value:1}},depthTest:false,depthWrite:false,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`varying vec2 vUv;uniform sampler2D tColor;uniform sampler2D tDepth;uniform vec2 resolution;uniform float focus;uniform float pixelRatio;uniform float dof;
      void main(){float d=texture2D(tDepth,vUv).x;float z=12.0/(120.0-d*119.9);float coc=clamp((abs(z-focus)-.7)*1.3,0.,2.1)*pixelRatio*dof;vec3 color=texture2D(tColor,vUv).rgb;
      if(coc>.08){vec3 total=color*2.;for(int i=0;i<8;i++){float fi=float(i);float a=fi*2.39996323;vec2 offset=vec2(cos(a),sin(a))*sqrt((fi+.5)/8.)*coc/resolution;total+=texture2D(tColor,vUv+offset).rgb;}color=total/10.;}
      float edge=min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y));color*=1.-.085*exp(-edge*46.);gl_FragColor=vec4(color,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),postMaterial));
  function glassView(){const ratio=camera.near/(camera.position.z-depth);camera.projectionMatrix.makePerspective((-halfW-camera.position.x)*ratio,(halfW-camera.position.x)*ratio,(halfH-camera.position.y)*ratio,(-halfH-camera.position.y)*ratio,camera.near,camera.far);camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();camera.updateMatrixWorld();}
  function resizeRendering(){const pixels=currentWidth*currentHeight,cap=pixels>450000?Math.min(quality,1.25):Math.min(quality,1.5);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,cap));renderer.setSize(currentWidth,currentHeight,false);const size=renderer.getDrawingBufferSize(new THREE.Vector2());renderTarget.setSize(size.x,size.y);postMaterial.uniforms.resolution.value.copy(size);postMaterial.uniforms.pixelRatio.value=renderer.getPixelRatio();}
  function resize(){const w=stage.clientWidth,h=stage.clientHeight;if(w<32||h<32||w===currentWidth&&h===currentHeight)return;const old=bounds();currentWidth=w;currentHeight=h;changeBoundaries(w,h);
    if(!baseRadius){baseRadius=clamp(Math.sqrt(.2*innerW*innerH/(16*Math.PI)),.5,.92);effectiveRadius=baseRadius;if(!loadState()){selected='mixed';paused=false;for(let i=0;i<16;i++)newBall(names[(i+Math.floor(i/4))%4]);fitBallRadii();packBalls();}}
    else remapBalls(old);camera.aspect=w/h;resizeRendering();glassView();updateModeUI();setPaused(paused);frameClock.reset();scheduleSave();
  }
  function openMenu(open){panel.hidden=!open;menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'收起控制面板':(menu.classList.contains('ib-update-available')?'打开控制面板，有可用更新':'打开控制面板'));menu.querySelector('span').textContent=open?'×':'⋯';}
  function setPaused(value){paused=value;if(paused)endGesture();window.PocketFeedback?.setActive(!paused&&nativeActive&&!document.hidden);pause.setAttribute('aria-pressed',String(value));pause.textContent=value?'继续':'暂停';pause.setAttribute('aria-label',value?'继续动画':'暂停动画');scheduleSave();}
  function updateSensorStatus(){sensorStatus.textContent=hasNative?(sensorAvailable?(receivedSensor?'倾斜手机 · 哪边低，小球往哪边滚':'正在连接动作传感器…'):'动作传感器暂不可用，可拖动空白处测试'):(isAuto?'自动倾斜演示':mode==='touch'?'拖动小球 · 拖动空白处模拟倾斜':'拖动画面，模拟手机倾斜');demo.hidden=hasNative&&sensorAvailable;}
  function setAuto(v){isAuto=!!v;demo.setAttribute('aria-pressed',String(isAuto));demo.textContent=isAuto?'停止演示':'自动演示';updateSensorStatus();}
  function supportsUpdates(){return !!bridge&&['checkForUpdates','downloadUpdate','installUpdate'].every(method=>typeof bridge[method]==='function');}
  function showUpdateStatus(info){
    if(!info||typeof info!=='object'||!supportsUpdates())return;
    const states=['idle','checking','available','latest','downloading','ready','permission','error'];
    updateState=states.includes(info.state)?info.state:'idle';updateSection.hidden=false;
    const labels={idle:'检查更新',checking:'正在检查…',available:'下载更新',latest:'检查更新',downloading:'正在下载…',ready:'安装更新',permission:'允许安装后继续',error:'重试检查'};
    updateButton.textContent=typeof info.actionLabel==='string'&&info.actionLabel?info.actionLabel:labels[updateState];updateButton.disabled=info.busy===true||['checking','downloading'].includes(updateState);
    const version=typeof info.versionName==='string'?info.versionName:'';
    const defaults={idle:'',checking:'正在检查新版本',available:version?'发现新版本 '+version:'发现新版本',latest:'已是最新版本',downloading:'正在下载更新',ready:'下载完成，点击安装',permission:'需要允许球屿安装更新',error:'检查更新失败，请稍后重试'};
    updateMessage.textContent=typeof info.message==='string'&&info.message?info.message:defaults[updateState];
    updateMessage.hidden=!updateMessage.textContent;
    updateProgress.hidden=updateState!=='downloading';
    if(Number.isFinite(info.progress)&&info.progress>=0){updateProgress.value=clamp(info.progress,0,100);updateProgress.setAttribute('aria-label','更新下载进度 '+Math.round(updateProgress.value)+'%');}else updateProgress.removeAttribute('value');
    const unread=updateState==='available'||updateState==='ready';menu.classList.toggle('ib-update-available',unread);
    menu.setAttribute('aria-label',panel.hidden?(unread?'打开控制面板，有可用更新':'打开控制面板'):'收起控制面板');
    if(typeof info.installedVersionName==='string')root.querySelector('.ib-version').textContent='球屿 · '+info.installedVersionName;
  }
  updateButton.addEventListener('click',()=>{
    if(!supportsUpdates())return;
    if(updateState==='available')nativeCall('downloadUpdate');
    else if(updateState==='ready'||updateState==='permission')nativeCall('installUpdate');
    else nativeCall('checkForUpdates');
  });
  window.PocketNative={
    onGravity(x,y,z,ageMs,roundTripMs){const next=pocketGravityInput(x,y,z);if(!next)return;targetGravity=next;gravity={...next};rawSensor={x,y,z};sensorAgeMs=Number.isFinite(ageMs)?Math.max(0,ageMs):null;bridgeRoundTripMs=Number.isFinite(roundTripMs)?Math.max(0,roundTripMs):bridgeRoundTripMs;lastSensorReceivedAt=performance.now();if(!receivedSensor){receivedSensor=true;updateSensorStatus();}isAuto=false;},
    onInsets(top,right,bottom,left){[top,right,bottom,left].forEach((n,i)=>document.documentElement.style.setProperty(['--inset-top','--inset-right','--inset-bottom','--inset-left'][i],Math.max(0,Number(n)||0)+'px'));},
    onSensorStatus(value,fallback){const info=typeof value==='object'&&value!==null?value:{available:value,type:fallback?'accelerometer':'gravity'};sensorAvailable=!!info.available;root.dataset.sensorFallback=String(info.type==='accelerometer');root.dataset.sensorType=info.type||'unavailable';updateSensorStatus();},
    onVisibility(active){nativeActive=!!active;frameClock.reset();window.PocketFeedback?.setActive(!paused&&nativeActive&&!document.hidden);if(!nativeActive){endGesture();saveState();cancelAnimationFrame(raf);raf=0;}else requestFrame();},
    onUpdateStatus:showUpdateStatus,
    saveState,onSaveRequested:saveState,
    onBackPressed(){if(panel.hidden)return false;openMenu(false);return true;},
    closeMenu(){if(panel.hidden)return false;openMenu(false);return true;}
  };
  menu.addEventListener('click',()=>openMenu(panel.hidden));pause.addEventListener('click',()=>setPaused(!paused));demo.addEventListener('click',()=>setAuto(!isAuto));
  root.querySelector('.ib-more').addEventListener('click',addBall);
  root.querySelector('.ib-less').addEventListener('click',()=>{if(mode!=='tray'&&balls.length>1){disposeBall(balls.pop());fitBallRadii();safeSeparate();updateCount();scheduleSave();}});
  root.querySelector('.ib-reset').addEventListener('click',()=>{packBalls();scheduleSave();});
  root.querySelectorAll('[data-type]').forEach(el=>el.addEventListener('click',()=>{if(mode==='tray')return;endGesture();selected=el.dataset.type;updateSelection();balls.forEach((b,i)=>{b.type=selected==='mixed'?names[(i+Math.floor(i/4))%4]:selected;const r=radiusFor(b.type);b.z+=r-b.r;b.r=r;b.mesh.material=materials[b.type];dynamics.configureBall(b,b.type);dynamics.constrain(b);});safeSeparate();scheduleSave();}));
  root.querySelectorAll('[data-mode]').forEach(el=>el.addEventListener('click',()=>setMode(el.dataset.mode)));
  root.querySelectorAll('[data-sensitivity]').forEach(el=>el.addEventListener('click',()=>setSensitivity(Number(el.dataset.sensitivity))));
  root.addEventListener('pocket-feedback-change',scheduleSave);
  function dragGravity(e){const rect=stage.getBoundingClientRect(),x=clamp((e.clientX-rect.left)/rect.width*2-1,-1,1),y=clamp(1-(e.clientY-rect.top)/rect.height*2,-1,1),factor=13/Math.max(1,Math.hypot(x,y));targetGravity={x:x*factor,y:y*factor,z:-Math.sqrt(Math.max(0,256-(x*factor)**2-(y*factor)**2))};}
  const pointerRay=new THREE.Raycaster(),pointerNdc=new THREE.Vector2(),pointerHit=new THREE.Vector3(),pointerPlane=new THREE.Plane(new THREE.Vector3(0,0,1),0);
  function pointerWorld(e,z){const rect=canvas.getBoundingClientRect();pointerNdc.set((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2);pointerRay.setFromCamera(pointerNdc,camera);pointerPlane.constant=-z;return pointerRay.ray.intersectPlane(pointerPlane,pointerHit)?{x:pointerHit.x,y:pointerHit.y}:null;}
  function pickBall(e){
    let nearest=null,distance=Infinity;
    for(const b of balls){const p=pointerWorld(e,b.z);if(!p)continue;const d=Math.hypot(p.x-b.x,p.y-b.y)/b.r;if(d<=1.18&&d<distance){nearest=b;distance=d;}}
    return nearest;
  }
  function endGesture(flick=false){
    if(flick&&gesture&&gesture.samples.length>1){
      const last=gesture.samples[gesture.samples.length-1],first=gesture.samples.find(s=>last.t-s.t<=90)||gesture.samples[0];
      const dt=(last.t-first.t)/1000;
      if(dt>.004&&performance.now()-last.t<80&&Math.hypot(last.x-first.x,last.y-first.y)>gesture.ball.r*.12){
        let dx=(last.x-first.x)/dt*.65-gesture.ball.vx,dy=(last.y-first.y)/dt*.65-gesture.ball.vy;
        const impulseSpeed=Math.hypot(dx,dy),limit=3.2;
        if(impulseSpeed>limit){dx*=limit/impulseSpeed;dy*=limit/impulseSpeed;}
        gesture.ball.vx+=dx;gesture.ball.vy+=dy;
      }
    }
    gesture=null;dragging=false;if(dynamics)dynamics.releaseDrag();
  }
  function moveGesture(e){
    if(!gesture||gesture.pointerId!==e.pointerId)return;
    const point=pointerWorld(e,gesture.ball.z);if(!point)return;
    gesture.x=point.x+gesture.offsetX;gesture.y=point.y+gesture.offsetY;
    gesture.samples.push({t:performance.now(),x:gesture.x,y:gesture.y});if(gesture.samples.length>16)gesture.samples.shift();
    dynamics.setDrag(gesture.ball,gesture.x,gesture.y);
  }
  stage.addEventListener('pointerdown',e=>{
    if(!panel.hidden){openMenu(false);return;}if(paused||gesture||dragging)return;
    if(mode==='touch'){
      const b=pickBall(e);if(b){const p=pointerWorld(e,b.z);gesture={ball:b,pointerId:e.pointerId,offsetX:b.x-p.x,offsetY:b.y-p.y,x:b.x,y:b.y,samples:[{t:performance.now(),x:b.x,y:b.y}]};stage.setPointerCapture(e.pointerId);setAuto(false);dynamics.setDrag(b,b.x,b.y);e.preventDefault();return;}
    }
    if(hasNative&&sensorAvailable)return;
    dragging=true;stage.setPointerCapture(e.pointerId);setAuto(false);dragGravity(e);
  });
  stage.addEventListener('pointermove',e=>{if(gesture)moveGesture(e);else if(dragging)dragGravity(e);});
  stage.addEventListener('pointerup',e=>{if(gesture&&gesture.pointerId!==e.pointerId)return;endGesture(true);scheduleSave();});
  stage.addEventListener('pointercancel',()=>endGesture());stage.addEventListener('lostpointercapture',()=>endGesture());
  document.addEventListener('keydown',e=>{if(e.key==='Escape')openMenu(false);});
  document.addEventListener('visibilitychange',()=>{frameClock.reset();window.PocketFeedback?.setActive(!paused&&nativeActive&&!document.hidden);if(document.hidden){endGesture();saveState();cancelAnimationFrame(raf);raf=0;}else requestFrame();});window.addEventListener('pagehide',saveState);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();saveState();loading.textContent='正在恢复 3D 画面…';loading.hidden=false;cancelAnimationFrame(raf);raf=0;});canvas.addEventListener('webglcontextrestored',()=>window.location.reload());
  function requestFrame(){if(!raf&&nativeActive&&!document.hidden)raf=requestAnimationFrame(frame);}
  function pullMotionSample(){
    if(!bridge||typeof bridge.motionSample!=='function')return;
    try{const raw=bridge.motionSample();const sample=typeof raw==='string'?JSON.parse(raw):raw;
      if(!sample||![sample.x,sample.y,sample.z].every(Number.isFinite))return;
      sensorSequence=Number.isFinite(sample.sequence)?sample.sequence:null;
      window.PocketNative.onGravity(sample.x,sample.y,sample.z,sample.ageMs,sample.bridgeRoundTripMs);
    }catch(e){/* Older native wrappers continue to push gravity samples. */}
  }
  function trayOccupancy(){return tray?tray.wells.map(w=>balls.some(b=>Math.hypot(b.x-w.x,b.y-w.y)<w.radius*.33&&Math.hypot(b.vx,b.vy,b.vz)<.24&&Math.abs(b.z-b.r+w.depth)<.09)):[];}
  function updateTray(dt){
    if(!tray)return;const occupied=trayOccupancy();
    trayQuietTime=occupied.every(Boolean)?trayQuietTime+dt:0;
    trayComplete=trayQuietTime>=.8;
    trayLights.forEach((marker,i)=>{marker.material.color.setHex(trayComplete?0x649c7a:0xb89b61);marker.material.opacity+=((occupied[i]?.9:.50)-marker.material.opacity)*(1-Math.exp(-dt*8));});
  }
  function frame(now){raf=0;if(!nativeActive||document.hidden)return;const timing=frameClock.tick(now),dt=timing.elapsed;
    lastFrameIntervalMs=timing.rawElapsed*1000;pullMotionSample();
    if(isAuto){clock+=dt;const angle=Math.sin(clock*.30)*1.4;targetGravity={x:Math.sin(angle)*6.7,y:-Math.cos(angle)*5.4,z:0};targetGravity.z=-Math.sqrt(256-targetGravity.x**2-targetGravity.y**2);}
    // Native gravity is already sensor-fused: applying another low-pass adds lag.
    // It remains live while paused and while settings are open.
    if(hasNative&&receivedSensor)gravity={...targetGravity};
    else {const blend=1-Math.exp(-dt/.018);for(const axis of ['x','y','z'])gravity[axis]+=(targetGravity[axis]-gravity[axis])*blend;}
    if(!paused){advancePocketPhysics(dynamics,balls,simulationGravity(),dt);updateTray(dt);}
    // A120Hz display still simulates120Hz, but GPU work is limited to60 draws/s.
    if(!timing.render){requestFrame();return;}
    const drawDt=Math.min(.2,timing.renderElapsed);let meanZ=0;
    for(const b of balls){unitScale.setScalar(b.r);b.mesh.matrix.compose(zero,b.mesh.quaternion,unitScale);const s=clamp(b.squash||0,0,.045),n=b.squashAxis||zAxis;normalAxis.set(n.x,n.y,n.z).normalize();if(normalAxis.lengthSq()<.5)normalAxis.copy(zAxis);axisQuat.setFromUnitVectors(zAxis,normalAxis);orient.makeRotationFromQuaternion(axisQuat);stretch.makeScale(1/Math.sqrt(1-s),1/Math.sqrt(1-s),1-s);invOrient.copy(orient).invert();deform.copy(orient).multiply(stretch).multiply(invOrient);b.mesh.matrix.premultiply(deform);b.mesh.matrix.setPosition(b.x,b.y,b.z);b.mesh.matrixWorldNeedsUpdate=true;
      const floorZ=tray?tray.sample(b.x,b.y).height:0,height=Math.max(0,b.z-b.r-floorZ),sh=b.r*3+height*.65;b.shade.visible=!tray;b.shade.position.set(b.x+.06,b.y-.10,floorZ+.013);b.shade.scale.set(sh,sh,1);b.shade.material.opacity=.82/(1+height*1.9);meanZ+=b.z;}
    if(panel.hidden){const length=Math.max(1,Math.hypot(gravity.x,gravity.y,gravity.z)),cb=1-Math.exp(-drawDt*7);camera.position.x+=(1.3+gravity.x/length*6.2-camera.position.x)*cb;camera.position.y+=(1+gravity.y/length*5.2-camera.position.y)*cb;}
    glassView();postMaterial.uniforms.focus.value+=(camera.position.z-meanZ/Math.max(1,balls.length)-.3-postMaterial.uniforms.focus.value)*(1-Math.exp(-drawDt*3));
    if(postMaterial.uniforms.dof.value>0){renderer.setRenderTarget(renderTarget);renderer.render(scene,camera);renderer.setRenderTarget(null);renderer.render(postScene,postCamera);}
    else {renderer.setRenderTarget(null);renderer.render(scene,camera);}
    if(timing.renderElapsed>0){
      // Long GPU stalls must count toward recovery too. Previously intervals
      // over250ms skipped this block, trapping the slowest devices at full load.
      const cost=Math.min(.5,timing.renderElapsed);
      frameAverage=frameAverage*.9+cost*1000*.1;
      slowTime=frameAverage>24?slowTime+cost:Math.max(0,slowTime-cost);
      const stalled=timing.renderElapsed>.25;
      if((slowTime>.65||stalled)&&now-qualityTimer>(stalled?500:1500)){
        if(postMaterial.uniforms.dof.value>0)postMaterial.uniforms.dof.value=0;
        if((stalled||postMaterial.uniforms.dof.value===0)&&quality>1){quality=Math.max(1,quality-.25);resizeRendering();}
        qualityTimer=now;slowTime=0;
      }
    }
    window.PocketFeedback?.flush();if(now-lastSaved>1200)saveState();requestFrame();
  }
  resize();new ResizeObserver(resize).observe(stage);window.addEventListener('resize',resize);if(window.visualViewport)window.visualViewport.addEventListener('resize',resize);
  root.querySelector('.ib-version').textContent=hasNative?'球屿 · '+(nativeCall('versionName')||'0.1.1'):'球屿 · 浏览器预览';updateSensorStatus();updateSection.hidden=!supportsUpdates();loading.hidden=true;
  root.__idleTest={balls,renderer,scene,camera,postMaterial,setPaused,setMode,setSensitivity,
    setGravity:(x,y,z=-Math.sqrt(Math.max(0,256-x*x-y*y)))=>{targetGravity={x,y,z};gravity={x,y,z};isAuto=false;},
    physics:dt=>{advancePocketPhysics(dynamics,balls,simulationGravity(),dt);updateTray(dt);},
    get dynamics(){return dynamics;},get interior(){return interior;},get tray(){return tray;},
    get gesture(){return gesture?{ballId:gesture.ball._physicsId,x:gesture.x,y:gesture.y}:null;},
    saveState,serialize,resize,pullMotionSample,
    getState:()=>({selected,paused,isAuto,mode,sensitivity,count:balls.length,radius:baseRadius,effectiveRadius,bounds:bounds(),occupancy:balls.reduce((s,b)=>s+Math.PI*b.r*b.r,0)/(innerW*innerH),gravity:{...gravity},simulationGravity:simulationGravity(),targetGravity:{...targetGravity},menuOpen:!panel.hidden,sensorAvailable,receivedSensor,dpr:renderer.getPixelRatio(),fps:1000/frameAverage,updateState,
      trayOccupied:trayOccupancy(),trayComplete,hasNormalState:!!normalState,draggingBall:!!gesture,feedback:window.PocketFeedback?.getSettings(),
      motion:{rawSensor,sensorAgeMs,bridgeRoundTripMs,sensorSequence,lastFrameIntervalMs,lastSensorReceivedAt},physics:dynamics.getState()})};
  nativeCall('ready');requestFrame();
})();
