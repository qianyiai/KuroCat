import { yieldSlice } from './yieldSlice.js';

// Take pigment from the native seated body as the visible flank turns toward
// the viewer. The same inverse projection follows the paws, chest and tail of
// all five colored cats. The silhouette still comes from each authored pose.
function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d', {willReadFrequently: true});
}

async function bodyPaint(native) {
  // The animated head is already a separate plate. Only sample the native
  // torso below the whiskers. Extend its color into the transparent margin.
  const x = 325, y = 293, w = native.width - x, h = native.height - y;
  const ctx = surface(w, h);
  ctx.drawImage(native, -x, -y);
  const data = ctx.getImageData(0, 0, w, h).data;
  const queue = new Int32Array(w*h);
  let end = 0;
  for (let p = 0; p < w*h; p++) {
    if (data[4*p+3] >= 180) queue[end++] = p;
    else data[4*p+3] = 0;
  }
  function extend(p, q) {
    if (data[4*q+3]) return;
    for (let c = 0; c < 3; c++) data[4*q+c] = data[4*p+c];
    data[4*q+3] = 255;
    queue[end++] = q;
  }
  let since = performance.now();
  for (let i = 0; i < end; i++) {
    if ((i & 16383) === 16383 && performance.now() - since > 8) {
      await yieldSlice();
      since = performance.now();
    }
    const p = queue[i];
    if (p%w) extend(p,p-1);
    if (p%w !== w-1) extend(p,p+1);
    if (p >= w) extend(p,p-w);
    if (p+w < w*h) extend(p,p+w);
  }
  ctx.canvas.width = ctx.canvas.height = 1;
  return {data, w, h, originX:502.57-x, originY:560-y};
}

function project(ctx, rect, frame, grid, mesh, source) {
  const [left, top, w, h] = rect;
  const [,ox,oy,width,height] = frame;
  const paint = ctx.createImageData(w+2,h+2), out=paint.data;
  const {cols,rows}=mesh;
  for (let j=-1; j<=h; j++) {
    const v=(Math.min(h-1,Math.max(0,j))+.5)/h, gy=v*(rows-1);
    const cellY=Math.min(rows-2,Math.floor(gy)), fy=gy-cellY;
    for (let i=-1; i<=w; i++) {
      const u=(Math.min(w-1,Math.max(0,i))+.5)/w, gx=u*(cols-1);
      const cellX=Math.min(cols-2,Math.floor(gx)), fx=gx-cellX;
      const k=2*(cellY*cols+cellX), bottom=k+2*cols;
      const dx=(1-fy)*((1-fx)*grid[k]+fx*grid[k+2])+fy*((1-fx)*grid[bottom]+fx*grid[bottom+2]);
      const dy=(1-fy)*((1-fx)*grid[k+1]+fx*grid[k+3])+fy*((1-fx)*grid[bottom+1]+fx*grid[bottom+3]);
      const sx=Math.max(0,Math.min(source.w-1,ox+u*width+source.originX+dx*.5-.5));
      const sy=Math.max(0,Math.min(source.h-1,oy+v*height+source.originY+dy*.5-.5));
      const px=Math.min(source.w-2,Math.floor(sx)), py=Math.min(source.h-2,Math.floor(sy));
      const a=sx-px, b=sy-py;
      const near=4*(py*source.w+px), far=near+4*source.w;
      const index=4*((j+1)*(w+2)+i+1), pixels=source.data;
      for(let c=0;c<3;c++) out[index+c]=(1-b)*((1-a)*pixels[near+c]+a*pixels[near+4+c])
                                      +b*((1-a)*pixels[far+c]+a*pixels[far+4+c]);
      out[index+3]=255;
    }
  }
  ctx.putImageData(paint,left-1,top-1);
}

function shadeLegs(ctx,base,target,source,row,phase,weight) {
  const [x,y,w,h]=target, [sx,sy,sw,sh]=source;
  ctx.drawImage(base,sx-1,sy-1,sw+2,sh+2,x-1,y-1,w+2,h+2);
  const [,ox,oy,width,height,pawX,pawY]=row;
  const advance = phase <= .25 ? phase*150 : phase <= .75 ? (.5-phase)*150 : (phase-1)*150;
  ctx.save();
  ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
  ctx.translate(x,y);ctx.scale(w/width,h/height);ctx.translate(-ox,-oy);
  function shade(cx,cy,rx,ry,alpha) {
    ctx.save();ctx.translate(cx,cy);ctx.scale(rx,ry);
    const light=ctx.createRadialGradient(0,0,.16,0,0,1);
    light.addColorStop(0,'rgba(57,53,55,'+(alpha*weight)+')');
    light.addColorStop(1,'rgba(57,53,55,0)');
    ctx.fillStyle=light;ctx.fillRect(-1,-1,2,2);ctx.restore();
  }
  // The two tucked limbs pass behind the near shoulder and hip. Give them
  // a contact shadow on the same painted surface, following their toe marks.
  shade(-70+advance,-42,48,89,.17);
  shade(46+advance,-54,46,79,.27);
  shade(pawX+11,pawY+6,34,23,.12);
  ctx.restore();
}

export async function registerGuestCoat(base, rects, indices, motion, mesh, native) {
  const frames=[...motion.geometry.lower,...motion.geometry.seat].filter(row=>row[0]>=mesh.first);
  const stride=2*mesh.rows*mesh.cols;
  const bytes=Uint8Array.from(atob(mesh.delta),ch=>ch.charCodeAt(0));
  const changes=new DataView(bytes.buffer), grid=new Int16Array(stride);
  // Append reconstructed cells to this guest's own cache so the running
  // renderer spends no time warping pigment or decoding on the animation clock.
  const wholeWidth=Math.max(1024,base.width);
  let x=1,y=base.height+1,line=0;
  function allocate(w,h) {
    if(x+w+1>wholeWidth){x=1;y+=line+2;line=0;}
    const tile=[x,y,w,h];x+=w+2;line=Math.max(line,h);return tile;
  }
  const tiles=frames.map(row=>allocate(Math.round(row[3]*.48),Math.round(row[4]*.48)));
  const legs=[];
  function shadeClip(clip,weights) {
    const poses=motion.geometry[clip];
    poses.forEach((row,i)=>{
      const strength=weights(i,poses.length);if(!strength)return;
      const source=rects[indices[row[0]]],target=allocate(source[2],source[3]);
      legs.push({row,source,target,phase:clip==='walk'?i/poses.length:0,strength});
    });
  }
  shadeClip('walk',()=>1);
  shadeClip('extend',i=>Math.max(0,1-i/5));
  shadeClip('recover',(i,n)=>Math.max(0,1-(n-1-i)/5));
  shadeClip('lower',i=>Math.max(0,1-i/5));
  const ctx=surface(wholeWidth,y+line+1);
  ctx.drawImage(base,0,0);
  const source=await bodyPaint(native);
  let since=performance.now();
  for(const limb of legs){
    if(performance.now()-since>8){await yieldSlice();since=performance.now();}
    shadeLegs(ctx,base,limb.target,limb.source,limb.row,limb.phase,limb.strength);
    indices[limb.row[0]]=rects.push(limb.target)-1;
  }
  for(const [i,row] of frames.entries()){
    if(performance.now()-since>8){await yieldSlice();since=performance.now();}
    for(let j=0;j<stride;j++) grid[j]+=changes.getInt16(2*(i*stride+j),true);
    const rect=tiles[i];
    project(ctx,rect,row,grid,mesh,source);
    indices[row[0]]=rects.push(rect)-1;
  }
  return ctx.canvas;
}
