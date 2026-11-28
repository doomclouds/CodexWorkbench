export type StudioLocation =
  | { readonly kind: 'workbench' }
  | { readonly kind: 'whiteboard'; readonly boardId: string }
  | { readonly kind: 'recycle-bin' };
