// pageOps.js – page actions shared between the home grid and the
// page editor (currently: delete).

import * as state from './state.js';
import * as storage from './storage.js';

export async function deletePage(ctx, id) {
  const page = state.removePage(id);
  if (!page) return;
  try {
    await storage.deletePage(id);
  } catch (err) {
    console.warn('delete from storage failed', err);
  }
}
