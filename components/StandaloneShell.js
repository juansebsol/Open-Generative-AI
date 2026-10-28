'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  ImageStudio, VideoStudio, MotionControlStudio, ClippingStudio, LipSyncStudio, RecastStudio, CinemaStudio, AudioStudio, MarketingStudio, AiInfluencerStudio, LayersStudio, DesignAgentStudio, WorkflowStudio, AgentsStudio, VibeMotionStudio, ThreeDStudio, VectorStudio, BenchmarksStudio, BenchmarksHelper,
  PROVIDERS, hasAnyProvider, isStudioAvailable, loadProviderSettings, registerMediaServiceWorker, removeUnusedMedia, subscribeProviderSettings,
} from 'studio';
import {
  IconAlertCircle, IconAperture, IconChartBar, IconCheck, IconChevronDown, IconCube, IconKey, IconMenu2, IconMicrophone, IconMusic, IconPalette, IconPhoto, IconReplace, IconRobot, IconScissors, IconSearch, IconSettings, IconSitemap, IconSpeakerphone, IconStack2, IconUpload, IconUsers, IconVideo, IconWalk, IconWand, IconX, IconPhotoScan, IconBrush, IconBone, IconTopologyStar3, IconVectorBezier2, IconIcons, IconVectorSpline
} from '@tabler/icons-react';
import ProvidersModal from './ProvidersModal';
import CommandPalette from './CommandPalette';
import Logo from './Logo';
import { getCommonCopy, getLocaleConfig, localizeStudioPath } from '@/lib/locales';

// Tab/category ids and English `label` fallbacks are stable identifiers, not
// locale copy. Rendered labels and descriptions come from `copy.tabs`,
// `copy.tabDescriptions` and `copy.categories`, with these as the fallback.
const TABS = [
  { id: 'image', label: 'Image Studio', icon: IconPhoto },
  { id: 'layers', label: 'Layers Studio', icon: IconStack2 },
  { id: 'cinema', label: 'Cinema Studio', icon: IconAperture },
  { id: 'ai-influencer', label: 'AI Influencer Studio', icon: IconUsers },
  { id: 'design-agent', label: 'Design Agent', icon: IconPalette },
  { id: 'video', label: 'Video Studio', icon: IconVideo },
  { id: 'clipping', label: 'AI Clipping', icon: IconScissors },
  { id: 'motion-control', label: 'Motion Control', icon: IconWalk },
  { id: 'lipsync', label: 'Lip Sync', icon: IconMicrophone },
  { id: 'body-swap', label: 'Body Swap', icon: IconReplace },
  { id: 'marketing', label: 'Marketing Studio', icon: IconSpeakerphone },
  { id: 'vibe-motion', label: 'Vibe Motion', icon: IconWand },
  { id: 'audio', label: 'Audio Studio', icon: IconMusic },
  { id: 'three-d-text', label: 'Text to 3D', icon: IconCube },
  { id: 'three-d-image', label: 'Image to 3D', icon: IconPhotoScan },
  { id: 'three-d-retexture', label: 'Retexture', icon: IconBrush },
  { id: 'three-d-rig', label: 'Rig and animate', icon: IconBone },
  { id: 'three-d-mesh', label: 'Mesh tools', icon: IconTopologyStar3 },
  { id: 'vector-logo', label: 'Text to Logo', icon: IconVectorBezier2 },
  { id: 'vector-icons', label: 'Icon Set', icon: IconIcons },
  { id: 'vector-vectorize', label: 'Vectorize', icon: IconVectorSpline },
  { id: 'agents', label: 'Agents', icon: IconRobot },
  { id: 'workflows', label: 'Workflows', icon: IconSitemap },
  { id: 'benchmarks', label: 'Benchmarks', icon: IconChartBar },
];

const NAVIGATION_CATEGORIES = [
  { id: 'images', label: 'Images', tabIds: ['image', 'layers', 'cinema', 'ai-influencer', 'design-agent'] },
  { id: 'video', label: 'Video', tabIds: ['video', 'clipping', 'motion-control', 'lipsync', 'body-swap', 'marketing', 'vibe-motion'] },
  { id: 'audio', label: 'Audio', tabIds: ['audio'] },
  { id: '3d', label: '3D', tabIds: ['three-d-text', 'three-d-image', 'three-d-retexture', 'three-d-rig', 'three-d-mesh'] },
  { id: 'vector', label: 'Vector', tabIds: ['vector-logo', 'vector-icons', 'vector-vectorize'] },
  { id: 'agents-automation', label: 'Automation', tabIds: ['agents', 'workflows'] },
  // A single page, so the nav shows it as a plain link instead of a menu.
  { id: 'benchmarks', label: 'Benchmarks', tabIds: ['benchmarks'], link: true },
];

// The 3D pages share one component; each tab passes its page id.
const THREE_D_TABS = TABS.map((tab) => tab.id).filter((id) => id.startsWith('three-d-'));
// The Vector pages share one component the same way.
const VECTOR_TABS = TABS.map((tab) => tab.id).filter((id) => id.startsWith('vector-'));
const AVAILABLE_TAB_IDS = new Set(TABS.map((tab) => tab.id).filter(isStudioAvailable));
const VISIBLE_CATEGORIES = NAVIGATION_CATEGORIES
  .map((category) => ({ ...category, tabIds: category.tabIds.filter((id) => AVAILABLE_TAB_IDS.has(id)) }))
  .filter((category) => category.tabIds.length > 0);
const DEFAULT_TAB = AVAILABLE_TAB_IDS.has('image') ? 'image' : [...AVAILABLE_TAB_IDS][0];

const getNavigationCategory = (tabId) => (
  VISIBLE_CATEGORIES.find((category) => category.tabIds.includes(tabId))
);

const NOTIFICATIONS_STORAGE_KEY = 'open_gen_notifications_v1';
const MAX_VISIBLE_NOTIFICATIONS = 3;

const loadStoredNotifications = () => {
  if (typeof window === 'undefined') return [];

  try {
    const stored = JSON.parse(window.sessionStorage.getItem(NOTIFICATIONS_STORAGE_KEY) || '[]');
    const now = Date.now();
    return Array.isArray(stored)
      ? stored.filter((notification) => notification.expiresAt > now).slice(0, MAX_VISIBLE_NOTIFICATIONS)
      : [];
  } catch {
    return [];
  }
};

const persistNotifications = (notifications) => {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(
      NOTIFICATIONS_STORAGE_KEY,
      JSON.stringify(notifications),
    );
  } catch {
    // Notification persistence is optional; rendering still works without storage.
  }
};

// Providers with a key (cloud) or a server URL (local) set in this browser.
const countConfiguredProviders = () => {
  const settings = loadProviderSettings();
  return PROVIDERS.filter((provider) => (
    provider.kind === 'local' ? settings.urls?.[provider.id] : settings.keys?.[provider.id]
  )).length;
};

const isPlainLeftClick = (event) => (
  event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
);

export default function StandaloneShell({ locale = 'en' }) {
  const params = useParams();
  const slug = params?.slug || [];

  const copy = getCommonCopy(locale);
  const tabLabel = useCallback(
    (tabId) => copy.tabs?.[tabId] || TABS.find((t) => t.id === tabId)?.label || tabId,
    [copy],
  );
  const tabDescription = useCallback((tabId) => copy.tabDescriptions?.[tabId] || '', [copy]);
  const categoryLabel = useCallback(
    (categoryId) => copy.categories?.[categoryId] || NAVIGATION_CATEGORIES.find((c) => c.id === categoryId)?.label || categoryId,
    [copy],
  );
  const studioPath = useCallback((tabId) => localizeStudioPath(locale, tabId), [locale]);

  // Initialize activeTab from URL slug/params or default to 'image'
  const getInitialTab = () => {
    const firstSegment = slug[0];
    if (firstSegment && AVAILABLE_TAB_IDS.has(firstSegment)) return firstSegment;
    return DEFAULT_TAB;
  };

  const [hasProvider, setHasProvider] = useState(false);
  const [providerCount, setProviderCount] = useState(0);
  const [activeTab, setActiveTab] = useState(getInitialTab());

  const [showSettings, setShowSettings] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  // Top navigation: one open category menu at a time, a mobile sheet, the palette.
  const [openMenuId, setOpenMenuId] = useState(null);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const menuBarRef = useRef(null);
  const activeCategory = getNavigationCategory(activeTab);

  useEffect(() => {
    if (!openMenuId) return undefined;
    const closeOnOutside = (event) => {
      if (!menuBarRef.current?.contains(event.target)) setOpenMenuId(null);
    };
    const closeOnEscape = (event) => event.key === 'Escape' && setOpenMenuId(null);
    window.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenuId]);

  useEffect(() => {
    const toggle = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, []);

  // Drag and Drop State
  const [isDragging, setIsDragging] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState(null);

  // Global generation notifications remain mounted while users switch studios.
  const [notifications, setNotifications] = useState([]);
  const [notificationsHydrated, setNotificationsHydrated] = useState(false);
  const [generationCounts, setGenerationCounts] = useState({});

  useEffect(() => {
    setNotifications(loadStoredNotifications());
    setNotificationsHydrated(true);
  }, []);

  const pushNotification = useCallback((notif) => {
    const now = Date.now();
    const id = `notif-${Date.now()}-${Math.random()}`;
    const ttl = 12000;
    const entry = { ...notif, id, expiresAt: now + ttl };
    setNotifications((previous) => {
      const next = [
        ...previous.filter((notification) => notification.expiresAt > now),
        entry,
      ].slice(-MAX_VISIBLE_NOTIFICATIONS);
      persistNotifications(next);
      return next;
    });
  }, []);

  const dismissNotification = useCallback((id) => {
    setNotifications((previous) => {
      const next = previous.filter((notification) => notification.id !== id);
      persistNotifications(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!notificationsHydrated) return;

    persistNotifications(notifications);
  }, [notifications, notificationsHydrated]);

  useEffect(() => {
    if (notifications.length === 0) return undefined;

    const nextExpiry = Math.min(...notifications.map((notification) => notification.expiresAt));
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setNotifications((previous) => previous.filter((notification) => notification.expiresAt > now));
    }, Math.max(0, nextExpiry - Date.now()));

    return () => window.clearTimeout(timer);
  }, [notifications]);

  const makeSuccessCallback = useCallback((tabId) => (data) => {
    const tab = TABS.find(t => t.id === tabId);
    pushNotification({
      type: 'success',
      tabId,
      label: tab?.label || tabId,
      resultUrl: data?.url || null,
    });
  }, [pushNotification]);

  const makeErrorCallback = useCallback((tabId) => (errorOrMessage) => {
    const tab = TABS.find(t => t.id === tabId);
    const message = typeof errorOrMessage === 'string'
      ? errorOrMessage
      : (errorOrMessage?.message || errorOrMessage?.error || String(errorOrMessage || 'Generation failed'));
    pushNotification({ type: 'error', tabId, label: tab?.label || tabId, message });
  }, [pushNotification]);

  const makeGenerationStartCallback = useCallback((tabId) => () => {
    setGenerationCounts((previous) => ({
      ...previous,
      [tabId]: (previous[tabId] || 0) + 1,
    }));
  }, []);

  const makeGenerationEndCallback = useCallback((tabId) => () => {
    setGenerationCounts((previous) => {
      const currentCount = previous[tabId] || 0;
      if (currentCount <= 1) {
        const next = { ...previous };
        delete next[tabId];
        return next;
      }

      return {
        ...previous,
        [tabId]: currentCount - 1,
      };
    });
  }, []);

  const activeGenerations = TABS
    .filter((tab) => generationCounts[tab.id] > 0)
    .map((tab) => ({
      tabId: tab.id,
      label: tabLabel(tab.id),
      count: generationCounts[tab.id],
    }));

  // Popstate event listener to sync tab state with URL on back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      // Strip the locale root prefix (if any) before reading the
      // /studio/<tab> segment, so this works for both /studio/<tab> and
      // /<locale>/studio/<tab>.
      const { rootPath } = getLocaleConfig(locale);
      const localeAwarePath = rootPath && path.startsWith(rootPath) ? path.slice(rootPath.length) : path;
      const segments = localeAwarePath.split('/').filter(Boolean);
      const tabId = segments[1] || DEFAULT_TAB;
      if (AVAILABLE_TAB_IDS.has(tabId)) {
        setActiveTab(tabId);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [locale]);

  const handleTabChange = useCallback((tabId) => {
    // Selecting a model on the page already open must not add history.
    if (window.location.pathname !== studioPath(tabId)) window.history.pushState(null, '', studioPath(tabId));
    setActiveTab(tabId);
  }, [studioPath]);

  const handleOpenNotification = useCallback((notification) => {
    handleTabChange(notification.tabId);
    dismissNotification(notification.id);
  }, [dismissNotification, handleTabChange]);

  const handleNavigationItemClick = (event, tabId) => {
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    handleTabChange(tabId);
    setOpenMenuId(null);
    setIsMobileOpen(false);
  };

  const paletteItems = useMemo(() => [
    ...VISIBLE_CATEGORIES.flatMap((category) => category.tabIds.map((tabId) => ({
      id: `tab-${tabId}`,
      group: categoryLabel(category.id),
      label: tabLabel(tabId),
      keywords: tabDescription(tabId),
      icon: TABS.find((tab) => tab.id === tabId)?.icon,
      hint: copy.palette.open,
      onSelect: () => handleTabChange(tabId),
    }))),
    { id: 'providers', group: copy.palette.actions, label: copy.palette.openProviders, icon: IconSettings, onSelect: () => setShowSettings(true) },
    { id: 'add-key', group: copy.palette.actions, label: copy.palette.addKey, icon: IconKey, onSelect: () => setShowSettings(true) },
  ], [categoryLabel, copy.palette, handleTabChange, tabDescription, tabLabel]);

  // Generated media is saved in this browser and served by a service worker.
  useEffect(() => {
    registerMediaServiceWorker();
    const cleanup = window.setTimeout(() => {
      removeUnusedMedia().catch(() => {});
    }, 15000);
    return () => window.clearTimeout(cleanup);
  }, []);

  useEffect(() => {
    setHasMounted(true);
    const sync = () => {
      setHasProvider(hasAnyProvider());
      setProviderCount(countConfiguredProviders());
    };
    sync();
    if (!hasAnyProvider()) setShowSettings(true);
    const unsubscribe = subscribeProviderSettings(sync);
    const openSettings = () => setShowSettings(true);
    window.addEventListener('oga:provider-setup-needed', openSettings);
    return () => {
      unsubscribe();
      window.removeEventListener('oga:provider-setup-needed', openSettings);
    };
  }, []);

  // Studios hand work to each other (a 3D result sent to Retexture) by
  // asking the shell to open a tab.
  useEffect(() => {
    const openStudio = (event) => {
      const tabId = event.detail?.tabId;
      if (AVAILABLE_TAB_IDS.has(tabId)) handleTabChange(tabId);
    };
    window.addEventListener('oga:open-studio', openStudio);
    return () => window.removeEventListener('oga:open-studio', openStudio);
  }, [handleTabChange]);

  // Drag and Drop Handlers
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const isFileDrag = e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files');
    if (isFileDrag && e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the container itself, not moving between children
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setDroppedFiles(files);
    }
  }, []);

  const handleFilesHandled = useCallback(() => {
    setDroppedFiles(null);
  }, []);

  if (!hasMounted) return (
    <div className="min-h-screen bg-app-bg flex items-center justify-center">
      <Logo size={36} className="animate-pulse text-primary" />
    </div>
  );

  const renderStudioLink = (tabId, { compact = false } = {}) => {
    const tab = TABS.find((item) => item.id === tabId);
    if (!tab) return null;
    const Icon = tab.icon;
    const isActive = activeTab === tab.id;
    return (
      <a
        key={tab.id}
        href={studioPath(tab.id)}
        onClick={(event) => handleNavigationItemClick(event, tab.id)}
        aria-current={isActive ? 'page' : undefined}
        className={`group flex items-center gap-3 rounded-[10px] p-2.5 transition-colors ${isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.05]'}`}
      >
        <span className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] transition-colors ${isActive ? 'border-primary/40 text-primary' : 'text-white/55 group-hover:border-primary/35 group-hover:text-primary'}`}>
          <Icon size={16} stroke={1.75} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium leading-tight text-white/[0.92]">{tabLabel(tab.id)}</span>
          {!compact && tabDescription(tab.id) && (
            <span className="mt-0.5 block text-[12px] leading-snug text-white/40">{tabDescription(tab.id)}</span>
          )}
        </span>
      </a>
    );
  };

  const keysLabel = providerCount === 0
    ? copy.shell.addKey
    : providerCount === 1 ? copy.shell.oneKey : copy.shell.keysCount.replace('{count}', providerCount);

  return (
    <div
      className="h-screen bg-app-bg flex flex-col overflow-hidden text-white relative"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-primary/10 backdrop-blur-md border-4 border-dashed border-primary/50 flex items-center justify-center pointer-events-none">
          <div className="bg-panel-bg p-8 rounded-2xl border border-white/10 shadow-2xl flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center text-[#04202a]">
              <IconUpload size={30} stroke={2} aria-hidden="true" />
            </div>
            <div className="flex flex-col items-center">
              <span className="text-lg font-semibold text-white">{copy.shell.dropHere}</span>
              <span className="text-sm text-white/45">{copy.shell.dropHereHint}</span>
            </div>
          </div>
        </div>
      )}

      {/* Top navigation */}
      <header className="relative z-50 flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] bg-panel-bg px-4">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsMobileOpen((open) => !open)}
            className="md:hidden flex h-9 w-9 items-center justify-center rounded-[10px] text-white/70 hover:bg-white/[0.06] hover:text-white"
            aria-label={copy.shell.toggleNavMenu}
            aria-expanded={isMobileOpen}
          >
            {isMobileOpen ? <IconX size={18} stroke={1.75} aria-hidden="true" /> : <IconMenu2 size={18} stroke={1.75} aria-hidden="true" />}
          </button>
          <a href={studioPath(DEFAULT_TAB)} onClick={(event) => handleNavigationItemClick(event, DEFAULT_TAB)} className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-primary text-[#090A0F]">
              <Logo size={15} />
            </span>
            <span className="text-[14px] font-semibold tracking-[-0.01em] text-white">{copy.shell.brand}</span>
          </a>
        </div>

        <nav ref={menuBarRef} aria-label={copy.shell.studioNavigation} className="hidden md:flex items-center gap-0.5">
          {VISIBLE_CATEGORIES.map((category) => {
            const isOpen = openMenuId === category.id;
            const isActive = activeCategory?.id === category.id;
            const wide = category.tabIds.length > 4;
            if (category.link) {
              const tabId = category.tabIds[0];
              return (
                <a
                  key={category.id}
                  href={studioPath(tabId)}
                  onClick={(event) => handleNavigationItemClick(event, tabId)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative flex h-[34px] items-center rounded-[10px] px-3 text-[13.5px] font-medium transition-colors hover:bg-white/[0.06] ${isActive ? 'text-white' : 'text-white/55 hover:text-white'}`}
                >
                  {categoryLabel(category.id)}
                  {isActive && <span className="absolute inset-x-3 -bottom-[11px] h-0.5 rounded-full bg-primary" aria-hidden="true" />}
                </a>
              );
            }
            return (
              <div
                key={category.id}
                className="relative"
                onMouseEnter={() => openMenuId && openMenuId !== category.id && setOpenMenuId(category.id)}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                  onClick={() => setOpenMenuId(isOpen ? null : category.id)}
                  className={`relative flex h-[34px] items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors ${isOpen || isActive ? 'text-white' : 'text-white/55 hover:text-white'} ${isOpen ? 'bg-white/[0.06]' : 'hover:bg-white/[0.06]'}`}
                >
                  {categoryLabel(category.id)}
                  <IconChevronDown size={14} stroke={1.75} className={`text-white/35 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                  {isActive && <span className="absolute inset-x-3 -bottom-[11px] h-0.5 rounded-full bg-primary" aria-hidden="true" />}
                </button>
                {isOpen && (
                  <div
                    role="menu"
                    className={`absolute left-1/2 top-[calc(100%+10px)] -translate-x-1/2 rounded-[14px] border border-white/[0.12] bg-[#111114] p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.55)] animate-fade-in-up ${wide ? 'w-[560px] grid grid-cols-2 gap-0.5' : 'w-[300px]'}`}
                    style={{ animationDuration: '160ms' }}
                  >
                    {category.tabIds.map((tabId) => renderStudioLink(tabId))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPaletteOpen(true)}
            className="flex h-[34px] items-center gap-2 rounded-[10px] border border-white/[0.07] bg-white/[0.03] px-2.5 text-[13px] text-white/40 transition-colors hover:border-white/[0.12] hover:text-white/60 sm:w-[200px]"
            aria-label={copy.shell.search}
          >
            <IconSearch size={15} stroke={1.75} aria-hidden="true" />
            <span className="hidden flex-1 text-left sm:inline">{copy.shell.search}</span>
            <kbd className="hidden rounded-[5px] border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-white/35 sm:inline">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className={`flex h-[34px] items-center gap-2 rounded-[10px] border px-3 text-[13px] font-medium transition-colors ${hasProvider ? 'border-white/[0.07] text-white/60 hover:border-white/[0.12] hover:text-white' : 'border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15'}`}
            aria-label={copy.shell.providers}
          >
            <span className={`h-[7px] w-[7px] rounded-full ${hasProvider ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden="true" />
            <span className="hidden sm:inline">{keysLabel}</span>
            <IconChevronDown size={14} stroke={1.75} className="hidden text-white/35 sm:inline" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Mobile navigation sheet */}
      {isMobileOpen && (
        <div className="md:hidden fixed inset-0 top-14 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setIsMobileOpen(false)} role="presentation">
          <div className="max-h-full overflow-y-auto border-b border-white/[0.08] bg-panel-bg p-3" onClick={(event) => event.stopPropagation()} role="presentation">
            {VISIBLE_CATEGORIES.map((category) => (
              <div key={category.id} className="mb-2">
                <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-white/40">{categoryLabel(category.id)}</div>
                {category.tabIds.map((tabId) => renderStudioLink(tabId, { compact: true }))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Studio Content */}
      <div className="flex-1 min-h-0 h-full relative overflow-hidden bg-app-bg">
        {AVAILABLE_TAB_IDS.has('image') && (
          <div className={activeTab === 'image' ? "h-full w-full" : "hidden"}>
            <ImageStudio locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('image')} onGenerationEnd={makeGenerationEndCallback('image')} onGenerationComplete={makeSuccessCallback('image')} onGenerationError={makeErrorCallback('image')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('layers') && (
          <div className={activeTab === 'layers' ? "h-full w-full" : "hidden"}>
            <LayersStudio hasProvider={hasProvider} locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('layers')} onGenerationEnd={makeGenerationEndCallback('layers')} onGenerationComplete={makeSuccessCallback('layers')} onGenerationError={makeErrorCallback('layers')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('video') && (
          <div className={activeTab === 'video' ? "h-full w-full" : "hidden"}>
            <VideoStudio locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('video')} onGenerationEnd={makeGenerationEndCallback('video')} onGenerationComplete={makeSuccessCallback('video')} onGenerationError={makeErrorCallback('video')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('motion-control') && (
          <div className={activeTab === 'motion-control' ? "h-full w-full" : "hidden"}>
            <MotionControlStudio locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('motion-control')} onGenerationEnd={makeGenerationEndCallback('motion-control')} onGenerationComplete={makeSuccessCallback('motion-control')} onGenerationError={makeErrorCallback('motion-control')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('clipping') && (
          <div className={activeTab === 'clipping' ? "h-full w-full" : "hidden"}>
            <ClippingStudio locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('clipping')} onGenerationEnd={makeGenerationEndCallback('clipping')} onGenerationComplete={makeSuccessCallback('clipping')} onGenerationError={makeErrorCallback('clipping')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('lipsync') && (
          <div className={activeTab === 'lipsync' ? "h-full w-full" : "hidden"}>
            <LipSyncStudio locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('lipsync')} onGenerationEnd={makeGenerationEndCallback('lipsync')} onGenerationComplete={makeSuccessCallback('lipsync')} onGenerationError={makeErrorCallback('lipsync')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('body-swap') && (
          <div className={activeTab === 'body-swap' ? "h-full w-full" : "hidden"}>
            <RecastStudio locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('body-swap')} onGenerationEnd={makeGenerationEndCallback('body-swap')} onGenerationComplete={makeSuccessCallback('body-swap')} onGenerationError={makeErrorCallback('body-swap')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('cinema') && (
          <div className={activeTab === 'cinema' ? "h-full w-full" : "hidden"}>
            <CinemaStudio locale={locale} onGenerationStart={makeGenerationStartCallback('cinema')} onGenerationEnd={makeGenerationEndCallback('cinema')} onGenerationComplete={makeSuccessCallback('cinema')} onGenerationError={makeErrorCallback('cinema')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('audio') && (
          <div className={activeTab === 'audio' ? "h-full w-full" : "hidden"}>
            <AudioStudio locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('audio')} onGenerationEnd={makeGenerationEndCallback('audio')} onGenerationComplete={makeSuccessCallback('audio')} onGenerationError={makeErrorCallback('audio')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('marketing') && (
          <div className={activeTab === 'marketing' ? "h-full w-full" : "hidden"}>
            <MarketingStudio locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('marketing')} onGenerationEnd={makeGenerationEndCallback('marketing')} onGenerationComplete={makeSuccessCallback('marketing')} onGenerationError={makeErrorCallback('marketing')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('ai-influencer') && (
          <div className={activeTab === 'ai-influencer' ? "h-full w-full" : "hidden"}>
            <AiInfluencerStudio
              locale={locale}
              onGenerationStart={makeGenerationStartCallback('ai-influencer')}
              onGenerationEnd={makeGenerationEndCallback('ai-influencer')}
              onGenerationComplete={makeSuccessCallback('ai-influencer')}
              onGenerationError={makeErrorCallback('ai-influencer')}
            />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('vibe-motion') && (
          <div className={activeTab === 'vibe-motion' ? "h-full w-full" : "hidden"}>
            <VibeMotionStudio locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('vibe-motion')} onGenerationEnd={makeGenerationEndCallback('vibe-motion')} onGenerationComplete={makeSuccessCallback('vibe-motion')} onGenerationError={makeErrorCallback('vibe-motion')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('agents') && (
          <div className={activeTab === 'agents' ? "h-full w-full" : "hidden"}>
            <AgentsStudio locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('agents')} onGenerationEnd={makeGenerationEndCallback('agents')} onGenerationComplete={makeSuccessCallback('agents')} onGenerationError={makeErrorCallback('agents')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('design-agent') && (
          <div className={activeTab === 'design-agent' ? "h-full w-full" : "hidden"}>
            <DesignAgentStudio locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('design-agent')} onGenerationEnd={makeGenerationEndCallback('design-agent')} onGenerationComplete={makeSuccessCallback('design-agent')} onGenerationError={makeErrorCallback('design-agent')} />
          </div>
        )}
        {THREE_D_TABS.filter((tabId) => AVAILABLE_TAB_IDS.has(tabId)).map((tabId) => (
          <div key={tabId} className={activeTab === tabId ? "h-full w-full" : "hidden"}>
            <ThreeDStudio page={tabId.slice('three-d-'.length)} locale={locale} droppedFiles={activeTab === tabId ? droppedFiles : null} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback(tabId)} onGenerationEnd={makeGenerationEndCallback(tabId)} onGenerationComplete={makeSuccessCallback(tabId)} onGenerationError={makeErrorCallback(tabId)} />
          </div>
        ))}
        {VECTOR_TABS.filter((tabId) => AVAILABLE_TAB_IDS.has(tabId)).map((tabId) => (
          <div key={tabId} className={activeTab === tabId ? "h-full w-full" : "hidden"}>
            <VectorStudio page={tabId.slice('vector-'.length)} locale={locale} droppedFiles={activeTab === tabId ? droppedFiles : null} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback(tabId)} onGenerationEnd={makeGenerationEndCallback(tabId)} onGenerationComplete={makeSuccessCallback(tabId)} onGenerationError={makeErrorCallback(tabId)} />
          </div>
        ))}
        {AVAILABLE_TAB_IDS.has('workflows') && (
          <div className={activeTab === 'workflows' ? "h-full w-full" : "hidden"}>
            <WorkflowStudio locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} onGenerationStart={makeGenerationStartCallback('workflows')} onGenerationEnd={makeGenerationEndCallback('workflows')} onGenerationComplete={makeSuccessCallback('workflows')} onGenerationError={makeErrorCallback('workflows')} />
          </div>
        )}
        {AVAILABLE_TAB_IDS.has('benchmarks') && (
          <div className={activeTab === 'benchmarks' ? "h-full w-full" : "hidden"}>
            <BenchmarksStudio locale={locale} />
          </div>
        )}
      </div>

      {/* Global generation activity and notification stack */}
      {(activeGenerations.length > 0 || notifications.length > 0) && (
        <div
          aria-live="polite"
          aria-label={copy.notifications.ariaLabel}
          className="fixed bottom-5 right-5 z-[200] flex max-h-[calc(100vh-80px)] w-[320px] max-w-[calc(100vw-32px)] flex-col gap-2 overflow-x-hidden overflow-y-auto global-notif-stack pointer-events-none"
          data-testid="global-notification-stack"
        >
          {activeGenerations.map((generation) => (
            <div
              key={generation.tabId}
              role="status"
              data-generation-tab={generation.tabId}
              className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/[0.12] bg-[#111114] px-3.5 py-3 text-[13px] shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
              data-testid="generation-activity"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04]">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
              </span>
              <p className="min-w-0 flex-1 font-medium leading-5 text-white/90">
                {generation.label} {copy.notifications.generating}
                {generation.count > 1 ? ` (${generation.count})` : ''}
              </p>
            </div>
          ))}

          {notifications.map((notif) => (
            <div
              key={notif.id}
              role={notif.type === 'error' ? 'alert' : 'status'}
              data-notification-type={notif.type}
              data-notification-tab={notif.tabId}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-white/[0.12] bg-[#111114] px-3.5 py-3 text-[13px] shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
              style={{ animation: 'slideInRight 280ms cubic-bezier(0.16,1,0.3,1) forwards' }}
            >
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${notif.type === 'success' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-red-400/30 bg-red-400/10 text-red-300'}`}>
                {notif.type === 'success' ? <IconCheck size={16} stroke={2} aria-hidden="true" /> : <IconAlertCircle size={16} stroke={1.75} aria-hidden="true" />}
              </span>

              <div className="min-w-0 flex-1">
                <p className="font-medium leading-5 text-white/90">
                  {notif.label}
                  <span className="font-normal text-white/45">
                    {' '}
                    {notif.type === 'success' ? copy.notifications.generationComplete : copy.notifications.generationFailed}
                  </span>
                </p>
                {notif.type === 'error' && notif.message && (
                  <p className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-red-300" title={typeof notif.message === 'string' ? notif.message : String(notif.message?.message || notif.message)}>
                    {typeof notif.message === 'string' ? notif.message : String(notif.message?.message || notif.message)}
                  </p>
                )}
                {notif.type === 'success' && (
                  <p className="mt-0.5 text-[12px] leading-4 text-white/45">
                    {copy.notifications.resultReady}
                  </p>
                )}
                {notif.type === 'success' && (
                  <button
                    type="button"
                    onClick={() => handleOpenNotification(notif)}
                    className="mt-1.5 text-[12px] font-medium text-primary transition-colors hover:text-white"
                    aria-label={copy.notifications.openResult.replace('{label}', notif.label)}
                  >
                    {copy.notifications.open}
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => dismissNotification(notif.id)}
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white"
                aria-label={copy.notifications.dismissNotification}
              >
                <IconX size={14} stroke={1.75} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Benchmarks picks for the page that is open, selectable in place.
          Top right, under the header: every studio keeps its prompt bar and
          the notification stack at the bottom, so the two never collide. */}
      {AVAILABLE_TAB_IDS.has('benchmarks') && !isMobileOpen && (
        <div className="fixed right-4 top-[68px] z-[95] flex max-w-[calc(100vw-32px)] flex-col items-end" data-testid="benchmarks-helper">
          <BenchmarksHelper tabId={activeTab} locale={locale} benchmarksPath={studioPath('benchmarks')} />
        </div>
      )}

      {/* Keyframe for toast slide-in & scrollbar suppression */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        .global-notif-stack::-webkit-scrollbar {
          display: none;
        }
        .global-notif-stack {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      <CommandPalette open={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} items={paletteItems} copy={copy.palette} />
      {showSettings && <ProvidersModal locale={locale} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
