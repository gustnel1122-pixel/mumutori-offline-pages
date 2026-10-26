(function(factory){const api=factory(typeof module==='object'?require('./buylist-state.js'):window.OfflineBuylistState);if(typeof module==='object')module.exports=api;if(typeof window==='object')window.OfflinePreparationImages=api;})(function(B){
'use strict';
const MAX_BYTES=80*1024,MAX_PHOTOS=12;
function jpegInfo(url){
 if(typeof url!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(url))throw Error('사진 파일은 JPEG로 줄여서 저장해 주세요.');
 const base64=url.slice(23);if(base64.length%4||base64.length>Math.ceil(MAX_BYTES/3)*4)throw Error('사진은 80KB 안쪽으로 저장해 주세요.');
 const binary=typeof atob==='function'?atob(base64):Buffer.from(base64,'base64').toString('binary');
 const byte=i=>binary.charCodeAt(i),word=i=>(byte(i)<<8)|byte(i+1);
 if(binary.length>MAX_BYTES||word(0)!==0xffd8||word(binary.length-2)!==0xffd9)throw Error('JPEG 사진을 확인해 주세요.');
 let width=0,height=0;
 for(let i=2;i+3<binary.length;){if(byte(i)!==255)break;const marker=byte(i+1);if(marker===0xda||marker===0xd9)break;const length=word(i+2);if(length<2||i+2+length>binary.length)break;
  if([0xc0,0xc1,0xc2].includes(marker)){height=word(i+5);width=word(i+7);break;}i+=length+2;
 }
 if(!width||!height||width>400||height>400)throw Error('사진은 가로·세로 400px 이하로 줄여 주세요.');
 return {width,height,bytes:binary.length};
}
function validate(photos){if(!Array.isArray(photos)||photos.length>MAX_PHOTOS)throw Error('사진은 한 줄에 12장까지 넣을 수 있어요.');return photos.map(url=>{if(typeof url!=='string')throw Error('사진 주소를 확인해 주세요.');if(url.startsWith('data:'))jpegInfo(url);else{if(url.length>2000)throw Error('사진 주소가 너무 길어요.');B.validateLinks([url]);}return url;});}
async function compress(file,maxBytes=MAX_BYTES){
 if(!file||!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw Error('JPG·PNG·WEBP 사진을 골라 주세요. HEIC는 JPG로 바꿔 주세요.');
 if(file.size>20*1024*1024)throw Error('20MB 이하 사진을 골라 주세요.');
 const limit=Math.min(MAX_BYTES,Math.floor(maxBytes));if(limit<700)throw Error('이 줄의 사진 저장 공간이 부족해요. 사진 주소로 추가해 주세요.');
 const bitmap=await createImageBitmap(file);try{
  for(const size of [400,320,256,200,160,128,96]){const scale=Math.min(1,size/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   for(const quality of [.82,.65,.5,.35,.22]){const result=canvas.toDataURL('image/jpeg',quality);if(result.length<=23+Math.ceil(limit/3)*4&&jpegInfo(result).bytes<=limit)return result;}
  }
  throw Error('기존 메모를 보존할 공간이 부족해요. 사진 주소로 추가해 주세요.');
 }finally{bitmap.close();}
}
return Object.freeze({validate,jpegInfo,compress,MAX_BYTES,MAX_PHOTOS});
});
