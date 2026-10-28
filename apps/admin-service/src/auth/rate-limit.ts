/**
 * GH63 — limiteur des échecs d'authentification (design §6.3) : 10 par minute et par clé (source
 * annoncée, adresse du client web, empreinte du jeton présenté). Seuls les échecs comptent : un
 * jeton valide présenté depuis une autre source reste accepté (S2-12).
 */
export class FailureLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly max = 10,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const t = this.now()
    const list = (this.hits.get(key) ?? []).filter((at) => t - at < this.windowMs)
    if (list.length) this.hits.set(key, list)
    else this.hits.delete(key)
    return list
  }

  blocked(keys: string[]): boolean {
    return keys.some((k) => this.recent(k).length >= this.max)
  }

  fail(keys: string[]): void {
    const t = this.now()
    for (const k of keys) this.hits.set(k, [...this.recent(k), t])
  }
}
