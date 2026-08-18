/** Bounds automatic recovery attempts inside a rolling time window. */
export class RecoveryBudget {
  private attempts: number[] = []

  constructor(
    private readonly maxAttempts = 1,
    private readonly windowMs = 60_000,
  ) {}

  allow(now = Date.now()): boolean {
    this.attempts = this.attempts.filter(attempt => now - attempt >= 0 && now - attempt < this.windowMs)
    if (this.attempts.length >= this.maxAttempts) return false
    this.attempts.push(now)
    return true
  }
}
