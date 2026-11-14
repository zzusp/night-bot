// Read-only completeness check for the retained current-applied projection.
// Missing/replaced receipts cannot prove a lifetime total. Never infer skill
// contribution from its current global version or an active destination alone.
export function learningCoverage(taskId, reviews, skills, changes) {
  const complete = {memory: true, skill: true};
  const appliedEntries = new Set(changes.filter(row => row.taskId === taskId && row.status === 'applied').map(row => JSON.stringify([row.kind, row.name])));
  const applied = (kind, name) => appliedEntries.has(JSON.stringify([kind, name]));
  for (const review of Object.values(reviews)) {
    if (review.taskId !== taskId) continue;
    if (review.forgotten || !Array.isArray(review.lessons) || review.status === 'failed') complete.memory = complete.skill = false;
    const lessons = Array.isArray(review.lessons) ? review.lessons : [];
    const destinations = Array.isArray(review.destinations) ? review.destinations : [];
    for (const destination of destinations) {
      const memoryKey = destination?.memory?.topic === 'experience' ? destination.memory.key : undefined;
      if (memoryKey && !lessons.some(lesson => lesson?.memoryKey === memoryKey) && !applied('memory', memoryKey)) complete.memory = false;
      if (destination?.skill?.key && !lessons.some(lesson => lesson?.skill && lesson.key === destination.skill.key) && !applied('skill', destination.skill.key)) complete.skill = false;
    }
    for (const lesson of lessons) {
      if (!lesson || typeof lesson !== 'object') { complete.memory = complete.skill = false; continue; }
      if (!lesson.memoryKey || lesson.memoryWrite === 'uncertain') complete.memory = complete.skill = false;
      if ((lesson.applied || lesson.memoryWrite === 'committed') && !applied('memory', lesson.memoryKey)) complete.memory = false;
      if (lesson.applied && lesson.skill && !applied('skill', lesson.key)) {
        // An explicitly inactive candidate is not an applied skill. A replaced
        // support/version or missing state cannot prove the task's total.
        const skill = skills[lesson.key];
        if (!skill || skill.active || !skill.supports?.some(row => row.taskId === taskId && row.memoryKey === lesson.memoryKey)) complete.skill = false;
      }
    }
  }
  // The producer retains at most 40 supports. A full buffer may have evicted
  // this task; do not silently interpret that absence as a genuine zero.
  if (Object.values(skills).some(skill => skill.supports?.length >= 40)) complete.skill = false;
  return complete;
}
