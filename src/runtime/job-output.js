// MIT source-derived model output rendering; see licenses/dsh-tool-jobs-MIT.txt.
// 实时回读与耐久有界快照共用渲染，观察日志不进入模型输出。
function renderModelDelta(chunks, lossy, spillPaths) {
	const visible = chunks.filter((chunk) => chunk.channel !== "log");
	const out = visible.filter((chunk) => chunk.channel !== "stderr").map((chunk) => chunk.text).join("");
	const err = visible.filter((chunk) => chunk.channel === "stderr").map((chunk) => chunk.text).join("");
	const separator = out.length > 0 && !out.endsWith("\n") ? "\n" : "";
	const body = out + (err.length > 0 ? `${separator}[stderr]\n${err}` : "");
	if (!lossy && !visible.some((chunk) => chunk.gapBefore === true)) return body;
	const notice = `[some output was dropped from memory; full output: ${spillPaths.length > 0 ? spillPaths.join(", ") : "(unavailable)"}]`;
	return `${body}${body.length > 0 && !body.endsWith("\n") ? "\n" : ""}${notice}`;
}
export function renderJobOutput(read){
 const delta=renderModelDelta(read.chunks,read.lossy,read.job.output.spillPaths??[])
 return read.result===undefined?delta:`${delta}${delta.length>0&&!delta.endsWith('\n')?'\n':''}${read.result}`
}
