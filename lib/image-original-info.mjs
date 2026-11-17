import {webpDimensions} from './product-image-policy.mjs';
export function originalDimensions(bytes,mime){
 const b=bytes,view=new DataView(b.buffer,b.byteOffset,b.byteLength),text=(a,n)=>String.fromCharCode(...b.slice(a,a+n));
 try{
  if(mime==='image/png'&&b.length>=24&&text(12,4)==='IHDR')return {width:view.getUint32(16),height:view.getUint32(20)};
  if(mime==='image/gif'&&b.length>=10)return {width:view.getUint16(6,true),height:view.getUint16(8,true)};
  if(mime==='image/webp'){const [width,height]=webpDimensions(b);return {width,height};}
  if(mime==='image/jpeg'&&b[0]===255&&b[1]===216){let p=2;while(p+3<b.length){if(b[p++]!==255)continue;while(b[p]===255)p++;const marker=b[p++];if(marker===0xda||marker===0xd9)break;if(marker===1||marker>=0xd0&&marker<=0xd7)continue;const len=view.getUint16(p);if(len<2)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&p+7<=b.length)return {width:view.getUint16(p+5),height:view.getUint16(p+3)};p+=len;}}
  if(mime==='image/avif'){// ispe full-box: use a bounded, sized box rather than arbitrary text.
   for(let p=4;p+16<=b.length;p++)if(text(p,4)==='ispe'&&view.getUint32(p-4)>=20&&view.getUint32(p+4)===0)return {width:view.getUint32(p+8),height:view.getUint32(p+12)};
  }
 }catch{}
 return null;
}
export function checkedDimensions(value){return value&&Number.isInteger(value.width)&&Number.isInteger(value.height)&&value.width>0&&value.height>0?value:null;}
