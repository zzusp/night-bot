const todoStatuses = ['pending', 'in_progress', 'completed'] as const;
const resultActions = ['complete', 'wait', 'blocked'] as const;
type TodoStatus = typeof todoStatuses[number];
type ResultAction = typeof resultActions[number];
export type TaskToolPresentation =
  | {kind: 'todos'; todos: {content: string; status: TodoStatus}[]; counts: Record<TodoStatus, number>}
  | {kind: 'task-result'; action?: ResultAction; summary?: string; question?: string; evidence: string[]; limitations: string[]; files: string[]};
const plainObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);
function visibleString(value: unknown): string | undefined {
  return typeof value === 'string' && !!value.trim() ? value : undefined;
}
function visibleStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap(item => {
    const text = visibleString(item);
    return text === undefined ? [] : [text];
  }) : [];
}

// Uses the session reader's already authorized, redacted input only. The
// action shown here is what the model requested, never an accepted result.
export function taskToolPresentation(name: string, text: string): TaskToolPresentation | null {
  if (name !== 'todo_write' && name !== 'task_result') return null;
  if (text.length > 64_000) return null;
  let input: unknown;
  try { input = JSON.parse(text); } catch { return null; }
  if (!plainObject(input)) return null;
  if (name === 'todo_write') {
    if (!Array.isArray(input.todos)) return null;
    const counts: Record<TodoStatus, number> = {pending: 0, in_progress: 0, completed: 0};
    const todos: {content: string; status: TodoStatus}[] = [];
    for (const row of input.todos) {
      if (!plainObject(row)) return null;
      const content = visibleString(row.content);
      const status = todoStatuses.find(status => status === row.status);
      if (!content || !status) return null;
      counts[status]++;
      todos.push({content, status});
    }
    return {kind:'todos', todos, counts};
  }
  const decision = input.decision;
  if (!plainObject(decision)) return null;
  const action = resultActions.find(action => action === decision.action);
  const summary = visibleString(decision.summary), question = visibleString(decision.question);
  const evidence = visibleStrings(decision.evidence), limitations = visibleStrings(decision.limitations);
  const files = Array.isArray(decision.deliveryFiles)
    ? decision.deliveryFiles.flatMap(file => plainObject(file) ? visibleStrings([file.caption]) : []) : [];
  if (!action && !summary && !question && !evidence.length && !limitations.length && !files.length) return null;
  return {kind:'task-result', ...(action ? {action} : {}), ...(summary ? {summary} : {}),
    ...(question ? {question} : {}), evidence, limitations, files};
}

/** Exact native todo_write receipt text, not a number guessed from headings. */
export function todoReceiptCounts(text: string): Record<TodoStatus,number> | null {
  const match=/^Updated todo list: (\d+) pending, (\d+) in progress, (\d+) completed\.$/.exec(text);
  if(!match)return null;
  const [pending,in_progress,completed]=match.slice(1).map(Number);
  return [pending,in_progress,completed].every(Number.isSafeInteger)?{pending,in_progress,completed}:null;
}

export function sameTodoCounts(a:Record<TodoStatus,number>,b:Record<TodoStatus,number>){
  return todoStatuses.every(status=>a[status]===b[status]);
}
