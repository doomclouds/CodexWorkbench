export class FeedbackAccessError extends Error {
  constructor() {
    super('This actor cannot access the requested feedback.');
  }
}

export class FeedbackThreadNotFoundError extends Error {
  constructor() {
    super('Feedback thread was not found.');
  }
}

export class FeedbackQueryError extends Error {
  constructor(message: string) {
    super(message);
  }
}
