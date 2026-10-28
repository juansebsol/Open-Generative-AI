'use client';

// General: the language the studio runs in, the keyboard shortcuts, and what
// this build is. Language is a route tree (/ and /zh), so changing it
// reloads the page on the same studio.

import { IconBrandGithub, IconExternalLink } from '@tabler/icons-react';
import { LOCALE_CONFIGS, SUPPORTED_LOCALES } from '@/lib/locales';
import { Group, Row, SELECT, LINK, fill } from './ui';

const REPOSITORY_URL = 'https://github.com/Anil-matcha/Open-Generative-AI';

export default function GeneralSection({ locale, copy, version, languagePath }) {
  const shortcuts = [
    { keys: ['⌘', 'K'], label: copy.shortcutPalette },
    { keys: ['Esc'], label: copy.shortcutClose },
    { keys: ['↑', '↓', '↵'], label: copy.shortcutPick },
  ];
  return (
    <>
      <Group title={copy.interface}>
        <Row title={copy.language} hint={copy.languageHint}>
          <select
            value={locale}
            aria-label={copy.language}
            onChange={(event) => { if (event.target.value !== locale) window.location.assign(languagePath(event.target.value)); }}
            className={`${SELECT} w-[180px]`}
            data-settings-language
          >
            {SUPPORTED_LOCALES.map((code) => <option key={code} value={code}>{LOCALE_CONFIGS[code].nativeName}</option>)}
          </select>
        </Row>
      </Group>

      <Group title={copy.shortcuts}>
        {shortcuts.map((shortcut) => (
          <Row key={shortcut.label} title={shortcut.label}>
            <span className="flex items-center gap-1">
              {shortcut.keys.map((key) => (
                <kbd key={key} className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-[6px] border border-white/[0.1] bg-white/[0.04] px-1.5 font-mono text-[11px] text-white/60">{key}</kbd>
              ))}
            </span>
          </Row>
        ))}
      </Group>

      <Group title={copy.about}>
        <Row title={fill(copy.version, { version })} hint={copy.aboutHint}>
          <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
            <IconBrandGithub size={14} stroke={1.75} aria-hidden="true" />
            {copy.github}
            <IconExternalLink size={12} stroke={2} aria-hidden="true" />
          </a>
        </Row>
        <Row title={copy.privacyTitle} hint={copy.privacy} />
      </Group>
    </>
  );
}
