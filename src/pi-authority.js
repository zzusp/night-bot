export const name = 'night-pi-authority'
export function apply(ctx) {
  const writers = new Map()
  ctx.provide('piAuthority', {
    register(id, owner) {
      if (writers.has(id)) throw new Error('PI_SESSION_ALREADY_LIVE:' + id)
      writers.set(id, owner)
      return () => { if (writers.get(id) === owner) writers.delete(id) }
    },
    context(id) {
      const owner = writers.get(id)
      if (!owner) throw new Error('PI_SESSION_WRITER_REQUIRED:' + id)
      return owner.context()
    },
    describe(id) { return writers.get(id)?.describe() },
  })
}
