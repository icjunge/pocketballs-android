const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 try{
 const page=await browser.newPage({viewport:{width:360,height:840},deviceScaleFactor:2});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.calls=[];window.saved='';window.AndroidPocket={loadState(){return '{}';},saveState(s){window.saved=s;},versionName(){return '0.1.1';},ready(){PocketNative.onSensorStatus({available:true,active:true,type:'game_rotation_vector'});PocketNative.onGravity(0,-6,-7.75);},checkForUpdates(){calls.push('check');},downloadUpdate(){calls.push('download');},installUpdate(){calls.push('install');}};});
 await page.goto(pathToFileURL(path.join(__dirname,'../app/src/main/assets/index.html')).href);
 await page.waitForFunction(()=>document.getElementById('pocket-android').__idleTest);
 await page.evaluate(()=>{document.getElementById('pocket-android').__idleTest.setPaused(true);PocketNative.onVisibility(false);});
 const root=page.locator('#pocket-android');await root.locator('.ib-menu').click();
 await page.evaluate(()=>PocketNative.onUpdateStatus({state:'available',versionName:'0.1.2',installedVersionName:'0.1.1'}));
 assert(await root.locator('.ib-menu').evaluate(el=>el.classList.contains('ib-update-available')));
 assert.equal(await root.locator('.ib-update-button').textContent(),'下载更新');
 assert.deepEqual(await page.evaluate(()=>calls),[],'discovering update must not download automatically');
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
 const state=await page.evaluate(()=>{PocketNative.onGravity(9.81,0,0);return document.getElementById('pocket-android').__idleTest.getState();});assert.equal(state.gravity.x,9.81*1.63);assert(state.menuOpen&&state.paused,'sensor updates while paused and menu open');
 assert(await page.evaluate(()=>PocketNative.onBackPressed()));assert.equal(await page.evaluate(()=>PocketNative.onBackPressed()),false);
 const initialRadius=state.radius;
 for(const viewport of [{width:728,height:656},{width:840,height:360},{width:320,height:400}]){await page.setViewportSize(viewport);await page.waitForTimeout(50);const s=await page.evaluate(()=>document.getElementById('pocket-android').__idleTest.getState());assert.equal(s.count,16);assert.equal(s.radius,initialRadius);assert(Math.abs(s.bounds.width-viewport.width*9/390)<1e-9);assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));}
 await page.evaluate(()=>PocketNative.onSaveRequested());const saved=JSON.parse(await page.evaluate(()=>window.saved));assert.equal(saved.schema,1);assert.equal(saved.balls.length,16);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,updateCalls:await page.evaluate(()=>calls),nativeGravity:state.gravity,resizeRadius:initialRadius},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
