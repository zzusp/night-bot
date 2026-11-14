export type ChartPoint = {x: number; y: number};
// Both Bezier control ordinates stay at their measured endpoints. Each segment
// is monotone and stays inside that endpoint range, with no invented extrema.
export function smoothStagePath(points: ChartPoint[]): string {
  if (!points.length) return '';
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index], middle = (previous.x + point.x) / 2;
    return `${path} C ${middle},${previous.y} ${middle},${point.y} ${point.x},${point.y}`;
  }, `M ${points[0].x},${points[0].y}`);
}
