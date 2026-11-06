// Night metadata only. No Session, event history, publication or context facade.
export const nativeSessionHeader=(id,meta={})=>({...meta,version:4,id,createdAt:Date.now(),isSeeded:false})
