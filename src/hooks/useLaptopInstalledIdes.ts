"use client";

import { useEffect, useState, useTransition } from "react";
import { SupportedIde, SUPPORTED_IDES } from "@/lib/extension/ide-protocol";
import { detectInstalledLaptopIdesAction } from "@/app/actions/laptop-ides";

const INSTALLED_IDES_STORAGE_KEY = "nb:laptop-installed-ides:v2";
const LEGACY_STORAGE_KEY = "nb:laptop-installed-ides";

function getClientPlatform(): "darwin" | "win32" | "linux" {
  if (typeof window === "undefined" || !window.navigator) return "darwin";
  const ua = window.navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "win32";
  if (ua.includes("linux")) return "linux";
  return "darwin";
}

export function useLaptopInstalledIdes() {
  const [installedIdes, setInstalledIdes] = useState<SupportedIde[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      // Purge legacy cache that may contain false positive entries
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      const saved = window.localStorage.getItem(INSTALLED_IDES_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((id) => id in SUPPORTED_IDES);
        }
      }
    } catch {
      // Ignore
    }
    return [];
  });

  const [platform, setPlatform] = useState<string>(() => getClientPlatform());
  const [isLoading, setIsLoading] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (installedIdes.length > 0) return;
    let cancelled = false;
    const clientPlatform = getClientPlatform();
    detectInstalledLaptopIdesAction(clientPlatform)
      .then((res) => {
        if (cancelled || !res.success) return;
        startTransition(() => {
          setInstalledIdes(res.installedIds);
          if (res.platform && res.platform !== "unknown") {
            setPlatform(res.platform);
          }
          try {
            window.localStorage.setItem(
              INSTALLED_IDES_STORAGE_KEY,
              JSON.stringify(res.installedIds),
            );
          } catch {
            // Ignore
          }
        });
      })
      .catch((err) => {
        console.warn("Could not detect local laptop IDEs:", err);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const hasDetectedInstalled = installedIdes.length > 0;

  // Split SUPPORTED_IDES into installed and other available
  const installedList = installedIdes
    .filter((id) => id in SUPPORTED_IDES)
    .map((id) => SUPPORTED_IDES[id]);

  const otherList = (Object.keys(SUPPORTED_IDES) as SupportedIde[])
    .filter((id) => !installedIdes.includes(id))
    .map((id) => SUPPORTED_IDES[id]);

  return {
    installedIdes,
    installedList,
    otherList,
    hasDetectedInstalled,
    platform,
    isLoading,
  };
}
