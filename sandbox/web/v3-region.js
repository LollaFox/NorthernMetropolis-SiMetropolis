const NS='http://www.w3.org/2000/svg';
export const EXTENT={west:113.7,east:114.7,south:22.1,north:22.9};
const merc=lat=>Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
const upper=merc(EXTENT.north),lower=merc(EXTENT.south);
export function toMap(lon,lat){return [(lon-EXTENT.west)*600/(EXTENT.east-EXTENT.west),(upper-merc(lat))*400/(upper-lower)];}
export function fromMap(x,y){return [EXTENT.west+x/600*(EXTENT.east-EXTENT.west),(2*Math.atan(Math.exp(upper-y/400*(upper-lower)))-Math.PI/2)*180/Math.PI];}
export class RegionPicker {
  constructor(svg,onChange) {
    this.svg=svg;this.onChange=onChange;this.tiles=svg.querySelector('[data-tiles]');this.rectangle=svg.querySelector('[data-selection]');
    const point=e=>{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(svg.getScreenCTM().inverse());};
    svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.start=point(e);svg.setPointerCapture(e.pointerId);});
    svg.addEventListener('pointerup',e=>{if(!this.start)return;const end=point(e),start=this.start;this.start=null;this.change(start,end);});
    svg.addEventListener('pointermove',e=>{if(this.start)this.change(this.start,point(e));});
    svg.addEventListener('pointercancel',()=>{this.start=null;});
  }
  change(a,b) {
    if(Math.abs(a.x-b.x)<3||Math.abs(a.y-b.y)<3)return;
    const clamp=(v,max)=>Math.max(0,Math.min(max,v));
    const [west,north]=fromMap(clamp(Math.min(a.x,b.x),600),clamp(Math.min(a.y,b.y),400));
    const [east,south]=fromMap(clamp(Math.max(a.x,b.x),600),clamp(Math.max(a.y,b.y),400));
    this.onChange({west,east,south,north});
  }
  set(bounds) {
    const [x,y]=toMap(bounds.west,bounds.north),[x2,y2]=toMap(bounds.east,bounds.south);
    if(![x,y,x2,y2].every(Number.isFinite))return;
    for(const [k,v] of Object.entries({x,y,width:Math.max(0,x2-x),height:Math.max(0,y2-y)}))this.rectangle.setAttribute(k,String(v));
  }
  loadTiles(template,onStatus) {
    if(this.loaded)return;this.loaded=true;
    const z=9,n=2**z;
    const tileXY=(lon,lat)=>[(lon+180)/360*n,(1-merc(lat)/Math.PI)/2*n];
    const [left,top]=tileXY(EXTENT.west,EXTENT.north),[right,bottom]=tileXY(EXTENT.east,EXTENT.south);
    let remaining=(Math.floor(right)-Math.floor(left)+1)*(Math.floor(bottom)-Math.floor(top)+1),errors=0;
    for(let x=Math.floor(left);x<=Math.floor(right);x++)for(let y=Math.floor(top);y<=Math.floor(bottom);y++) {
      const image=document.createElementNS(NS,'image');
      for(const [k,v] of Object.entries({x:(x-left)/(right-left)*600,y:(y-top)/(bottom-top)*400,width:600/(right-left),height:400/(bottom-top),preserveAspectRatio:'none'}))image.setAttribute(k,String(v));
      image.addEventListener('load',()=>{if(--remaining===0)onStatus(errors?'Some map tiles failed; coordinate selection remains available.':'OpenStreetMap loaded. Drag a rectangle; verify coordinates before submitting.');});
      image.addEventListener('error',()=>{errors++;if(--remaining===0)onStatus('Map tiles unavailable. Coordinate selection remains available.');});
      image.setAttribute('href',template.replace('{z}',z).replace('{x}',x).replace('{y}',y));this.tiles.append(image);
    }
  }
}
