export function createImageSelection({read,decode,onChange}){
 let version=0,state={pending:false,data:null,error:null};
 const publish=value=>{state=value;onChange({...state});};
 return {
  clear(){version++;publish({pending:false,data:null,error:null});},
  async select(file){
   const current=++version;publish({pending:true,data:null,error:null});
   try{
    if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024||file.size===0)throw Error('请上传 5 MB 以内、非空的 PNG、JPEG 或 WebP 图片。');
    const data=await read(file);await decode(data);
    if(current===version)publish({pending:false,data,error:null});
   }catch(e){if(current===version)publish({pending:false,data:null,error:e.message||'图片读取失败，请重新选择。'});}
  },
  getState(){return {...state};}
 };
}
