// pageOps.js – page actions shared between the home grid and the
// page editor (currently: delete).

import * as state from './state.js';
import * as storage from './storage.js';

const UNDO_MS = 5000;

// Deletes a page with an undo window. The page leaves the list at once,
// but its stored record is only removed when the window closes without
// an undo – so "Rückgängig" simply puts the page back in memory and at
// its old position, without touching storage.
export async function deletePage(ctx, id) {
  const index = state.getPages().findIndex((p) => p.id === id);
  const page = state.removePage(id);
  if (!page) return;

  const undone = await ctx.toastAction(
    ctx.t('pageDeleted'),
    ctx.t('undo'),
    UNDO_MS
  );
  if (undone) {
    state.addPage(page);
    state.movePage(page.id, index);
    return;
  }
  try {
    await storage.deletePage(id);
  } catch (err) {
    console.warn('delete from storage failed', err);
  }
}
