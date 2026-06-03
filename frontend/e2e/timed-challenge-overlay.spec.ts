import { test, expect, type Page } from '@playwright/test'

/**
 * Overlay behaviour for the Timed Challenge game.
 *
 * The game is a Flappy-Bird-style canvas game, so the backend is fully stubbed
 * (no game-service needed) and the bird is flown with synthetic Space keydowns.
 * The focus is the feedback overlay state machine:
 *
 *   ready    → IdentifyCard ("IDENTIFY THIS")
 *   crash    → 💥 overlay shown immediately (no grading round-trip)
 *   clean    → "Checking…" (role=status) → graded ✅/❌ (role=alert)
 *   end      → "Round complete!"
 *
 * The regression these guard is the auto-advance timer skipping the graded
 * overlay when /answer is slow (it must wait for grading before counting down).
 */

interface AnswerConfig {
  delayMs?: number
  isCorrect?: boolean
  correctAnswer?: string | null
  explanation?: string | null
  points?: number
}

const QUESTIONS = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  content: `Test claim #${i + 1}: this headline is under review.`,
  type: i % 2 === 0 ? 'misleading_headline' : 'scam_message',
  media_url: null,
  difficulty: 'easy',
  tags: ['test'],
}))

/** Stub every /api/game/* call the page makes. */
async function mockGame(page: Page, answer: AnswerConfig = {}) {
  await page.route('**/api/game/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^\/api\/game/, '')

    if (req.method() === 'POST' && path === '/sessions') {
      return route.fulfill({ json: { id: 1 } })
    }
    if (req.method() === 'GET' && path === '/questions/random') {
      const count = Number(url.searchParams.get('count') ?? '10')
      return route.fulfill({ json: QUESTIONS.slice(0, count) })
    }
    if (req.method() === 'POST' && /\/sessions\/\d+\/answer$/.test(path)) {
      if (answer.delayMs) await new Promise((r) => setTimeout(r, answer.delayMs))
      const isCorrect = answer.isCorrect ?? true
      return route.fulfill({
        json: {
          is_correct: isCorrect,
          correct_answer: answer.correctAnswer ?? (isCorrect ? 'Fake' : 'Real'),
          explanation: answer.explanation ?? 'Because the source is fabricated.',
          points_earned: isCorrect ? (answer.points ?? 120) : 0,
        },
      })
    }
    if (req.method() === 'POST' && /\/sessions\/\d+\/end$/.test(path)) {
      return route.fulfill({
        json: {
          session_id: 1,
          score: 480,
          total_answers: 10,
          correct_answers: 7,
          accuracy: 0.7,
          credibility_before: 50,
          credibility_after: 53,
          credibility_delta: 3,
        },
      })
    }
    return route.continue()
  })
}

interface GameState {
  phase: string
  birdY: number
  fakeCenter: number
}

const flap = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })))

const readGame = (page: Page) =>
  page.evaluate(() => (window as unknown as { __nzGame?: GameState }).__nzGame ?? null)

/** Dismiss the IdentifyCard and begin flying the first question. */
async function startRound(page: Page) {
  await page.goto('/timed-challenge')
  const startBtn = page.getByRole('button', { name: /Start flying/ })
  await expect(startBtn).toBeVisible()
  await startBtn.click()
}

/**
 * Fly the bird, holding it inside the lower FAKE gap via closed-loop control
 * (flap whenever it sinks below the gap centre), until `done` resolves.
 * Resolves true if `done` fired before `timeoutMs`, false otherwise.
 *
 * Reads the dev-only `window.__nzGame` telemetry the game publishes each frame,
 * which makes a clean pass through the gap reliable instead of luck-of-cadence.
 */
async function flyUntil(page: Page, done: () => Promise<boolean>, timeoutMs = 45_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await done()) return true
    const g = await readGame(page)
    if (g && g.phase === 'playing' && g.birdY >= g.fakeCenter) await flap(page)
    await page.waitForTimeout(60)
  }
  return done()
}

const seen = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .isVisible()
    .catch(() => false)

test.describe('Timed Challenge — overlays', () => {
  test('shows the IDENTIFY card overlay on load', async ({ page }) => {
    await mockGame(page)
    await page.goto('/timed-challenge')
    await expect(page.getByText('IDENTIFY THIS')).toBeVisible()
    await expect(page.getByRole('button', { name: /Start flying/ })).toBeVisible()
  })

  test('shows the crash overlay when the bird never flaps', async ({ page }) => {
    await mockGame(page)
    await startRound(page)
    // No flapping → gravity drives the bird into the floor pillar → crash.
    await expect(page.getByText('💥 Crashed!')).toBeVisible({ timeout: 20_000 })
  })

  test('shows "Checking…" then the graded overlay for a clean pass', async ({ page }) => {
    // Small grading delay so the in-flight "Checking…" overlay is observable.
    await mockGame(page, { isCorrect: true, delayMs: 600 })
    await startRound(page)

    // Fly until the in-flight "Checking…" overlay (role=status) appears, which
    // only happens on a clean pass (crashes skip straight to the 💥 alert).
    const reachedChecking = await flyUntil(page, () => seen(page, '[role="status"]'))
    expect(reachedChecking, 'expected a clean pass producing a "Checking…" overlay').toBe(true)
    await expect(page.getByText('Checking…')).toBeVisible()

    // The graded result overlay must follow.
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 })
  })

  test('correct pass renders the ✅ Correct overlay with points', async ({ page }) => {
    await mockGame(page, { isCorrect: true, points: 150 })
    await startRound(page)

    const reached = await flyUntil(page, () => seen(page, '[role="alert"]'))
    expect(reached, 'expected a graded alert overlay').toBe(true)
    // It may be a crash alert; keep flying until a non-crash graded result shows.
    const gotCorrect = await flyUntil(page, async () => {
      const alert = page.getByRole('alert')
      if (!(await alert.isVisible().catch(() => false))) return false
      return (await alert.innerText()).includes('Correct')
    })
    expect(gotCorrect, 'expected a ✅ Correct overlay on a clean pass').toBe(true)
    await expect(page.getByText('✅ Correct!')).toBeVisible()
    await expect(page.getByText('+150 pts')).toBeVisible()
  })

  test('wrong pass renders the ❌ Wrong overlay', async ({ page }) => {
    await mockGame(page, { isCorrect: false, correctAnswer: 'Real' })
    await startRound(page)

    const gotWrong = await flyUntil(page, async () => {
      const alert = page.getByRole('alert')
      if (!(await alert.isVisible().catch(() => false))) return false
      const txt = await alert.innerText()
      return txt.includes('Wrong') && !txt.includes('Crashed')
    })
    expect(gotWrong, 'expected a ❌ Wrong overlay on a clean pass').toBe(true)
    await expect(page.getByText('❌ Wrong')).toBeVisible()
  })

  test('regression: slow grading still shows the graded overlay (not skipped)', async ({ page }) => {
    // 2.8s grading delay — close to the old 3s blanket auto-advance window that
    // used to fire mid-"Checking…" and skip the ✅/❌ result entirely.
    await mockGame(page, { isCorrect: true, delayMs: 2800 })
    await startRound(page)

    const reachedChecking = await flyUntil(page, () => seen(page, '[role="status"]'))
    expect(reachedChecking, 'expected a clean pass producing a "Checking…" overlay').toBe(true)

    // Despite the slow /answer, the graded alert must still appear and be shown
    // for its full window (auto-advance only starts after grading completes).
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 8_000 })
    await expect(page.getByRole('alert')).toContainText('Correct')
    // Still visible ~1.5s later → it wasn't instantly skipped past.
    await page.waitForTimeout(1500)
    await expect(page.getByRole('alert')).toBeVisible()
  })
})
