/* User-initiated diagnostic export only; no device IDs or automatic uploads. */
(() => {
  const root=document.getElementById('pocket-android'),button=root.querySelector('.ib-diagnostics');
  let timer=0;
  button.addEventListener('click',async()=>{
    const state=root.__idleTest?.getState();if(!state)return;
    const payload={app:root.querySelector('.ib-version').textContent,viewport:{width:innerWidth,height:innerHeight},
      sensor:root.dataset.sensorType,mode:state.mode,sensitivity:state.sensitivity,count:state.count,
      paused:state.paused,fps:Math.round(state.fps),dpr:state.dpr,motion:state.motion,
      gravity:state.gravity,physics:state.physics,note:'样本年龄和桥接往返仅用于定位，不是手机到画面的端到端延迟'};
    if(payload.motion)payload.motion={...payload.motion,jsSampleAgeMs:Math.max(0,performance.now()-payload.motion.lastSensorReceivedAt)};
    const value=JSON.stringify(payload,null,2);
    try{
      if(window.AndroidPocket&&typeof AndroidPocket.copyDiagnostics==='function')AndroidPocket.copyDiagnostics(value);
      else if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
      else throw new Error('clipboard unavailable');
      button.textContent='已复制，可粘贴反馈';
    }catch(e){button.textContent='暂时无法复制';}
    clearTimeout(timer);timer=setTimeout(()=>{button.textContent='复制运行信息';},2000);
  });
})();
