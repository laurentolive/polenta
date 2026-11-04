/**
 * GH87 — constructions d'un index par repo. Une seule à la fois, partagée par les lecteurs
 * concurrents ; une construction dépassée par une invalidation ne doit pas être publiée, puisqu'elle
 * a pu lire les fichiers avant le changement.
 */
export class IndexBuilds {
  private readonly running = new Map<string, Promise<void>>()
  private readonly generations = new Map<string, number>()

  /** À relever au début d'une construction, puis à comparer avant de publier son résultat. */
  generation(repoPath: string): number {
    return this.generations.get(repoPath) ?? 0
  }

  /** La construction en cours est dépassée : le prochain lecteur en lance une nouvelle. */
  invalidate(repoPath: string): void {
    this.generations.set(repoPath, this.generation(repoPath) + 1)
    this.running.delete(repoPath)
  }

  /** Attend que l'index existe, en repartant si la construction attendue a été dépassée. */
  async ensure(repoPath: string, isBuilt: () => boolean, build: () => Promise<void>): Promise<void> {
    while (!isBuilt()) {
      let pending = this.running.get(repoPath)
      if (!pending) {
        const started: Promise<void> = build().finally(() => {
          if (this.running.get(repoPath) === started) this.running.delete(repoPath)
        })
        pending = started
        this.running.set(repoPath, pending)
      }
      await pending
    }
  }
}
