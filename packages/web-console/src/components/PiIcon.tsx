// Material Design SVG geometry matches pi-agent-dashboard.
export function PiIcon({path,size=14,className}: {path:string;size?:number;className?:string}) {
 return <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" fill="currentColor"><path d={path}/></svg>;
}
