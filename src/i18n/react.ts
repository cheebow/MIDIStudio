import { useSyncExternalStore } from 'react';
import { locale, subscribeLocale, type Locale } from './index';

/** The current UI language; re-renders the caller when it changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, locale);
}
