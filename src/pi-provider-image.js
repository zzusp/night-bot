/** Keep aspect ratio under the request pixel budget, never upscale. Rounding is
 * pinned to the longer edge so portrait and landscape requests are symmetric.
 */
export function piRequestImageDimensions(width,height,maxPixels) {
  if(![width,height,maxPixels].every(value=>Number.isSafeInteger(value)&&value>0))throw Object.assign(new Error('Invalid request image dimensions or pixel budget'),{code:'INVALID_REQUEST'})
  const scale=Math.min(1,Math.sqrt(maxPixels/(width*height)))
  if(scale===1)return{width,height}
  const landscape=width>=height,long=landscape?width:height,short=landscape?height:width
  let major=Math.max(1,Math.floor(long*scale)),minor=Math.max(1,Math.round(major*short/long))
  while(major*minor>maxPixels&&major>1){major--;minor=Math.max(1,Math.round(major*short/long))}
  return landscape?{width:major,height:minor}:{width:minor,height:major}
}
