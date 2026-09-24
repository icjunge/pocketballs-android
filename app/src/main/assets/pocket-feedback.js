/* Collision feedback is intentionally sparse: keep the strongest contact of a
   rendered frame and rate-limit playback independently from physics substeps. */
(() => {
  'use strict';
  const root=document.getElementById('pocket-android');
  const soundControl=root.querySelector('.ib-sound'),hapticControl=root.querySelector('.ib-haptics');
  const types=['soccer','tennis','basketball','volleyball'];
  let settings={sound:false,haptics:true},active=true,pending=null,last=-Infinity,context=null;
  const voices=new Set();
  function stopBrowserAudio(){for(const voice of voices)try{voice.stop();}catch(e){}voices.clear();if(context)context.suspend().catch(()=>{});}
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function nativeFeedback(){return window.AndroidPocket&&typeof window.AndroidPocket.playFeedback==='function';}
  function syncNative(){
    const bridge=window.AndroidPocket;
    try{if(bridge&&typeof bridge.setFeedbackState==='function')bridge.setFeedbackState(active&&!document.hidden,settings.sound,settings.haptics);}catch(e){}
  }
  function unlock(){
    if(!active||document.hidden||!settings.sound||nativeFeedback())return;
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return;
    try{if(!context)context=new Audio();if(context.state==='suspended')context.resume().catch(()=>{});}catch(e){}
  }
  function sync(){soundControl.checked=settings.sound;hapticControl.checked=settings.haptics;}
  function previewTone(type,strength){
    if(!context||context.state!=='running')return;
    const now=context.currentTime,osc=context.createOscillator(),gain=context.createGain();
    const frequency={soccer:172,tennis:310,basketball:116,volleyball:215}[type];
    osc.type='sine';osc.frequency.setValueAtTime(frequency,now);osc.frequency.exponentialRampToValueAtTime(frequency*.68,now+.1);
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.06*strength,now+.003);gain.gain.exponentialRampToValueAtTime(.0001,now+.11);
    osc.connect(gain);gain.connect(context.destination);voices.add(osc);osc.start(now);osc.stop(now+.12);osc.onended=()=>{voices.delete(osc);osc.disconnect();gain.disconnect();};
  }
  function impact(type,strength){
    if(!active||document.hidden||!types.includes(type)||!Number.isFinite(strength)||strength<.025||(!settings.sound&&!settings.haptics))return;
    const hit={type,strength:clamp(strength,0,1)};
    if(!pending||hit.strength>pending.strength)pending=hit;
  }
  function flush(){
    const hit=pending;pending=null;
    if(!hit||!active||document.hidden)return;
    const now=performance.now();if(now-last<90)return;last=now;
    if(nativeFeedback()){
      try{window.AndroidPocket.playFeedback(hit.type,hit.strength,settings.sound,settings.haptics);}catch(e){}
    }else{
      if(settings.sound)previewTone(hit.type,hit.strength);
      if(settings.haptics&&hit.strength>=.18&&navigator.vibrate)navigator.vibrate(Math.round(5+hit.strength*7));
    }
  }
  function setSettings(value){
    if(!value||typeof value!=='object')return;
    if(typeof value.sound==='boolean')settings.sound=value.sound;
    if(typeof value.haptics==='boolean')settings.haptics=value.haptics;
    pending=null;sync();syncNative();if(!settings.sound)stopBrowserAudio();
  }
  soundControl.addEventListener('change',()=>{settings.sound=soundControl.checked;pending=null;syncNative();if(!settings.sound)stopBrowserAudio();unlock();root.dispatchEvent(new Event('pocket-feedback-change'));});
  hapticControl.addEventListener('change',()=>{settings.haptics=hapticControl.checked;pending=null;syncNative();root.dispatchEvent(new Event('pocket-feedback-change'));});
  document.addEventListener('pointerdown',unlock,{passive:true});
  document.addEventListener('visibilitychange',()=>{syncNative();if(document.hidden){pending=null;stopBrowserAudio();}else unlock();});
  window.PocketFeedback={impact,flush,getSettings:()=>({...settings}),setSettings,setActive(value){active=!!value;if(!active){pending=null;stopBrowserAudio();}else unlock();syncNative();}};
  sync();syncNative();
})();
