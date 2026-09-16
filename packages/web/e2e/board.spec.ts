/**
 * Happy-path UI flow on the fake executor:
 * add project → new task → refine (questions) → answer → To do → start →
 * Review → chat feedback → Review → merge → Done. Also checks search and
 * the 409 toast for an invalid drag.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const state = () => JSON.parse(readFileSync(join(here, '.state.json'), 'utf8')) as { repo: string };

test.describe
  .serial('board flow', () => {
    test('adds a project and walks a task from Backlog to Done', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
      await page.getByPlaceholder('/home/me/code/my-app').fill(state().repo);
      await page.getByPlaceholder('my-app', { exact: true }).fill('E2E project');
      await page.getByRole('button', { name: 'Add project' }).click();
      await expect(page.getByText('Project added')).toBeVisible();
      await page.getByRole('button', { name: 'Open board' }).click();
      await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible();

      // new task via the keyboard shortcut
      await page.locator('main').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('n');
      await page.getByPlaceholder('Add rate limiting to the login endpoint').fill('Add subtract function');
      await page.locator('textarea').first().fill('FAKE:ask Add subtract(a, b) to math.js');
      await page.getByRole('button', { name: 'Create in Backlog' }).click();

      // drawer opens on the new task; refine → questions
      const drawer = page.getByLabel('Task details');
      await expect(drawer.getByRole('heading', { name: 'Add subtract function' })).toBeVisible();
      await drawer.getByRole('button', { name: 'Refine → To do' }).click();
      await expect(drawer.getByText('The agent needs a few answers')).toBeVisible();
      const answers = drawer.locator('section textarea');
      await answers.nth(0).fill('blue');
      await answers.nth(1).fill('yes');
      await drawer.getByRole('button', { name: 'Submit answers & continue refinement' }).click();
      await expect(drawer.getByText('To do', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Plan from refinement')).toBeVisible();

      // start → review
      await drawer.getByRole('button', { name: 'Start' }).click();
      await expect(drawer.getByText('Review', { exact: true })).toBeVisible({ timeout: 30_000 });

      // chat feedback resumes the session and returns to review
      await drawer.getByRole('button', { name: 'Chat' }).click();
      const composer = drawer.getByPlaceholder(/Also handle the empty-list case/);
      await composer.fill('please also add a note');
      await drawer.getByRole('button', { name: 'Send & re-run' }).click();
      await expect(drawer.getByText('please also add a note')).toBeVisible();
      await expect(drawer.getByText('agent · followup')).toBeVisible({ timeout: 30_000 });
      await expect(drawer.getByText('Review', { exact: true })).toBeVisible({ timeout: 30_000 });

      // diff shows the agent's file, then merge
      await drawer.getByRole('button', { name: 'Diff' }).click();
      await expect(drawer.getByText('agent.txt')).toBeVisible();
      await drawer.getByRole('button', { name: 'Overview' }).click();
      await drawer.getByRole('button', { name: 'Merge → Done' }).click();
      await expect(drawer.getByText('Done', { exact: true })).toBeVisible({ timeout: 20_000 });
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();

      // search filters the board
      await page.getByLabel('Search tasks').fill('nothing-matches');
      await expect(page.getByText('1 task hidden')).toBeVisible();
      await page.getByLabel('Search tasks').fill('');
    });

    test('rejects an invalid drag with a toast and snaps the card back', async ({ page }) => {
      // Seed through the API so the test does not depend on the previous scenario's UI state.
      const base = 'http://127.0.0.1:3799/api';
      const projects = (await (await fetch(`${base}/projects`)).json()) as { id: string }[];
      const projectId = projects[0]!.id;
      const task = (await (
        await fetch(`${base}/projects/${projectId}/tasks`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Drag me', description: 'x' }),
        })
      ).json()) as { id: string };
      await page.goto(`/p/${projectId}`);
      const card = page.getByText('Drag me').first();
      const review = page.getByRole('heading', { name: 'Review' });
      const from = (await card.boundingBox())!;
      const to = (await review.boundingBox())!;
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      // dnd-kit activates after 6px of movement, then needs further pointermove events to compute `over`
      await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
      await page.waitForTimeout(150);
      await page.mouse.move(to.x + 40, to.y + 140, { steps: 20 });
      await page.waitForTimeout(150);
      await page.mouse.up();
      await expect(page.getByText(/Cannot move task: BACKLOG tasks can only move to TODO/)).toBeVisible();
      // server state unchanged → card is still in Backlog
      const fresh = (await (await fetch(`${base}/tasks/${task.id}`)).json()) as { column: string };
      expect(fresh.column).toBe('backlog');
    });
  });
