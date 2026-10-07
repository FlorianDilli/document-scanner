// pageOps.js – page actions shared between the home grid and the
// page editor (currently: delete with undo toast).

import * as state from './state.js';
import * as storage from './storage.js';

// Remove a page and offer Undo via the action toast. Not awaited
// by callers that navigate away immediately afterwards.
export async function deletePageWithUndo(ctx, id) {
  const pages = state.getPages();
  const index = pages.findIndex((p) => p.id === id);
  if (index === -1) return;
  const page = state.removePage(id);
  try {
    await storage.deletePage(id);
  } catch (err) {
    console.warn('delete from storage failed', err);
  }
  const undone = await ctx.toastAction(ctx.t('pageDeleted'), ctx.t('undo'));
  if (undone) {
    state.insertPage(page, index);
    try {
      await storage.savePage(page);
    } catch (err) {
      console.warn('undo persist failed', err);
    }
  }
}
