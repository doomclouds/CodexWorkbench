import type { Feedback } from '../../../contracts/studio';

export type CommentAction = 'reply' | 'edit' | 'delete' | 'resolve' | 'reopen' | 'send';
export interface CommentActionArguments {
  text?: string;
  replyId?: string;
  expectedText?: string;
}
export type RunCommentAction = (
  action: CommentAction,
  item: Feedback,
  args?: CommentActionArguments,
) => Promise<Feedback | null>;
