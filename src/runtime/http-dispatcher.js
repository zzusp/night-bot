/** Install an owned HTTP dispatcher only after construction succeeds. Publishing
 * must be synchronous and transactional, returning the exact restoration action.
 * Removal restores routing immediately and closes once; every caller shares the
 * same drain promise, including callers arriving after a different installation. */
export async function installHttpDispatcher({create, publish}) {
  const dispatcher = await create()
  let restore
  try { restore = publish(dispatcher) }
  catch (error) {
    try { await dispatcher?.close() } catch {}
    throw error
  }
  let closing
  return () => {
    if (closing) return closing
    // Allocate before restoration so reentrant disposal also receives this drain.
    const completion = Promise.withResolvers()
    closing = completion.promise
    let restoreError
    try { restore() } catch (error) { restoreError = error }
    Promise.resolve().then(() => dispatcher?.close()).then(
      () => restoreError ? completion.reject(restoreError) : completion.resolve(),
      error => completion.reject(restoreError ?? error)
    )
    return closing
  }
}
