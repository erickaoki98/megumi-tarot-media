export type MobileSignals = {
  pointerCoarse: boolean;
  viewportWidth: number;
  userAgent: string;
};

const MAX_MOBILE_WIDTH = 820;

/** "Mobile" = a phone UA, OR a coarse pointer on a small viewport. */
export function isMobileDevice({ pointerCoarse, viewportWidth, userAgent }: MobileSignals): boolean {
  const uaMobile = /iphone|ipod|android.*mobile/i.test(userAgent);
  const smallCoarse = pointerCoarse && viewportWidth <= MAX_MOBILE_WIDTH;
  return uaMobile || smallCoarse;
}
