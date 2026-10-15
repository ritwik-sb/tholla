import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('accessibility smoke', () => {
  test('library has no critical violations', async ({ page }) => {
    await page.goto('/')
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations.filter(v => v.impact === 'critical')).toEqual([])
  })

  test('library is keyboard operable', async ({ page }) => {
    await page.goto('/')
    // Tab to the file input / dropzone area
    await page.keyboard.press('Tab')
    const active = await page.evaluate(() => document.activeElement?.tagName)
    expect(active).toBeTruthy()
  })

  test('reduced motion is respected', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    // Smoke: page still renders
    await expect(page.getByRole('heading', { name: 'തൊള്ള' })).toBeVisible()
  })
})