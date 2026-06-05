"use client";

import { useEffect, useState } from "react";
import { isMobileDevice } from "./is-mobile";

/** Returns null until determined on the client, then true/false. Re-evaluates on resize. */
export function useIsMobile(): boolean | null {
  const [mobile, setMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const compute = () =>
      setMobile(
        isMobileDevice({
          pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
          viewportWidth: window.innerWidth,
          userAgent: navigator.userAgent,
        }),
      );
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  return mobile;
}
