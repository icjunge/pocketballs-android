/* Shared analytic surface for the visible tray and sphere contacts.
 * All wells join the flat floor with zero slope. Nothing attracts or captures a
 * ball: the inward force is the contact normal under gravity. */
function createPocketTray(width,height) {
  const radius=Math.min(1.45,width*.185,height*.185),depth=radius*.22;
  const centers=height>=width
    ?[[-width*.22,height*.10],[width*.22,height*.10],[0,-height*.16]]
    :[[-width*.10,-height*.22],[-width*.10,height*.22],[width*.16,0]];
  const wells=centers.map(([x,y],id)=>({id,x,y,radius,depth}));
  function sample(x,y){
    for(const well of wells){
      const dx=x-well.x,dy=y-well.y,s=(dx*dx+dy*dy)/(radius*radius);
      if(s>=1)continue;
      const t=1-s,k=6*depth*t*t/(radius*radius);
      return {height:-depth*t*t*t,dx:k*dx,dy:k*dy};
    }
    return {height:0,dx:0,dy:0};
  }
  return {wells,sample};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createPocketTray};
