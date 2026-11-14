const bubble = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M4 28V16a12 12 0 1 1 12 12H4Z" fill="#389cff" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>';

/** The bubble's lower-left tip marks the annotation's target point. */
export const COMMENT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(bubble)}") 4 28, crosshair`;
