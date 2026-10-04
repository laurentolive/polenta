declare module 'diff3' {
  type Diff3Chunk<T> =
    | { ok: T[]; conflict?: undefined }
    | { ok?: undefined; conflict: { a: T[]; aIndex: number; o: T[]; oIndex: number; b: T[]; bIndex: number } }

  /** Same library and call shape as isomorphic-git's own `mergeFile` (ours, base, theirs). */
  function diff3Merge<T>(a: T[], o: T[], b: T[]): Diff3Chunk<T>[]
  export = diff3Merge
}
