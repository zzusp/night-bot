export const TOKEN_RING_RADIUS = 41;
const point = (angle: number, radius = TOKEN_RING_RADIUS) => ({x:50+radius*Math.cos(angle),y:50+radius*Math.sin(angle)});
/** Caps stay inside the true angular allocation; no minimum data angle. */
export function tokenArc(share: number, offset: number) {
  const angle=share/100*Math.PI*2, start=offset/100*Math.PI*2;
  if (share === 100) return {full:true,share,offset,width:10,tiny:false};
  const normalInset=Math.asin(5/TOKEN_RING_RADIUS);
  const tiny=angle<normalInset*2;
  const capRadius=tiny ? TOKEN_RING_RADIUS*Math.sin(angle/2)*0.85 : 5;
  const inset=Math.asin(capRadius/TOKEN_RING_RADIUS);
  const startAngle=start+inset,endAngle=start+angle-inset;
  const from=point(startAngle),to=point(endAngle);
  const inner=point(start+angle/2,47),outer=point(start+angle/2,49);
  return {full:false,share,offset,width:capRadius*2,tiny,startAngle,endAngle,
    d:`M ${from.x} ${from.y} A ${TOKEN_RING_RADIUS} ${TOKEN_RING_RADIUS} 0 ${endAngle-startAngle>Math.PI?1:0} 1 ${to.x} ${to.y}`,
    marker:{x1:inner.x,y1:inner.y,x2:outer.x,y2:outer.y}};
}
